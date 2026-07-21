"""Tests for deterministic Blender PNG canonicalization."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import pytest
from PIL import Image

from tools.blender.png_canonical import PNG_SIGNATURE, canonicalize_rgba_png


def _chunk(chunk_type: bytes, data: bytes) -> bytes:
    checksum = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", checksum)


def _rgba_png(*, note: bytes = b"Date\x002026/07/21 12:00:00") -> bytes:
    header = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    pixels = zlib.compress(b"\x00\x18\x34\x56\xff", level=9)
    return b"".join(
        (
            PNG_SIGNATURE,
            _chunk(b"IHDR", header),
            _chunk(b"tEXt", note),
            _chunk(b"IDAT", pixels),
            _chunk(b"IEND", b""),
        )
    )


def test_canonicalization_strips_changing_text_without_changing_pixels(tmp_path: Path) -> None:
    first = tmp_path / "first.png"
    second = tmp_path / "second.png"
    first.write_bytes(_rgba_png(note=b"RenderTime\x0000:00.31"))
    second.write_bytes(_rgba_png(note=b"RenderTime\x0000:00.84"))

    canonicalize_rgba_png(first, expected_size=(1, 1))
    canonicalize_rgba_png(second, expected_size=(1, 1))

    assert first.read_bytes() == second.read_bytes()
    with Image.open(first) as decoded:
        assert decoded.mode == "RGBA"
        assert decoded.size == (1, 1)
        assert decoded.getpixel((0, 0)) == (24, 52, 86, 255)


@pytest.mark.parametrize("suffix", [b"trailing", b"\x00"])
def test_canonicalization_rejects_trailing_data_without_rewriting(
    tmp_path: Path, suffix: bytes
) -> None:
    target = tmp_path / "frame.png"
    original = _rgba_png() + suffix
    target.write_bytes(original)

    with pytest.raises(ValueError, match="trailing data"):
        canonicalize_rgba_png(target, expected_size=(1, 1))

    assert target.read_bytes() == original


def test_canonicalization_rejects_corrupt_checksum_without_rewriting(tmp_path: Path) -> None:
    target = tmp_path / "frame.png"
    original = bytearray(_rgba_png())
    original[-5] ^= 1
    target.write_bytes(original)

    with pytest.raises(ValueError, match="invalid checksum"):
        canonicalize_rgba_png(target, expected_size=(1, 1))

    assert target.read_bytes() == original


def test_canonicalization_rejects_unexpected_size(tmp_path: Path) -> None:
    target = tmp_path / "frame.png"
    original = _rgba_png()
    target.write_bytes(original)

    with pytest.raises(ValueError, match="expected RGBA8 size"):
        canonicalize_rgba_png(target, expected_size=(2, 1))

    assert target.read_bytes() == original
