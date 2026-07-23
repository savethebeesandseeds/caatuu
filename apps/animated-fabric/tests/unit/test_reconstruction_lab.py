"""Contracts for the isolated AF-045 reconstruction research plane."""

from __future__ import annotations

import hashlib
import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from tools.reconstruction import (
    DINO_MODEL_ID,
    DINO_MODEL_REVISION,
    TRIPOSR_MODEL_ID,
    TRIPOSR_MODEL_REVISION,
)
from tools.reconstruction.candidate import normalize_cutout, validate_candidate_id
from tools.reconstruction.cli import _triposr_runtime_status, main
from tools.reconstruction.errors import ReconstructionError, UnsafePathError
from tools.reconstruction.integrity import ExpectedFile, ModelSpec, load_model_specs
from tools.reconstruction.prefetch import prefetch_model

APP_ROOT = Path(__file__).resolve().parents[2]


def test_model_manifest_pins_complete_runtime_identities() -> None:
    specs = load_model_specs()

    assert [(spec.model_id, spec.revision) for spec in specs] == [
        (TRIPOSR_MODEL_ID, TRIPOSR_MODEL_REVISION),
        (DINO_MODEL_ID, DINO_MODEL_REVISION),
    ]
    assert [expected.path for expected in specs[0].files] == ["config.yaml", "model.ckpt"]
    assert [expected.path for expected in specs[1].files] == ["config.json"]
    assert specs[0].files[1].bytes == 1_677_246_742


def test_prefetch_requires_exact_downloaded_bytes(tmp_path: Path) -> None:
    payload = b"pinned model"
    digest = hashlib.sha256(payload).hexdigest()
    spec = ModelSpec(
        model_id="example/model",
        revision="1" * 40,
        files=(ExpectedFile(path="model.bin", bytes=len(payload), sha256=digest),),
    )
    snapshot = tmp_path / "models--example--model" / "snapshots" / spec.revision

    def downloader(**kwargs: object) -> str:
        assert kwargs["revision"] == spec.revision
        assert kwargs["allow_patterns"] == ["model.bin"]
        snapshot.mkdir(parents=True)
        (snapshot / "model.bin").write_bytes(payload)
        return str(snapshot)

    assert prefetch_model(spec, cache_dir=tmp_path, downloader=downloader) == snapshot


def test_cutout_normalization_is_centered_and_deterministic(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    first = tmp_path / "first.png"
    second = tmp_path / "second.png"
    image = Image.new("RGBA", (80, 60), (0, 0, 0, 0))
    image.paste((200, 20, 10, 255), (20, 10, 60, 50))
    image.save(source)

    first_report = normalize_cutout(source, first)
    second_report = normalize_cutout(source, second)

    assert first_report == second_report
    assert first.read_bytes() == second.read_bytes()
    assert first_report["normalized_width"] == first_report["normalized_height"]
    with Image.open(first) as normalized:
        assert normalized.mode == "RGB"
        assert normalized.size == (512, 512)
        assert normalized.getpixel((0, 0)) == (128, 128, 128)


def test_cutout_normalization_rejects_unprepared_opaque_input(tmp_path: Path) -> None:
    source = tmp_path / "opaque.png"
    Image.new("RGB", (64, 64), (255, 255, 255)).save(source)

    with pytest.raises(ReconstructionError, match="fully opaque"):
        normalize_cutout(source, tmp_path / "output.png")


@pytest.mark.parametrize(
    "candidate_id",
    ("../escape", "Uppercase", "has space", "", "a" * 65),
)
def test_candidate_id_rejects_unsafe_values(candidate_id: str) -> None:
    with pytest.raises(UnsafePathError):
        validate_candidate_id(candidate_id)


def test_doctor_is_offline_and_reports_missing_cache(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["doctor", "--model-cache", str(tmp_path)]) == 2

    output = capsys.readouterr().out
    assert "stabilityai/TripoSR@" in output
    assert "facebook/dino-vitb16@" in output
    assert "missing" in output


def test_triposr_runtime_status_imports_exact_inference_entrypoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested: list[str] = []

    def import_module(name: str) -> object:
        requested.append(name)
        return SimpleNamespace(TSR=object())

    monkeypatch.setattr(importlib, "import_module", import_module)

    assert _triposr_runtime_status() == (True, "imported tsr.system.TSR")
    assert requested == ["tsr.system"]


def test_triposr_runtime_status_reports_transitive_import_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def import_module(name: str) -> object:
        assert name == "tsr.system"
        raise ModuleNotFoundError("No module named 'rembg'")

    monkeypatch.setattr(importlib, "import_module", import_module)

    available, detail = _triposr_runtime_status()

    assert available is False
    assert detail == "ModuleNotFoundError: No module named 'rembg'"


def test_compose_keeps_provisioning_and_offline_inference_separate() -> None:
    compose = (APP_ROOT / "compose.yaml").read_text(encoding="utf-8")

    assert "animated-fabric-3d-lab:" in compose
    assert "animated-fabric-3d-lab-provision:" in compose
    assert "./workspaces/reconstruction/input:/input:ro" in compose
    assert "animated-fabric-reconstruction-models:/models:ro" in compose
    runtime = compose.split("  animated-fabric-3d-lab:", 1)[1].split(
        "  animated-fabric-3d-lab-provision:",
        1,
    )[0]
    provision = compose.split("  animated-fabric-3d-lab-provision:", 1)[1].split(
        "\nvolumes:",
        1,
    )[0]
    assert "network_mode: none" in runtime
    assert 'HF_HUB_OFFLINE: "1"' in runtime
    assert "gpus: all" in runtime
    assert "network_mode: none" not in provision
    assert 'HF_HUB_OFFLINE: "0"' in provision


def test_dockerfile_pins_sources_and_keeps_model_weights_out() -> None:
    dockerfile = (APP_ROOT / "containers/reconstruction/Dockerfile").read_text(encoding="utf-8")
    requirements = (APP_ROOT / "requirements-reconstruction.txt").read_text(encoding="utf-8")

    assert "d26e33181947bbbc4c6fc0f5734e1ec6c080956e" in dockerfile
    assert "PyMCubes-0.1.6" in requirements
    assert "ea366a2064af0846093e0ad3f9035e375f4b14b62bb565c95dcc8dcaf78308a5" in (requirements)
    assert "tools/reconstruction" in dockerfile
    assert "/opt/animated-fabric/tools/reconstruction" in dockerfile
    assert "model.ckpt" not in dockerfile
    assert "USER reconstruction" in dockerfile
    assert "from tsr.system import TSR" in dockerfile


def test_torch_wheel_download_is_resumable_and_hash_pinned() -> None:
    dockerfile = (APP_ROOT / "containers/reconstruction/Dockerfile").read_text(encoding="utf-8")
    downloader = (APP_ROOT / "containers/reconstruction/download_pinned_torch.sh").read_text(
        encoding="utf-8"
    )
    requirements = (APP_ROOT / "requirements-reconstruction-torch.txt").read_text(encoding="utf-8")

    assert "torch==2.2.2+cu118" in requirements
    assert "torch-2.2.2%2Bcu118-cp312-cp312-linux_x86_64.whl" in downloader
    assert "wheel_bytes=819120631" in downloader
    assert "c0fa31b79d2c06012422e4ed4ed08a86179615463647ac5c44c8f6abef1d4aec" in (downloader)
    assert "--range" in downloader
    assert "type=cache,id=animated-fabric-torch-2.2.2-cu118-cp312" in dockerfile
    assert "from=torch-wheel-fetcher" in dockerfile


def test_triposr_optional_ui_dependencies_are_lazy() -> None:
    patch = (
        APP_ROOT / "containers/reconstruction/patches/0003-lazy-optional-utility-imports.patch"
    ).read_text(encoding="utf-8")

    assert "-import imageio" in patch
    assert "-import rembg" in patch
    assert "+    import imageio" in patch
    assert "+        import rembg" in patch
