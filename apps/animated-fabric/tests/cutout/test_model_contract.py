from __future__ import annotations

from pathlib import Path

import pytest

from tools.cutout.errors import ModelUnavailableError
from tools.cutout.integrity import require_valid_model_snapshot, verify_model_snapshot
from tools.cutout.prefetch import prefetch_model, validate_model_revision
from tools.cutout.providers import birefnet

PINNED_REVISION = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"


class _Device:
    type = "cpu"

    def __str__(self) -> str:
        return "cpu"


class _Model:
    def __init__(self) -> None:
        self.device = None
        self.float_called = False
        self.eval_called = False

    def to(self, device: _Device) -> None:
        self.device = device

    def float(self) -> None:
        self.float_called = True

    def eval(self) -> None:
        self.eval_called = True


class _AutoModel:
    kwargs: dict[str, object] = {}
    model = _Model()

    @classmethod
    def from_pretrained(cls, model_name: str, **kwargs: object) -> _Model:
        cls.kwargs = {"model_name": model_name, **kwargs}
        return cls.model


def test_prefetch_requires_and_passes_an_immutable_revision(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: dict[str, object] = {}

    def fake_download(**kwargs: object) -> str:
        calls.update(kwargs)
        snapshot = tmp_path / "snapshot"
        snapshot.mkdir()
        return str(snapshot)

    monkeypatch.setattr(
        "tools.cutout.prefetch.require_valid_model_snapshot",
        lambda *args, **kwargs: None,
    )
    snapshot = prefetch_model(
        model_name="ZhengPeng7/BiRefNet",
        model_revision=PINNED_REVISION,
        model_cache=tmp_path / "cache",
        downloader=fake_download,
    )

    assert snapshot == tmp_path / "snapshot"
    assert calls["revision"] == PINNED_REVISION
    assert calls["local_files_only"] is False


@pytest.mark.parametrize("revision", ["main", "v1", "abc123", "g" * 40])
def test_nonimmutable_model_revisions_are_rejected(revision: str) -> None:
    with pytest.raises(ValueError, match="full 40-character"):
        validate_model_revision(revision)


def test_runtime_model_loader_is_pinned_and_offline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    birefnet._MODEL_CACHE.clear()
    snapshot = tmp_path / "models--ZhengPeng7--BiRefNet" / "snapshots" / PINNED_REVISION
    snapshot.mkdir(parents=True)
    monkeypatch.setattr(birefnet, "require_valid_model_snapshot", lambda *args, **kwargs: None)
    model = birefnet._load_model(
        object(),
        _AutoModel,
        model_name="ZhengPeng7/BiRefNet",
        model_revision=PINNED_REVISION,
        model_cache=tmp_path,
        device=_Device(),
    )

    assert model is _AutoModel.model
    assert _AutoModel.kwargs["revision"] == PINNED_REVISION
    assert _AutoModel.kwargs["code_revision"] == PINNED_REVISION
    assert _AutoModel.kwargs["trust_remote_code"] is True
    assert _AutoModel.kwargs["local_files_only"] is True
    assert _AutoModel.kwargs["cache_dir"] == str(tmp_path)


def test_runtime_reports_missing_pinned_snapshot(tmp_path: Path) -> None:
    class MissingModel:
        @classmethod
        def from_pretrained(cls, model_name: str, **kwargs: object) -> None:
            raise OSError("not cached")

    birefnet._MODEL_CACHE.clear()
    with pytest.raises(ModelUnavailableError, match="explicit cutout prefetch"):
        birefnet._load_model(
            object(),
            MissingModel,
            model_name="ZhengPeng7/BiRefNet",
            model_revision=PINNED_REVISION,
            model_cache=tmp_path,
            device=_Device(),
        )


def test_integrity_verifier_detects_missing_and_changed_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    files = {
        "config.json": "configuration",
        "model.safetensors": "weights",
    }
    expected = {
        name: __import__("hashlib").sha256(content.encode()).hexdigest()
        for name, content in files.items()
    }
    monkeypatch.setattr(
        "tools.cutout.integrity._manifest",
        lambda: ("ZhengPeng7/BiRefNet", PINNED_REVISION, expected),
    )
    for name, content in files.items():
        (tmp_path / name).write_text(content, encoding="utf-8")

    assert require_valid_model_snapshot(tmp_path).valid

    (tmp_path / "config.json").write_text("tampered", encoding="utf-8")
    (tmp_path / "model.safetensors").unlink()
    report = verify_model_snapshot(tmp_path)
    assert report.mismatched == ("config.json",)
    assert report.missing == ("model.safetensors",)
