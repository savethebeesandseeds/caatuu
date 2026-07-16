from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from tools.cutout.cli import main


def _write_flat_subject(path: Path, color: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (24, 24), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((7, 5, 17, 19), fill=color)
    image.save(path)


def test_image_command_runs_classic_without_ml(tmp_path: Path, capsys) -> None:
    source = tmp_path / "source.png"
    output = tmp_path / "result.png"
    diagnostics = tmp_path / "result.json"
    _write_flat_subject(source, (10, 120, 200))

    exit_code = main(
        [
            "image",
            str(source),
            str(output),
            "--engine",
            "classic",
            "--diagnostics",
            str(diagnostics),
        ]
    )

    assert exit_code == 0
    assert output.is_file()
    assert json.loads(diagnostics.read_text(encoding="utf-8"))["engine"] == "classic"
    assert "Engine:      classic" in capsys.readouterr().out


def test_batch_command_is_sorted_and_writes_extras(tmp_path: Path) -> None:
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    report = tmp_path / "report.json"
    _write_flat_subject(input_dir / "b.png", (200, 20, 40))
    _write_flat_subject(input_dir / "a.png", (20, 180, 60))

    exit_code = main(
        [
            "batch",
            str(input_dir),
            str(output_dir),
            "--engine",
            "classic",
            "--save-extras",
            "--diagnostics",
            str(report),
        ]
    )

    assert exit_code == 0
    payload = json.loads(report.read_text(encoding="utf-8"))
    assert [Path(item["input"]).name for item in payload] == ["a.png", "b.png"]
    for stem in ("a", "b"):
        assert (output_dir / f"{stem}.png").is_file()
        assert (output_dir / f"{stem}_alpha.png").is_file()
        assert (output_dir / f"{stem}_mask.png").is_file()
        assert (output_dir / f"{stem}.json").is_file()
        assert (output_dir / f"{stem}_previews" / "preview_checker.jpg").is_file()


def test_doctor_and_models_do_not_download_or_require_ml(tmp_path: Path, capsys) -> None:
    assert main(["doctor", "--model-cache", str(tmp_path)]) == 0
    doctor_output = capsys.readouterr().out
    assert "python" in doctor_output
    assert "birefnet-cache" in doctor_output
    assert "birefnet-hashes" in doctor_output
    assert "missing" in doctor_output

    assert main(["models"]) == 0
    models_output = capsys.readouterr().out
    assert "classic" in models_output
    assert "birefnet" in models_output
    assert "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4" in models_output


def test_batch_rejects_output_inside_input(tmp_path: Path, capsys) -> None:
    input_dir = tmp_path / "input"
    _write_flat_subject(input_dir / "source.png", (30, 30, 30))

    exit_code = main(["batch", str(input_dir), str(input_dir / "output"), "--engine", "classic"])

    assert exit_code == 2
    assert "must not be inside" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("arguments", "destination_label"),
    [
        (lambda source, output: [str(source)], "output"),
        (
            lambda source, output: [str(output), "--alpha-output", str(source)],
            "alpha output",
        ),
        (
            lambda source, output: [str(output), "--mask-output", str(source)],
            "mask output",
        ),
        (
            lambda source, output: [str(output), "--diagnostics", str(source)],
            "diagnostics",
        ),
        (
            lambda source, output: [str(output), "--preview-dir", str(source)],
            "preview directory",
        ),
    ],
)
def test_image_command_never_replaces_immutable_input(
    tmp_path: Path,
    capsys,
    arguments,
    destination_label: str,
) -> None:
    source = tmp_path / "source.png"
    output = tmp_path / "output.png"
    _write_flat_subject(source, (80, 100, 120))
    original = source.read_bytes()

    exit_code = main(["image", str(source), *arguments(source, output), "--engine", "classic"])

    assert exit_code == 2
    assert source.read_bytes() == original
    assert f"immutable input via {destination_label}" in capsys.readouterr().err


def test_image_command_rejects_duplicate_destinations_before_writing(
    tmp_path: Path, capsys
) -> None:
    source = tmp_path / "source.png"
    output = tmp_path / "output.png"
    _write_flat_subject(source, (80, 100, 120))

    exit_code = main(
        [
            "image",
            str(source),
            str(output),
            "--alpha-output",
            str(output),
            "--engine",
            "classic",
        ]
    )

    assert exit_code == 2
    assert not output.exists()
    assert "resolve to the same path" in capsys.readouterr().err
