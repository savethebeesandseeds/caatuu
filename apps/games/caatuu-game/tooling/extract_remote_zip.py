#!/usr/bin/env python3
"""Read selected ZIP members over HTTP byte ranges without fetching the archive."""

from __future__ import annotations

import argparse
import hashlib
import io
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import urllib.response
import zipfile

READ_AHEAD_BYTES = 4 * 1024 * 1024


def open_with_retries(
    request: urllib.request.Request,
    *,
    timeout: int,
) -> urllib.response.addinfourl:
    last_error: BaseException | None = None
    for attempt in range(5):
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except (TimeoutError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 4:
                time.sleep(2**attempt)
    raise RuntimeError(f"HTTP range request failed after retries: {last_error}") from last_error


class HttpRangeReader(io.RawIOBase):
    """A seekable, read-only HTTP object backed by verified byte-range responses."""

    def __init__(self, url: str) -> None:
        self._url = url
        request = urllib.request.Request(url, method="HEAD")
        with open_with_retries(request, timeout=60) as response:
            content_length = response.headers.get("Content-Length")
            accept_ranges = response.headers.get("Accept-Ranges", "")
        if content_length is None or not content_length.isdigit():
            raise RuntimeError("Remote ZIP did not provide a valid Content-Length header.")
        if accept_ranges.lower() != "bytes":
            raise RuntimeError("Remote ZIP does not advertise byte-range support.")
        self._size = int(content_length)
        self._position = 0
        self._cache_start = 0
        self._cache = b""

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            position = offset
        elif whence == io.SEEK_CUR:
            position = self._position + offset
        elif whence == io.SEEK_END:
            position = self._size + offset
        else:
            raise ValueError(f"Unsupported seek mode: {whence}")
        if position < 0:
            raise ValueError("Cannot seek before the start of the remote ZIP.")
        self._position = min(position, self._size)
        return self._position

    def read(self, size: int = -1) -> bytes:
        if self._position >= self._size:
            return b""
        if size is None or size < 0:
            size = self._size - self._position
        size = min(size, self._size - self._position)
        if size == 0:
            return b""

        cache_end = self._cache_start + len(self._cache)
        if not (self._cache_start <= self._position and self._position + size <= cache_end):
            fetch_size = max(size, READ_AHEAD_BYTES)
            fetch_end = min(self._size, self._position + fetch_size) - 1
            request = urllib.request.Request(
                self._url,
                headers={"Range": f"bytes={self._position}-{fetch_end}"},
            )
            with open_with_retries(request, timeout=180) as response:
                if response.status != 206:
                    raise RuntimeError(
                        f"Remote ZIP ignored byte range at {self._position}: HTTP {response.status}."
                    )
                content_range = response.headers.get("Content-Range", "")
                expected_prefix = f"bytes {self._position}-"
                if not content_range.startswith(expected_prefix):
                    raise RuntimeError(
                        f"Remote ZIP returned an unexpected Content-Range: {content_range!r}."
                    )
                self._cache_start = self._position
                self._cache = response.read()

        cache_offset = self._position - self._cache_start
        data = self._cache[cache_offset : cache_offset + size]
        if len(data) != size:
            raise RuntimeError(
                f"Remote ZIP returned {len(data)} bytes while {size} bytes were requested."
            )
        self._position += len(data)
        return data


def parse_expected_hashes(values: list[str]) -> dict[str, str]:
    expected: dict[str, str] = {}
    for value in values:
        member, separator, digest = value.partition("=")
        if not separator or len(digest) != 64:
            raise ValueError("--expect must use MEMBER=SHA256 with a 64-character digest.")
        expected[member] = digest.lower()
    return expected


def extract_members(
    url: str,
    members: list[str],
    output_dir: Path,
    expected_hashes: dict[str, str],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with HttpRangeReader(url) as remote, zipfile.ZipFile(remote) as archive:
        available = set(archive.namelist())
        missing = [member for member in members if member not in available]
        if missing:
            raise RuntimeError(f"Remote ZIP is missing required members: {', '.join(missing)}")

        for member in members:
            output_path = output_dir / Path(member).name
            temporary_path = output_path.with_suffix(output_path.suffix + ".partial")
            digest = hashlib.sha256()
            with archive.open(member) as source, temporary_path.open("wb") as destination:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    destination.write(chunk)
            actual_hash = digest.hexdigest()
            expected_hash = expected_hashes.get(member)
            if expected_hash is None:
                temporary_path.unlink(missing_ok=True)
                raise RuntimeError(f"No pinned SHA-256 was supplied for {member}.")
            if actual_hash != expected_hash:
                temporary_path.unlink(missing_ok=True)
                raise RuntimeError(
                    f"SHA-256 mismatch for {member}: expected {expected_hash}, got {actual_hash}."
                )
            temporary_path.replace(output_path)
            print(f"{actual_hash}  {member}")


def list_members(url: str, prefix: str) -> None:
    with HttpRangeReader(url) as remote, zipfile.ZipFile(remote) as archive:
        for member in archive.infolist():
            if member.filename.startswith(prefix):
                print(f"{member.file_size}\t{member.compress_size}\t{member.filename}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--member", action="append", default=[])
    parser.add_argument("--expect", action="append", default=[])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--list-prefix")
    args = parser.parse_args()

    if args.list_prefix:
        list_members(args.url, args.list_prefix)
        return 0
    if not args.member or args.output is None:
        parser.error("--member and --output are required unless --list-prefix is used.")

    extract_members(
        args.url,
        args.member,
        args.output,
        parse_expected_hashes(args.expect),
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        print(f"Godot template extraction failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
