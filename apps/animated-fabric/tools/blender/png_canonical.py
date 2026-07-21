"""Canonicalize Blender RGBA PNGs without decoding or re-encoding their pixels."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_RETAINED_CHUNKS = {b"IHDR", b"PLTE", b"IDAT", b"IEND"}


def canonicalize_rgba_png(path: Path, *, expected_size: tuple[int, int]) -> None:
    """Strip nondeterministic ancillary chunks from one validated RGBA8 PNG."""
    payload = path.read_bytes()
    if not payload.startswith(PNG_SIGNATURE):
        raise ValueError(f"Rendered frame is not a PNG: {path.name}")

    cursor = len(PNG_SIGNATURE)
    canonical = bytearray(PNG_SIGNATURE)
    chunk_types: list[bytes] = []
    while cursor < len(payload):
        if cursor + 12 > len(payload):
            raise ValueError(f"Rendered PNG has a truncated chunk: {path.name}")
        length = struct.unpack(">I", payload[cursor : cursor + 4])[0]
        chunk_end = cursor + 12 + length
        if chunk_end > len(payload):
            raise ValueError(f"Rendered PNG has a truncated payload: {path.name}")
        chunk_type = payload[cursor + 4 : cursor + 8]
        chunk_data = payload[cursor + 8 : cursor + 8 + length]
        expected_crc = struct.unpack(">I", payload[cursor + 8 + length : chunk_end])[0]
        actual_crc = zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise ValueError(f"Rendered PNG has an invalid checksum: {path.name}")
        if chunk_type in _RETAINED_CHUNKS:
            canonical.extend(payload[cursor:chunk_end])
            chunk_types.append(chunk_type)
        elif chunk_type[:1].isupper():
            raise ValueError(f"Rendered PNG has an unsupported critical chunk: {path.name}")
        cursor = chunk_end
        if chunk_type == b"IEND":
            break

    if cursor != len(payload):
        raise ValueError(f"Rendered PNG has trailing data: {path.name}")
    if not chunk_types or chunk_types[0] != b"IHDR" or chunk_types[-1] != b"IEND":
        raise ValueError(f"Rendered PNG has an invalid chunk order: {path.name}")
    if chunk_types.count(b"IHDR") != 1 or chunk_types.count(b"IEND") != 1:
        raise ValueError(f"Rendered PNG has duplicate structural chunks: {path.name}")
    if b"IDAT" not in chunk_types:
        raise ValueError(f"Rendered PNG has no image data: {path.name}")

    ihdr_length = struct.unpack(">I", canonical[8:12])[0]
    ihdr_data = bytes(canonical[16 : 16 + ihdr_length])
    if ihdr_length != 13:
        raise ValueError(f"Rendered PNG has an invalid IHDR: {path.name}")
    width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", ihdr_data
    )
    if (width, height) != expected_size or (bit_depth, color_type) != (8, 6):
        raise ValueError(f"Rendered PNG is not the expected RGBA8 size: {path.name}")
    if (compression, filtering, interlace) != (0, 0, 0):
        raise ValueError(f"Rendered PNG uses unsupported encoding settings: {path.name}")

    path.write_bytes(canonical)
