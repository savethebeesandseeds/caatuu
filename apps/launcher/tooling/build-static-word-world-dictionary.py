#!/usr/bin/env python3
"""Build the compact, reviewed dictionary supplement for static Word World."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
LANGUAGE_ROOT = WORKSPACE_ROOT / "apps/languages/czech/static"
WORD_WORLD_ROOT = LANGUAGE_ROOT / "data/games/word-world"
DICTIONARY_ROOT = LANGUAGE_ROOT / "data/dictionaries/kaikki-cs-en-2026-07-09"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "data/word-world-static-dictionary.v1.json"
WORD_PATTERN = re.compile(r"[^\W_]+(?:[-'][^\W_]+)?", re.UNICODE)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def folded(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").strip().lower())
    return "".join(character for character in normalized if unicodedata.category(character) != "Mn")


def exact_key(value: str) -> str:
    return unicodedata.normalize("NFC", str(value or "").strip().lower())


def json_list(value: str) -> list[str]:
    parsed = json.loads(value or "[]")
    return [str(item).strip() for item in parsed if str(item).strip()]


def unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value or "").strip()
        key = exact_key(text)
        if not text or key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def word_surfaces(records: list[dict]) -> list[str]:
    surfaces = {
        unicodedata.normalize("NFC", match.group(0))
        for record in records
        for match in WORD_PATTERN.finditer(str(record.get("cs") or ""))
    }
    return sorted(surfaces, key=lambda value: (folded(value), exact_key(value), value))


def entry_for(connection: sqlite3.Connection, entry_id: int, normalized: str, surfaces: list[str]) -> dict | None:
    entry = connection.execute(
        "SELECT lemma, pos FROM entries WHERE id = ?",
        (entry_id,),
    ).fetchone()
    if entry is None:
        return None

    terms = connection.execute(
        """
        SELECT term, kind
        FROM search_terms
        WHERE entry_id = ? AND normalized = ?
        ORDER BY CASE kind WHEN 'lemma' THEN 0 ELSE 1 END, term
        """,
        (entry_id, normalized),
    ).fetchall()
    surface_keys = {exact_key(surface) for surface in surfaces}
    matched_term, matched_kind = next(
        ((term, kind) for term, kind in terms if exact_key(term) in surface_keys),
        terms[0] if terms else (entry[0], "lemma"),
    )

    forms = []
    for form, tags_json in connection.execute(
        """
        SELECT form, tags_json
        FROM forms
        WHERE entry_id = ? AND form_normalized = ?
        ORDER BY form, tags_json
        """,
        (entry_id, normalized),
    ):
        forms.append({"form": form, "tags": json_list(tags_json)})
    if matched_kind == "form" and not any(exact_key(item["form"]) == exact_key(matched_term) for item in forms):
        forms.append({"form": matched_term, "tags": []})

    senses = []
    for sense_id, gloss, raw_gloss, tags_json, topics_json, synonyms_json, antonyms_json in connection.execute(
        """
        SELECT id, gloss, raw_gloss, tags_json, topics_json, synonyms_json, antonyms_json
        FROM senses
        WHERE entry_id = ?
        ORDER BY position, id
        """,
        (entry_id,),
    ):
        tags = json_list(tags_json)
        if any(tag.lower() == "form-of" for tag in tags):
            continue
        gloss = str(gloss or "").strip()
        if not gloss:
            continue
        examples = [
            {"text": text, "english": english, "tags": json_list(example_tags)}
            for text, english, example_tags in connection.execute(
                "SELECT text, english, tags_json FROM examples WHERE sense_id = ? ORDER BY id LIMIT 2",
                (sense_id,),
            )
            if str(text or "").strip()
        ]
        senses.append({
            "gloss": gloss,
            "rawGloss": str(raw_gloss or "").strip(),
            "tags": tags,
            "topics": json_list(topics_json),
            "synonyms": unique_strings(json_list(synonyms_json)),
            "antonyms": unique_strings(json_list(antonyms_json)),
            "examples": examples,
        })
        if len(senses) >= 4:
            break
    if not senses:
        return None

    return {
        "id": f"kaikki-{entry_id}",
        "lemma": entry[0],
        "pos": entry[1],
        "matchedBy": matched_kind,
        "matchedTerm": matched_term,
        "forms": forms,
        "senses": senses,
    }


def entry_matches_surface(entry: dict, surface: str) -> bool:
    key = exact_key(surface)
    return any(
        exact_key(value) == key
        for value in [
            entry.get("lemma"),
            entry.get("matchedTerm"),
            *[item.get("form") for item in entry.get("forms", [])],
        ]
    )


def build(output: Path) -> dict:
    records_path = WORD_WORLD_ROOT / "standard-v0.1/records.json"
    word_world_manifest_path = WORD_WORLD_ROOT / "manifest.json"
    dictionary_manifest_path = DICTIONARY_ROOT / "manifest.json"
    database_path = DICTIONARY_ROOT / "caatuu-cs-en.sqlite"

    word_world_manifest = json.loads(word_world_manifest_path.read_text(encoding="utf-8"))
    if sha256_file(records_path) != word_world_manifest["contentSha256"]:
        raise RuntimeError("Word World records do not match their reviewed manifest")
    records_document = json.loads(records_path.read_text(encoding="utf-8"))
    records = records_document.get("records") or []
    if len(records) != word_world_manifest["recordCount"]:
        raise RuntimeError("Word World record count does not match its reviewed manifest")

    dictionary_manifest = json.loads(dictionary_manifest_path.read_text(encoding="utf-8"))
    if database_path.stat().st_size != dictionary_manifest["bytes"]:
        raise RuntimeError("Full dictionary byte count does not match its reviewed manifest")
    if sha256_file(database_path) != dictionary_manifest["sha256"]:
        raise RuntimeError("Full dictionary hash does not match its reviewed manifest")

    surfaces = word_surfaces(records)
    surfaces_by_normalized: dict[str, list[str]] = {}
    for surface in surfaces:
        surfaces_by_normalized.setdefault(folded(surface), []).append(surface)

    entries_by_normalized: dict[str, list[dict]] = {}
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    try:
        for normalized, matching_surfaces in sorted(surfaces_by_normalized.items()):
            rows = connection.execute(
                """
                SELECT DISTINCT e.id,
                  CASE st.kind WHEN 'lemma' THEN 0 ELSE 1 END AS kind_rank,
                  CASE WHEN lower(e.pos) IN ('name', 'proper noun', 'proper-name') THEN 1 ELSE 0 END AS name_rank
                FROM search_terms st
                JOIN entries e ON e.id = st.entry_id
                WHERE st.normalized = ?
                ORDER BY name_rank, kind_rank, e.id
                LIMIT 12
                """,
                (normalized,),
            ).fetchall()
            entries = []
            for entry_id, _kind_rank, _name_rank in rows:
                candidate = entry_for(connection, entry_id, normalized, matching_surfaces)
                if candidate is not None:
                    entries.append(candidate)
                if len(entries) >= 8:
                    break
            if entries:
                entries_by_normalized[normalized] = entries
    finally:
        connection.close()

    resolved_surfaces = [
        surface
        for surface in surfaces
        if any(entry_matches_surface(entry, surface) for entry in entries_by_normalized.get(folded(surface), []))
    ]
    unresolved_surfaces = sorted(set(surfaces) - set(resolved_surfaces), key=lambda value: (folded(value), value))
    document = {
        "schema_name": "caatuu-static-word-world-dictionary",
        "schema_version": 1,
        "corpus_version": word_world_manifest["corpusVersion"],
        "corpus_sha256": word_world_manifest["contentSha256"],
        "source_dictionary": {
            "key": dictionary_manifest["key"],
            "database_sha256": dictionary_manifest["sha256"],
            "source_sha256": dictionary_manifest["source_sha256"],
            "source_url": dictionary_manifest["source_artifact_url"],
            "license": dictionary_manifest["license"],
            "attribution": "data/dictionaries/ATTRIBUTION.md",
        },
        "surface_count": len(surfaces),
        "resolved_surface_count": len(resolved_surfaces),
        "unresolved_surfaces": unresolved_surfaces,
        "entries": entries_by_normalized,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = build(args.output.resolve())
    print(json.dumps({
        "output": str(args.output.resolve()),
        "surfaceCount": result["surface_count"],
        "resolvedSurfaceCount": result["resolved_surface_count"],
        "unresolvedSurfaceCount": len(result["unresolved_surfaces"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
