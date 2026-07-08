#!/usr/bin/env python3
"""Build the Caatuu Czech seed corpus.

This script intentionally uses only the Python standard library so it can run
from Codex's bundled Python or a normal system Python.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "raw"
PROCESSED_DIR = ROOT / "processed"
SOURCES_PATH = ROOT / "sources.json"

USER_AGENT = "CaatuuCzechCorpusBuilder/0.1 (local educational corpus)"

SECTION_DROP_RE = re.compile(
    r"^(Reference|Externí odkazy|Literatura|Související články|Odkazy|"
    r"Poznámky|Galerie|Obsazení|Film|Divadlo|Edice|Překlady)\s*$",
    re.IGNORECASE,
)
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9])")
SPACE_RE = re.compile(r"[ \t\r\f\v]+")
MULTI_NL_RE = re.compile(r"\n{3,}")
GUTENBERG_START_RE = re.compile(r"\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*", re.I | re.S)
GUTENBERG_END_RE = re.compile(r"\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*", re.I | re.S)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^0-9a-záčďéěíňóřšťúůýž]+", "-", value, flags=re.I)
    return value.strip("-") or "source"


def fetch_text(url: str, *, timeout: int = 45) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def fetch_json(url: str, *, timeout: int = 45) -> Any:
    return json.loads(fetch_text(url, timeout=timeout))


def wikipedia_summary_url(title: str) -> str:
    page = urllib.parse.quote(title.replace(" ", "_"), safe="")
    return f"https://cs.wikipedia.org/api/rest_v1/page/summary/{page}"


def normalize_text(text: str) -> str:
    text = text.replace("\ufeff", "")
    text = text.replace("\u00a0", " ")
    text = re.sub(r"\[[0-9]+\]", "", text)
    text = SPACE_RE.sub(" ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = MULTI_NL_RE.sub("\n\n", text)
    return text.strip()


def drop_tail_sections(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        if SECTION_DROP_RE.match(line.strip()):
            break
        lines.append(line)
    return "\n".join(lines).strip()


def strip_gutenberg_boilerplate(text: str) -> str:
    text = GUTENBERG_START_RE.sub("", text, count=1)
    text = GUTENBERG_END_RE.sub("", text, count=1)
    return text.strip()


def sentence_split(text: str) -> list[str]:
    compact = re.sub(r"\s+", " ", text).strip()
    if not compact:
        return []
    sentences = [part.strip() for part in SENTENCE_RE.split(compact)]
    return [
        sentence
        for sentence in sentences
        if 20 <= len(sentence) <= 320
        and sum(ch.isalpha() for ch in sentence) >= 12
        and not sentence.startswith(("http://", "https://"))
    ]


def add_doc(
    docs: list[dict[str, Any]],
    *,
    source_id: str,
    source_type: str,
    title: str,
    license_name: str,
    url: str | None,
    text: str,
) -> None:
    text = normalize_text(drop_tail_sections(text))
    if not text:
        return
    docs.append(
        {
            "id": f"{source_id}:{len(docs) + 1}",
            "source_id": source_id,
            "source_type": source_type,
            "title": title,
            "license": license_name,
            "url": url,
            "text": text,
        }
    )


def collect_local_sources(config: dict[str, Any], docs: list[dict[str, Any]]) -> None:
    for source in config.get("local_sources", []):
        path = (ROOT / source["path"]).resolve()
        data = read_json(path)
        source_id = source["id"]
        if source_id == "caatuu_dictionary":
            lines = []
            for item in data:
                cs = item.get("cs")
                use = item.get("use")
                en = item.get("en")
                if cs:
                    lines.append(cs)
                if use and use != cs:
                    lines.append(use)
                if cs and en:
                    lines.append(f"{en} -> {cs}")
            add_doc(
                docs,
                source_id=source_id,
                source_type=source["kind"],
                title="Caatuu dictionary entries",
                license_name=source["license"],
                url=None,
                text="\n".join(lines),
            )
        elif source_id == "caatuu_scripts":
            blocks = []
            for script in data:
                blocks.append(script.get("title", "Script"))
                blocks.append(script.get("goal", ""))
                for line in script.get("lines", []):
                    cs = line.get("cs")
                    en = line.get("en")
                    if cs and en:
                        blocks.append(f"{en} -> {cs}")
                    elif cs:
                        blocks.append(cs)
            add_doc(
                docs,
                source_id=source_id,
                source_type=source["kind"],
                title="Caatuu short scripts",
                license_name=source["license"],
                url=None,
                text="\n".join(blocks),
            )
        elif source_id == "caatuu_verbs":
            lines = []
            for verb in data:
                infinitive = verb.get("infinitive")
                english = verb.get("english")
                pattern = verb.get("pattern")
                if infinitive and english:
                    lines.append(f"{english} -> {infinitive}")
                if pattern:
                    lines.append(pattern)
                for form in verb.get("forms", {}).values():
                    cs = form.get("cs")
                    en = form.get("en")
                    if cs and en:
                        lines.append(f"{en} -> {cs}")
                    elif cs:
                        lines.append(cs)
            add_doc(
                docs,
                source_id=source_id,
                source_type=source["kind"],
                title="Caatuu verb forms",
                license_name=source["license"],
                url=None,
                text="\n".join(lines),
            )


def collect_wikipedia(config: dict[str, Any], docs: list[dict[str, Any]], *, refresh: bool) -> None:
    wiki = config.get("wikipedia_extracts", {})
    api = wiki.get("api")
    if not api:
        return
    titles = wiki.get("titles", [])
    if not titles:
        return

    # The extracts API limits full-page text to one title per request. Fetch
    # pages one at a time with a delay so the raw cache stays complete.
    pages_by_key: dict[str, Any] = {}
    failed_titles: list[str] = []
    chunk_size = 1
    for chunk_index, start in enumerate(range(0, len(titles), chunk_size), start=1):
        chunk = titles[start : start + chunk_size]
        title = chunk[0]
        raw_path = RAW_DIR / f"wikipedia_batch_{chunk_index}.json"
        summary_cache_path = RAW_DIR / f"wikipedia_summary_{slugify(title)}.json"
        if not refresh and not raw_path.exists() and summary_cache_path.exists():
            raw_summary = read_json(summary_cache_path)
            if raw_summary.get("extract"):
                page_id = str(raw_summary.get("pageid") or f"summary:{title}")
                pages_by_key.setdefault(
                    page_id,
                    {
                        "title": raw_summary.get("title", title),
                        "extract": raw_summary.get("extract", ""),
                    },
                )
                continue
        if refresh or not raw_path.exists():
            params = {
                "action": "query",
                "format": "json",
                "prop": "extracts",
                "explaintext": "1",
                "exsectionformat": "plain",
                "redirects": "1",
                "titles": "|".join(chunk),
            }
            url = api + "?" + urllib.parse.urlencode(params)
            try:
                raw = fetch_json(url)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                print(f"warning: failed to fetch Wikipedia batch {chunk_index}: {exc}", file=sys.stderr)
                failed_titles.extend(chunk)
                continue
            write_json(raw_path, raw)
            time.sleep(1.25)
        raw = read_json(raw_path)
        pages = raw.get("query", {}).get("pages", {})
        for page_id, page in pages.items():
            if "missing" in page:
                continue
            pages_by_key[str(page_id)] = page

    if failed_titles:
        raw_path = RAW_DIR / "wikipedia_intro_fallback.json"
        if refresh or not raw_path.exists():
            params = {
                "action": "query",
                "format": "json",
                "prop": "extracts",
                "explaintext": "1",
                "exintro": "1",
                "exlimit": "max",
                "exsectionformat": "plain",
                "redirects": "1",
                "titles": "|".join(failed_titles),
            }
            url = api + "?" + urllib.parse.urlencode(params)
            try:
                raw = fetch_json(url)
                write_json(raw_path, raw)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                print(f"warning: failed to fetch Wikipedia intro fallback: {exc}", file=sys.stderr)
                raw = {}
        else:
            raw = read_json(raw_path)
        pages = raw.get("query", {}).get("pages", {})
        for page_id, page in pages.items():
            if "missing" in page or not page.get("extract"):
                continue
            pages_by_key.setdefault(str(page_id), page)

        for title in failed_titles:
            raw_path = RAW_DIR / f"wikipedia_summary_{slugify(title)}.json"
            if refresh or not raw_path.exists():
                try:
                    raw = fetch_json(wikipedia_summary_url(title))
                    write_json(raw_path, raw)
                    time.sleep(0.25)
                except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                    print(f"warning: failed to fetch Wikipedia summary {title!r}: {exc}", file=sys.stderr)
                    continue
            raw = read_json(raw_path)
            if not raw.get("extract"):
                continue
            page_id = str(raw.get("pageid") or f"summary:{title}")
            pages_by_key.setdefault(
                page_id,
                {
                    "title": raw.get("title", title),
                    "extract": raw.get("extract", ""),
                },
            )

    for page_id in sorted(pages_by_key, key=lambda value: pages_by_key[value].get("title", "")):
        page = pages_by_key[page_id]
        extract = page.get("extract", "")
        page_title = page.get("title", page_id)
        page_url = f"https://cs.wikipedia.org/wiki/{urllib.parse.quote(page_title.replace(' ', '_'))}"
        add_doc(
            docs,
            source_id=f"wikipedia:{page_title}",
            source_type="wikipedia_extract",
            title=page_title,
            license_name=wiki.get("license", "CC BY-SA"),
            url=page_url,
            text=extract,
        )


def collect_books(config: dict[str, Any], docs: list[dict[str, Any]], *, refresh: bool) -> None:
    for book in config.get("books", []):
        source_id = book["id"]
        raw_path = RAW_DIR / f"{source_id}.txt"
        if refresh or not raw_path.exists():
            try:
                raw_path.write_text(fetch_text(book["text_url"]), encoding="utf-8")
            except (urllib.error.URLError, TimeoutError) as exc:
                print(f"warning: failed to fetch book {source_id!r}: {exc}", file=sys.stderr)
                continue
            time.sleep(0.2)
        text = strip_gutenberg_boilerplate(raw_path.read_text(encoding="utf-8", errors="replace"))
        add_doc(
            docs,
            source_id=source_id,
            source_type="book",
            title=book["title"],
            license_name=book["license"],
            url=book.get("source"),
            text=text,
        )


def write_outputs(docs: list[dict[str, Any]]) -> dict[str, Any]:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    corpus_path = PROCESSED_DIR / "czech_seed_corpus.jsonl"
    sentences_path = PROCESSED_DIR / "czech_seed_sentences.txt"
    attribution_path = PROCESSED_DIR / "attribution.json"
    summary_path = PROCESSED_DIR / "summary.json"

    with corpus_path.open("w", encoding="utf-8") as f:
        for doc in docs:
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")

    seen_sentences: set[str] = set()
    sentences: list[str] = []
    for doc in docs:
        for sentence in sentence_split(doc["text"]):
            if sentence not in seen_sentences:
                seen_sentences.add(sentence)
                sentences.append(sentence)
    sentences_path.write_text("\n".join(sentences) + "\n", encoding="utf-8")

    attribution = [
        {
            "source_id": doc["source_id"],
            "source_type": doc["source_type"],
            "title": doc["title"],
            "license": doc["license"],
            "url": doc["url"],
        }
        for doc in docs
    ]
    write_json(attribution_path, attribution)

    source_counts: dict[str, int] = {}
    for doc in docs:
        source_counts[doc["source_type"]] = source_counts.get(doc["source_type"], 0) + 1
    summary = {
        "documents": len(docs),
        "sentences": len(sentences),
        "characters": sum(len(doc["text"]) for doc in docs),
        "source_counts": source_counts,
        "outputs": {
            "corpus_jsonl": str(corpus_path.relative_to(ROOT)),
            "sentences_txt": str(sentences_path.relative_to(ROOT)),
            "attribution_json": str(attribution_path.relative_to(ROOT)),
        },
    }
    write_json(summary_path, summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Caatuu Czech seed corpus.")
    parser.add_argument("--refresh", action="store_true", help="refetch remote source data")
    parser.add_argument("--skip-remote", action="store_true", help="only use local Caatuu data")
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    config = read_json(SOURCES_PATH)
    docs: list[dict[str, Any]] = []

    collect_local_sources(config, docs)
    if not args.skip_remote:
        collect_wikipedia(config, docs, refresh=args.refresh)
        collect_books(config, docs, refresh=args.refresh)

    summary = write_outputs(docs)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
