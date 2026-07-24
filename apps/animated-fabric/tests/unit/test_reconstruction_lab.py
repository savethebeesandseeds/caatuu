"""Contracts for the isolated AF-045 reconstruction research plane."""

from __future__ import annotations

import hashlib
import importlib
import json
import re
import sys
from contextlib import nullcontext
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest
from PIL import Image

from tools.reconstruction import (
    DINO_MODEL_ID,
    DINO_MODEL_REVISION,
    TRIPOSR_MODEL_ID,
    TRIPOSR_MODEL_REVISION,
)
from tools.reconstruction.candidate import (
    _capture_source_identity,
    _require_source_unchanged,
    _translate_cuda_oom,
    normalize_cutout,
    run_triposr,
    validate_candidate_id,
)
from tools.reconstruction.cli import _triposr_runtime_status, build_parser, main
from tools.reconstruction.errors import (
    CandidateExistsError,
    ReconstructionError,
    UnsafePathError,
)
from tools.reconstruction.integrity import ExpectedFile, ModelSpec, load_model_specs
from tools.reconstruction.prefetch import prefetch_model
from tools.reconstruction.provision import main as provision_main

APP_ROOT = Path(__file__).resolve().parents[2]
PATCH_HUNK_PATTERN = re.compile(r"^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@")


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
        assert kwargs["max_workers"] == 2
        assert kwargs["etag_timeout"] == 30
        assert kwargs["resume_download"] is True
        snapshot.mkdir(parents=True)
        (snapshot / "model.bin").write_bytes(payload)
        return str(snapshot)

    assert prefetch_model(spec, cache_dir=tmp_path, downloader=downloader) == snapshot


def test_prefetch_supports_new_hub_without_legacy_resume_keyword(tmp_path: Path) -> None:
    payload = b"automatic resume"
    spec = ModelSpec(
        model_id="example/current-hub",
        revision="2" * 40,
        files=(
            ExpectedFile(
                path="model.bin",
                bytes=len(payload),
                sha256=hashlib.sha256(payload).hexdigest(),
            ),
        ),
    )
    snapshot = tmp_path / "models--example--current-hub" / "snapshots" / spec.revision

    def downloader(
        repo_id: str,
        *,
        revision: str,
        repo_type: str,
        allow_patterns: list[str],
        cache_dir: str,
        local_files_only: bool,
        max_workers: int,
    ) -> str:
        assert repo_id == spec.model_id
        assert revision == spec.revision
        assert repo_type == "model"
        assert allow_patterns == ["model.bin"]
        assert cache_dir == str(tmp_path)
        assert local_files_only is False
        assert max_workers == 2
        snapshot.mkdir(parents=True)
        (snapshot / "model.bin").write_bytes(payload)
        return str(snapshot)

    assert prefetch_model(spec, cache_dir=tmp_path, downloader=downloader) == snapshot


def test_fixed_provisioner_reports_verified_snapshots(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    snapshot = tmp_path / "snapshot"
    monkeypatch.setattr(
        "tools.reconstruction.provision.prefetch_all_models",
        lambda cache_dir: (snapshot,) if cache_dir == tmp_path else (),
    )
    monkeypatch.setenv("ANIMATED_FABRIC_MODEL_CACHE", str(tmp_path))

    assert provision_main() == 0
    assert capsys.readouterr().out == f"Prefetched and verified: {snapshot}\n"


def test_fixed_provisioner_translates_download_failure(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def fail(_cache_dir: Path) -> tuple[Path, ...]:
        raise RuntimeError("simulated transfer failure")

    monkeypatch.setattr("tools.reconstruction.provision.prefetch_all_models", fail)

    assert provision_main() == 2
    assert capsys.readouterr().err == "Error: RuntimeError: simulated transfer failure\n"


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


def test_cutout_normalization_rejects_dimensions_before_decoding(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "oversized.png"
    source.write_bytes(b"bounded placeholder")
    opened = MagicMock()
    opened.width = 4097
    opened.height = 1
    opened.__enter__.return_value = opened
    monkeypatch.setattr(Image, "open", MagicMock(return_value=opened))

    with pytest.raises(ReconstructionError, match="4096 px"):
        normalize_cutout(source, tmp_path / "output.png")

    opened.load.assert_not_called()


def test_cuda_oom_is_translated_to_actionable_reconstruction_error() -> None:
    class OutOfMemoryError(RuntimeError):
        pass

    cuda = SimpleNamespace(
        OutOfMemoryError=OutOfMemoryError,
        empty_cache=MagicMock(),
    )
    torch_module = SimpleNamespace(cuda=cuda, inference_mode=nullcontext)

    with (
        pytest.raises(ReconstructionError, match="new candidate ID") as captured,
        _translate_cuda_oom(torch_module),
    ):
        raise OutOfMemoryError("simulated")

    assert isinstance(captured.value.__cause__, OutOfMemoryError)
    cuda.empty_cache.assert_called_once_with()


def test_source_identity_is_relative_and_rejects_mid_run_changes(tmp_path: Path) -> None:
    input_root = tmp_path / "input"
    source = input_root / "nested" / "subject.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"first")

    identity = _capture_source_identity(source.resolve(), input_root)

    assert identity.relative_path == "nested/subject.png"
    assert identity.bytes == 5
    source.write_bytes(b"other")
    with pytest.raises(ReconstructionError, match="changed while"):
        _require_source_unchanged(source.resolve(), identity)


@pytest.mark.parametrize(
    "candidate_id",
    ("../escape", "Uppercase", "has space", "", "a" * 65),
)
def test_candidate_id_rejects_unsafe_values(candidate_id: str) -> None:
    with pytest.raises(UnsafePathError):
        validate_candidate_id(candidate_id)


def test_run_triposr_rejects_outside_root_before_creating_output(tmp_path: Path) -> None:
    input_root = tmp_path / "input"
    input_root.mkdir()
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"not inspected")
    output_root = tmp_path / "output"

    with pytest.raises(UnsafePathError, match="escapes the read-only root"):
        run_triposr(
            input_path=outside,
            input_root=input_root,
            output_root=output_root,
            candidate_id="outside-r1",
            model_cache=tmp_path / "models",
        )

    assert not output_root.exists()


def test_run_triposr_rejects_symlink_input_before_creating_output(tmp_path: Path) -> None:
    input_root = tmp_path / "input"
    input_root.mkdir()
    source = input_root / "source.png"
    source.write_bytes(b"not inspected")
    linked = input_root / "linked.png"
    linked.symlink_to(source.name)
    output_root = tmp_path / "output"

    with pytest.raises(UnsafePathError, match="one regular file"):
        run_triposr(
            input_path=linked,
            input_root=input_root,
            output_root=output_root,
            candidate_id="linked-r1",
            model_cache=tmp_path / "models",
        )

    assert not output_root.exists()


def test_run_triposr_preserves_existing_candidate_without_loading_models(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    input_root = tmp_path / "input"
    input_root.mkdir()
    source = input_root / "source.png"
    source.write_bytes(b"bounded source")
    destination = tmp_path / "output" / "existing-r1"
    destination.mkdir(parents=True)
    sentinel = destination / "sentinel.bin"
    sentinel.write_bytes(b"immutable")
    require_models = MagicMock()
    monkeypatch.setattr(
        "tools.reconstruction.candidate.require_all_models",
        require_models,
    )

    with pytest.raises(CandidateExistsError, match="existing-r1"):
        run_triposr(
            input_path=source,
            input_root=input_root,
            output_root=destination.parent,
            candidate_id="existing-r1",
            model_cache=tmp_path / "models",
        )

    assert sentinel.read_bytes() == b"immutable"
    assert sorted(path.name for path in destination.iterdir()) == ["sentinel.bin"]
    assert sorted(path.name for path in destination.parent.iterdir()) == ["existing-r1"]
    require_models.assert_not_called()


def test_run_triposr_removes_staging_directory_when_preprocessing_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    input_root = tmp_path / "input"
    input_root.mkdir()
    source = input_root / "source.png"
    source.write_bytes(b"bounded source")
    output_root = tmp_path / "output"
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    monkeypatch.setattr(
        "tools.reconstruction.candidate.require_all_models",
        lambda _cache: {TRIPOSR_MODEL_ID: snapshot},
    )

    def fail_normalization(
        _source: Path,
        destination: Path,
        *,
        foreground_ratio: float,
    ) -> dict[str, int | float]:
        assert foreground_ratio == 0.85
        destination.write_bytes(b"partial normalized input")
        raise ReconstructionError("simulated preprocessing failure")

    monkeypatch.setattr(
        "tools.reconstruction.candidate.normalize_cutout",
        fail_normalization,
    )

    with pytest.raises(ReconstructionError, match="simulated preprocessing failure"):
        run_triposr(
            input_path=source,
            input_root=input_root,
            output_root=output_root,
            candidate_id="failed-r1",
            model_cache=tmp_path / "models",
        )

    assert output_root.is_dir()
    assert list(output_root.iterdir()) == []


def test_run_triposr_publishes_only_canonical_candidate_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    input_root = tmp_path / "input"
    input_root.mkdir()
    source = input_root / "macaw.png"
    source_image = Image.new("RGBA", (80, 60), (0, 0, 0, 0))
    source_image.paste((20, 120, 200, 255), (20, 10, 60, 50))
    source_image.save(source)
    output_root = tmp_path / "output"
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    monkeypatch.setattr(
        "tools.reconstruction.candidate.require_all_models",
        lambda _cache: {TRIPOSR_MODEL_ID: snapshot},
    )

    class FakeMesh:
        vertices = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
        faces = ((0, 1, 2),)

        def export(self, path: Path, *, file_type: str) -> None:
            assert file_type == "glb"
            path.write_bytes(b"mock vertex-colored GLB")

    renderer = SimpleNamespace(set_chunk_size=MagicMock())
    model = MagicMock()
    model.renderer = renderer
    model.return_value = ("scene-code",)
    model.extract_mesh.return_value = [FakeMesh()]
    tsr_type = SimpleNamespace(from_pretrained=MagicMock(return_value=model))
    tsr_package = ModuleType("tsr")
    tsr_package.__path__ = []
    tsr_system = ModuleType("tsr.system")
    tsr_system.TSR = tsr_type

    cuda = SimpleNamespace(
        OutOfMemoryError=RuntimeError,
        empty_cache=MagicMock(),
        get_device_name=MagicMock(return_value="Mock GPU"),
        is_available=MagicMock(return_value=True),
        max_memory_allocated=MagicMock(return_value=123_456),
        reset_peak_memory_stats=MagicMock(),
    )
    torch_module = ModuleType("torch")
    torch_module.__version__ = "2.2.2+cu118"
    torch_module.cuda = cuda
    torch_module.inference_mode = nullcontext
    torch_module.version = SimpleNamespace(cuda="11.8")
    monkeypatch.setitem(sys.modules, "torch", torch_module)
    monkeypatch.setitem(sys.modules, "tsr", tsr_package)
    monkeypatch.setitem(sys.modules, "tsr.system", tsr_system)
    ticks = iter((100.0, 101.25))
    monkeypatch.setattr(
        "tools.reconstruction.candidate.time.perf_counter",
        lambda: next(ticks),
    )

    destination = run_triposr(
        input_path=source,
        input_root=input_root,
        output_root=output_root,
        candidate_id="macaw-r1",
        model_cache=tmp_path / "models",
        chunk_size=2048,
        mc_resolution=192,
        foreground_ratio=0.8,
    )

    assert destination == output_root / "macaw-r1"
    assert sorted(path.name for path in destination.iterdir()) == [
        "candidate.json",
        "input.png",
        "mesh.glb",
    ]
    assert sorted(path.name for path in output_root.iterdir()) == ["macaw-r1"]
    assert (destination / "mesh.glb").read_bytes() == b"mock vertex-colored GLB"
    manifest_bytes = (destination / "candidate.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    assert manifest_bytes == (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    assert manifest["candidate_id"] == "macaw-r1"
    assert manifest["source"]["path"] == "macaw.png"
    assert manifest["source"]["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert manifest["preprocessing"]["output"] == "input.png"
    assert manifest["preprocessing"]["foreground_ratio"] == 0.8
    assert manifest["mesh"] == {
        "bytes": len(b"mock vertex-colored GLB"),
        "media_type": "model/gltf-binary",
        "path": "mesh.glb",
        "sha256": hashlib.sha256(b"mock vertex-colored GLB").hexdigest(),
        "triangles": 1,
        "vertices": 3,
    }
    assert manifest["parameters"]["chunk_size"] == 2048
    assert manifest["parameters"]["mc_resolution"] == 192
    assert manifest["runtime"] == {
        "cuda_version": "11.8",
        "elapsed_seconds": 1.25,
        "gpu_name": "Mock GPU",
        "peak_cuda_bytes": 123_456,
        "torch_version": "2.2.2+cu118",
    }
    tsr_type.from_pretrained.assert_called_once_with(
        str(snapshot),
        config_name="config.yaml",
        weight_name="model.ckpt",
    )
    renderer.set_chunk_size.assert_called_once_with(2048)
    model.to.assert_called_once_with("cuda:0")
    model.assert_called_once()
    model.extract_mesh.assert_called_once_with(
        ("scene-code",),
        True,
        resolution=192,
    )


def test_doctor_is_offline_and_reports_missing_cache(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["doctor", "--model-cache", str(tmp_path)]) == 2

    output = capsys.readouterr().out
    assert "stabilityai/TripoSR@" in output
    assert "facebook/dino-vitb16@" in output
    assert "missing" in output


@pytest.mark.parametrize("option", ("--input-root", "--output-root"))
def test_reconstruct_cli_does_not_expose_fixed_mount_roots(option: str) -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(
            [
                "reconstruct",
                "/input/subject.png",
                "--candidate-id",
                "subject-r1",
                option,
                "/tmp",
            ]
        )


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
    assert "TRANSFORMERS_CACHE: /tmp/transformers" in runtime
    assert "gpus: all" in runtime
    assert "network_mode: none" not in provision
    assert 'HF_HUB_OFFLINE: "0"' in provision
    assert "target: model-provisioner" in provision
    assert "caatuu-animated-fabric-3d-lab-provision:hub-1.22.0" in provision
    assert 'HF_HUB_DOWNLOAD_TIMEOUT: "300"' in provision
    assert 'HF_XET_HIGH_PERFORMANCE: "1"' in provision
    assert "ANIMATED_FABRIC_CHECKPOINT_STAGING: /staging" in provision
    assert "animated-fabric-reconstruction-direct-staging:/staging" in provision


def test_dockerfile_pins_sources_and_keeps_model_weights_out() -> None:
    dockerfile = (APP_ROOT / "containers/reconstruction/Dockerfile").read_text(encoding="utf-8")
    requirements = (APP_ROOT / "requirements-reconstruction.txt").read_text(encoding="utf-8")
    pymcubes_patch = (
        APP_ROOT / "containers/reconstruction/patches/0002-use-pymcubes-cpu-extraction.patch"
    ).read_text(encoding="utf-8")

    assert "d26e33181947bbbc4c6fc0f5734e1ec6c080956e" in dockerfile
    assert "ARG TRIPOSR_REVISION" not in dockerfile
    assert "PyMCubes-0.1.6" in requirements
    assert "ea366a2064af0846093e0ad3f9035e375f4b14b62bb565c95dcc8dcaf78308a5" in (requirements)
    assert "transformers==4.35.0" in requirements
    assert "tokenizers==0.14.1" in requirements
    assert "huggingface-hub==0.17.3" in requirements
    assert "huggingface-hub==0.19.4" not in requirements
    assert "tools/reconstruction" in dockerfile
    assert "/opt/animated-fabric/tools/reconstruction" in dockerfile
    assert "model.ckpt" not in dockerfile
    assert "USER reconstruction" in dockerfile
    assert "from tsr.system import TSR" in dockerfile
    assert "np.ascontiguousarray(vertices, dtype=np.float32)" in pymcubes_patch
    assert "np.ascontiguousarray(triangles, dtype=np.int64)" in pymcubes_patch


def test_model_provisioner_is_small_pinned_and_separate_from_inference() -> None:
    dockerfile = (APP_ROOT / "containers/reconstruction/Dockerfile").read_text(encoding="utf-8")
    requirements = (APP_ROOT / "requirements-reconstruction-provision.txt").read_text(
        encoding="utf-8"
    )
    provisioner = dockerfile.split(" AS model-provisioner", 1)[1].split(
        " AS triposr-runtime",
        1,
    )[0]

    assert "huggingface-hub==1.22.0" in requirements
    assert "hf-xet==1.5.1" in requirements
    assert "requirements-reconstruction-provision.txt" in provisioner
    assert "tools/reconstruction/provision.py" in provisioner
    assert "tools/reconstruction/candidate.py" not in provisioner
    assert 'ENTRYPOINT ["provision-animated-fabric-models"]' in provisioner
    assert "/staging" in provisioner
    assert "chown -R reconstruction:reconstruction" in provisioner
    assert "torch" not in provisioner.lower()
    assert "git clone" not in provisioner


def test_checkpoint_downloader_is_resumable_and_hash_pinned() -> None:
    downloader = (APP_ROOT / "containers/reconstruction/download_pinned_checkpoint.sh").read_text(
        encoding="utf-8"
    )
    wrapper = (APP_ROOT / "containers/reconstruction/provision_models.sh").read_text(
        encoding="utf-8"
    )

    assert "checkpoint_bytes=1677246742" in downloader
    assert "429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee" in (downloader)
    assert "5b521936b01fbe1890f6f9baed0254ab6351c04a" in downloader
    assert "segment_count=8" in downloader
    assert "--http1.1" in downloader
    assert "--range" in downloader
    assert "attempts > 240" in downloader
    assert "sha256sum" in downloader
    assert "download-pinned-triposr-checkpoint" in wrapper
    assert "exec python -m tools.reconstruction.provision" in wrapper


def test_torch_wheel_download_is_resumable_and_hash_pinned() -> None:
    dockerfile = (APP_ROOT / "containers/reconstruction/Dockerfile").read_text(encoding="utf-8")
    runtime = dockerfile.split(" AS triposr-runtime", 1)[1]
    downloader = (APP_ROOT / "containers/reconstruction/download_pinned_torch.sh").read_text(
        encoding="utf-8"
    )
    requirements = (APP_ROOT / "requirements-reconstruction-torch.txt").read_text(encoding="utf-8")

    assert "torch==2.2.2+cu118" in requirements
    assert "torch-2.2.2%2Bcu118-cp312-cp312-linux_x86_64.whl" in downloader
    assert "wheel_bytes=819120631" in downloader
    assert "c0fa31b79d2c06012422e4ed4ed08a86179615463647ac5c44c8f6abef1d4aec" in (downloader)
    assert "--http1.1" in downloader
    assert "--range" in downloader
    assert "type=cache,id=animated-fabric-torch-2.2.2-cu118-cp312" in dockerfile
    assert runtime.count("type=cache,id=animated-fabric-reconstruction-pip-py312") == 3
    assert runtime.count("PIP_CACHE_DIR=/var/cache/animated-fabric/pip") == 3
    assert 'python -m pip install "pip==25.2"' in runtime
    assert "PIP_RESUME_RETRIES=240" in runtime
    assert "PIP_NO_CACHE_DIR" not in runtime
    assert "from=torch-wheel-fetcher" in runtime
    torch_install = runtime.index("from=torch-wheel-fetcher")
    runtime_requirements = runtime.index(
        "COPY requirements-reconstruction.txt /tmp/requirements-reconstruction.txt"
    )
    assert torch_install < runtime_requirements
    assert "COPY requirements-reconstruction-torch.txt" not in runtime
    dependency_install = runtime.index(
        "python -m pip install --requirement /tmp/requirements-reconstruction.txt"
    )
    source_clone = runtime.index(
        "git clone https://github.com/VAST-AI-Research/TripoSR.git /opt/triposr"
    )
    assert dependency_install < source_clone
    assert runtime[dependency_install:source_clone].count("\nRUN ") == 1


def test_triposr_optional_ui_dependencies_are_lazy() -> None:
    patch = (
        APP_ROOT / "containers/reconstruction/patches/0003-lazy-optional-utility-imports.patch"
    ).read_text(encoding="utf-8")

    assert "-import imageio" in patch
    assert "-import rembg" in patch
    assert "+    import imageio" in patch
    assert "+        import rembg" in patch


def test_triposr_patch_hunk_lengths_are_well_formed() -> None:
    for patch_path in sorted((APP_ROOT / "containers/reconstruction/patches").glob("*.patch")):
        lines = patch_path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            match = PATCH_HUNK_PATTERN.match(line)
            if match is None:
                continue
            expected_old = int(match.group(1) or "1")
            expected_new = int(match.group(2) or "1")
            hunk: list[str] = []
            for candidate in lines[index + 1 :]:
                if candidate.startswith(("@@ ", "diff --git ")):
                    break
                hunk.append(candidate)
            actual_old = sum(item.startswith((" ", "-")) for item in hunk)
            actual_new = sum(item.startswith((" ", "+")) for item in hunk)
            assert (actual_old, actual_new) == (expected_old, expected_new), (
                f"Malformed hunk in {patch_path.name}: {line}"
            )
