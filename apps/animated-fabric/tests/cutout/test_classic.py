from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from tools.cutout.pipeline import run_cutout
from tools.cutout.types import CutoutOptions


def _write_flat_subject(path: Path, color: tuple[int, int, int] = (220, 40, 40)) -> None:
    image = Image.new("RGB", (32, 32), (250, 250, 250))
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 8, 21, 25), fill=color)
    image.save(path)


def test_classic_removes_connected_flat_background_without_modifying_source(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.png"
    _write_flat_subject(source)
    original = source.read_bytes()

    result = run_cutout(
        source,
        CutoutOptions(
            engine="classic",
            edge_softness=0,
            alpha_floor=0,
            alpha_ceiling=255,
            decontaminate=False,
        ),
    )

    assert source.read_bytes() == original
    assert result.rgba.mode == "RGBA"
    assert result.rgba.size == (32, 32)
    assert result.alpha.getpixel((0, 0)) == 0
    assert result.alpha.getpixel((16, 16)) == 255
    assert result.diagnostics["engine"] == "classic"
    assert result.diagnostics["removed_pixels"] == 32 * 32 - 12 * 18


def test_cutout_result_writes_pngs_atomically_without_temp_files(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    _write_flat_subject(source)
    result = run_cutout(source, CutoutOptions(engine="classic", edge_softness=0))

    output = tmp_path / "result.png"
    alpha = tmp_path / "alpha.png"
    mask = tmp_path / "mask.png"
    result.save(output, alpha_output=alpha, mask_output=mask)

    for path, mode in ((output, "RGBA"), (alpha, "L"), (mask, "L")):
        with Image.open(path) as image:
            assert image.format == "PNG"
            assert image.mode == mode
    assert not list(tmp_path.glob(".*.tmp"))
