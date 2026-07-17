#!/usr/bin/env python3
"""Build the developer Czech -> English dictionary from a pinned Kaikki export."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_SOURCE_URL = "https://kaikki.org/dictionary/Czech/kaikki.org-dictionary-Czech.jsonl"
DEFAULT_SOURCE_PAGE = "https://kaikki.org/dictionary/Czech/index.html"
DEFAULT_DUMP_DATE = "2026-07-06"
DEFAULT_EXTRACTED_DATE = "2026-07-09"
DEFAULT_KEY = "kaikki-cs-en-2026-07-09"
SCHEMA_VERSION = 1
EXAMPLE_CITATION_FIELDS = {
    "author",
    "collection",
    "date",
    "editor",
    "journal",
    "publisher",
    "ref",
    "source",
    "title",
    "url",
    "year",
}
FORM_METADATA_TAGS = {"class", "inflection-template", "table-tags"}


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[3]
    app_root = repo_root / "apps" / "languages" / "czech" / "static" / "data" / "dictionaries"
    cache_root = repo_root / "tools" / "czech-ml" / "data" / "dictionaries" / "downloads"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", default=DEFAULT_SOURCE_URL)
    parser.add_argument("--source-file", type=Path)
    parser.add_argument("--cache-file", type=Path, default=cache_root / f"{DEFAULT_KEY}.jsonl")
    parser.add_argument("--out-dir", type=Path, default=app_root / DEFAULT_KEY)
    parser.add_argument("--catalog-file", type=Path, default=app_root / "catalog.json")
    parser.add_argument("--key", default=DEFAULT_KEY)
    parser.add_argument("--dump-date", default=DEFAULT_DUMP_DATE)
    parser.add_argument("--extracted-date", default=DEFAULT_EXTRACTED_DATE)
    parser.add_argument("--max-entries", type=int, default=0)
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def normalized(value: str) -> str:
    folded = unicodedata.normalize("NFD", str(value or ""))
    return " ".join(
        "".join(char for char in folded if unicodedata.category(char) != "Mn")
        .casefold()
        .split()
    )


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_source(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".download")
    request = urllib.request.Request(url, headers={"User-Agent": "Caatuu dictionary builder/1.0"})
    print(f"Downloading {url}", flush=True)
    with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
        expected = int(response.headers.get("Content-Length", "0") or 0)
        received = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            received += len(chunk)
            if received % (25 * 1024 * 1024) < len(chunk):
                print(f"  {received / 1024 / 1024:.0f} MB downloaded", flush=True)
        if expected and received != expected:
            raise RuntimeError(f"Download ended at {received} bytes; expected {expected}")
    partial.replace(destination)


def source_path(args: argparse.Namespace) -> tuple[Path, bool]:
    if args.source_file:
        return args.source_file.resolve(), False
    cache_file = args.cache_file.resolve()
    if args.refresh or not cache_file.is_file():
        download_source(args.source_url, cache_file)
    return cache_file, True


def editor_example(example: object) -> bool:
    if not isinstance(example, dict):
        return False
    example_type = str(example.get("type", "")).strip().lower()
    if example_type and example_type not in {"example", "usage"}:
        return False
    if any(example.get(field) for field in EXAMPLE_CITATION_FIELDS):
        return False
    return bool(str(example.get("text", "")).strip())


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA locking_mode = EXCLUSIVE;

        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE entries (
          id INTEGER PRIMARY KEY,
          lemma TEXT NOT NULL,
          lemma_normalized TEXT NOT NULL,
          pos TEXT NOT NULL,
          etymology_text TEXT NOT NULL DEFAULT '',
          source_url TEXT NOT NULL
        );

        CREATE TABLE senses (
          id INTEGER PRIMARY KEY,
          entry_id INTEGER NOT NULL REFERENCES entries(id),
          source_sense_id TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL,
          gloss TEXT NOT NULL,
          raw_gloss TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          topics_json TEXT NOT NULL DEFAULT '[]',
          synonyms_json TEXT NOT NULL DEFAULT '[]',
          antonyms_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE forms (
          id INTEGER PRIMARY KEY,
          entry_id INTEGER NOT NULL REFERENCES entries(id),
          form TEXT NOT NULL,
          form_normalized TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE examples (
          id INTEGER PRIMARY KEY,
          sense_id INTEGER NOT NULL REFERENCES senses(id),
          text TEXT NOT NULL,
          english TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE search_terms (
          entry_id INTEGER NOT NULL REFERENCES entries(id),
          term TEXT NOT NULL,
          normalized TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('lemma', 'form')),
          PRIMARY KEY (entry_id, normalized, term, kind)
        ) WITHOUT ROWID;
        """
    )


def relation_words(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        word = item.get("word", "") if isinstance(item, dict) else ""
        word = str(word).strip()
        if word and word not in result:
            result.append(word)
    return result


def ingest(connection: sqlite3.Connection, source: Path, max_entries: int) -> dict[str, int]:
    counts = {
        "entries": 0,
        "senses": 0,
        "forms": 0,
        "examples": 0,
        "excluded_quotations": 0,
        "invalid_rows": 0,
    }
    entry_insert = connection.execute

    with source.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if max_entries and counts["entries"] >= max_entries:
                break
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                counts["invalid_rows"] += 1
                if max_entries:
                    continue
                raise RuntimeError(f"Invalid JSON on source line {line_number}")

            lemma = str(item.get("word", "")).strip()
            if not lemma or item.get("lang_code") != "cs":
                continue
            lemma_normalized = normalized(lemma)
            if not lemma_normalized:
                continue
            pos = str(item.get("pos", "unknown") or "unknown").strip()
            source_url = f"https://en.wiktionary.org/wiki/{urllib.parse.quote(lemma.replace(' ', '_'), safe='')}#Czech"
            cursor = entry_insert(
                "INSERT INTO entries(lemma, lemma_normalized, pos, etymology_text, source_url) VALUES (?, ?, ?, ?, ?)",
                (lemma, lemma_normalized, pos, str(item.get("etymology_text", "") or ""), source_url),
            )
            entry_id = int(cursor.lastrowid)
            connection.execute(
                "INSERT OR IGNORE INTO search_terms(entry_id, term, normalized, kind) VALUES (?, ?, ?, 'lemma')",
                (entry_id, lemma, lemma_normalized),
            )
            counts["entries"] += 1

            seen_forms: set[tuple[str, str]] = set()
            for form_item in item.get("forms", []) or []:
                if not isinstance(form_item, dict):
                    continue
                form = str(form_item.get("form", "")).strip()
                form_normalized = normalized(form)
                if not form or not form_normalized or form in {"-", "?"}:
                    continue
                tags = [str(tag) for tag in form_item.get("tags", []) or []]
                if FORM_METADATA_TAGS.intersection(tags):
                    continue
                key = (form, json_text(tags))
                if key in seen_forms:
                    continue
                seen_forms.add(key)
                connection.execute(
                    "INSERT INTO forms(entry_id, form, form_normalized, tags_json) VALUES (?, ?, ?, ?)",
                    (entry_id, form, form_normalized, key[1]),
                )
                connection.execute(
                    "INSERT OR IGNORE INTO search_terms(entry_id, term, normalized, kind) VALUES (?, ?, ?, 'form')",
                    (entry_id, form, form_normalized),
                )
                counts["forms"] += 1

            for position, sense in enumerate(item.get("senses", []) or [], start=1):
                if not isinstance(sense, dict):
                    continue
                glosses = [str(value).strip() for value in sense.get("glosses", []) or [] if str(value).strip()]
                if not glosses:
                    continue
                raw_glosses = [str(value).strip() for value in sense.get("raw_glosses", []) or [] if str(value).strip()]
                sense_cursor = connection.execute(
                    """
                    INSERT INTO senses(
                      entry_id, source_sense_id, position, gloss, raw_gloss,
                      tags_json, topics_json, synonyms_json, antonyms_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        entry_id,
                        str(sense.get("id", "") or ""),
                        position,
                        glosses[-1],
                        raw_glosses[-1] if raw_glosses else "",
                        json_text([str(value) for value in sense.get("tags", []) or []]),
                        json_text([str(value) for value in sense.get("topics", []) or []]),
                        json_text(relation_words(sense.get("synonyms"))),
                        json_text(relation_words(sense.get("antonyms"))),
                    ),
                )
                sense_id = int(sense_cursor.lastrowid)
                counts["senses"] += 1

                for example in sense.get("examples", []) or []:
                    if not editor_example(example):
                        counts["excluded_quotations"] += 1
                        continue
                    connection.execute(
                        "INSERT INTO examples(sense_id, text, english, tags_json) VALUES (?, ?, ?, ?)",
                        (
                            sense_id,
                            str(example.get("text", "")).strip(),
                            str(example.get("english", "") or example.get("translation", "")).strip(),
                            json_text([str(value) for value in example.get("tags", []) or []]),
                        ),
                    )
                    counts["examples"] += 1

            if counts["entries"] % 5000 == 0:
                connection.commit()
                print(
                    f"  {counts['entries']} entries, {counts['senses']} senses, {counts['forms']} forms",
                    flush=True,
                )

    connection.commit()
    return counts


def finalize_database(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE INDEX idx_entries_lemma_normalized ON entries(lemma_normalized, pos);
        CREATE INDEX idx_senses_entry ON senses(entry_id, position);
        CREATE INDEX idx_forms_entry ON forms(entry_id, form_normalized);
        CREATE INDEX idx_examples_sense ON examples(sense_id, id);
        CREATE INDEX idx_search_terms_normalized ON search_terms(normalized, kind, entry_id);
        ANALYZE;
        """
    )
    connection.commit()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(args: argparse.Namespace) -> None:
    source, cached = source_path(args)
    if not source.is_file():
        raise FileNotFoundError(source)

    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    final_db = out_dir / "caatuu-cs-en.sqlite"
    temporary_db = out_dir / "caatuu-cs-en.sqlite.building"
    temporary_db.unlink(missing_ok=True)

    print(f"Building {final_db}", flush=True)
    connection = sqlite3.connect(temporary_db)
    try:
        create_schema(connection)
        counts = ingest(connection, source, max(0, args.max_entries))
        source_sha256 = sha256_file(source)
        metadata = {
            "schema_name": "caatuu-full-dictionary",
            "schema_version": str(SCHEMA_VERSION),
            "dictionary_key": args.key,
            "direction": "cs-en",
            "source_name": "English Wiktionary Czech dictionary via Kaikki/Wiktextract",
            "source_url": args.source_url,
            "source_page": DEFAULT_SOURCE_PAGE,
            "source_sha256": source_sha256,
            "wiktionary_dump_date": args.dump_date,
            "kaikki_extracted_date": args.extracted_date,
            "license": "CC-BY-SA-4.0 OR GFDL-1.3-or-later",
            "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
            "entry_count": str(counts["entries"]),
            "sense_count": str(counts["senses"]),
            "form_count": str(counts["forms"]),
            "example_count": str(counts["examples"]),
            "excluded_quotation_count": str(counts["excluded_quotations"]),
            "usage_scope": "app_and_games",
        }
        connection.executemany("INSERT INTO metadata(key, value) VALUES (?, ?)", metadata.items())
        finalize_database(connection)
    finally:
        connection.close()

    temporary_db.replace(final_db)
    database_sha256 = sha256_file(final_db)
    database_bytes = final_db.stat().st_size
    manifest = {
        "version": 1,
        "key": args.key,
        "label": "Full Czech to English Dictionary",
        "short_label": "Full CZ -> EN",
        "status": "active" if not args.max_entries else "developer-sample",
        "artifact_kind": "dictionary-database",
        "direction": "cs-en",
        "runtime": "Caatuu Rust API and Android SQLite",
        "format": "sqlite",
        "database_file": "caatuu-cs-en.sqlite",
        "download_url": f"https://caatuu.waajacu.com/cz/data/dictionaries/{args.key}/caatuu-cs-en.sqlite",
        "bytes": database_bytes,
        "sha256": database_sha256,
        "source_label": "English Wiktionary Czech entries via Kaikki/Wiktextract",
        "source_url": DEFAULT_SOURCE_PAGE,
        "source_artifact_url": args.source_url,
        "source_sha256": source_sha256,
        "wiktionary_dump_date": args.dump_date,
        "kaikki_extracted_date": args.extracted_date,
        "license": "CC-BY-SA-4.0 OR GFDL-1.3-or-later",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "commercial_use_allowed": True,
        "attribution_required": True,
        "sharealike_required": True,
        "usage_scope": "app_and_games",
        "entry_count": counts["entries"],
        "sense_count": counts["senses"],
        "form_count": counts["forms"],
        "example_count": counts["examples"],
        "excluded_quotation_count": counts["excluded_quotations"],
        "invalid_source_rows": counts["invalid_rows"],
        "intended_use": "Czech-to-English meanings and inflected-form lookup throughout Caatuu, including learning games.",
        "notes": [
            "The curated Core dictionary remains separate and retains its original learner order.",
            "Search indexes only Czech lemmas and Czech inflected forms; English text is returned as the meaning.",
            "Published quotations and citation-like examples are excluded; retained examples are editor-written usage examples only.",
            "Android initial setup downloads and verifies the database outside the APK in app-private storage.",
        ],
    }
    write_json(out_dir / "manifest.json", manifest)

    catalog = {
        "version": 1,
        "default_dictionary": args.key,
        "base_url": "data/dictionaries",
        "dictionaries": [
            {
                **manifest,
                "manifest_file": f"{args.key}/manifest.json",
                "database_file": f"{args.key}/caatuu-cs-en.sqlite",
            }
        ],
    }
    write_json(args.catalog_file.resolve(), catalog)
    print(json.dumps({"source_cached": cached, **manifest}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    try:
        build(parse_args())
    except KeyboardInterrupt:
        raise
    except Exception as error:  # pragma: no cover - CLI boundary
        print(f"error: {error}", file=sys.stderr)
        raise
