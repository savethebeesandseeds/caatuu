"""AF-050 integration tests for transactional frame-sequence export."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from animated_fabric.application.exporting import ExportRequest
from animated_fabric.application.rendering import (
    ClippingEdges,
    RenderedFrame,
    RenderProject,
    RenderRequest,
)
from animated_fabric.domain.animation import AnimationClip, AnimationEvent
from animated_fabric.domain.exceptions import ExportError, ExportFailureKind, RenderError
from animated_fabric.domain.export import FrameSequenceMetadata
from animated_fabric.domain.geometry import IntSize, Vec2
from animated_fabric.domain.project import Direction
from animated_fabric.infrastructure.exporters import FrameSequenceExporter
from animated_fabric.infrastructure.exporters import frame_exporter as frame_exporter_module
from animated_fabric.infrastructure.fixtures import (
    build_stick_humanoid_manifest,
    build_stick_humanoid_rig,
)
from animated_fabric.infrastructure.imaging import PngFrameWriter


def _clip(
    *,
    duration_ms: int = 1000,
    loop: bool = False,
    events: tuple[AnimationEvent, ...] = (),
) -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id="walk",
        display_name="Walk",
        template_id="humanoid_v1",
        duration_ms=duration_ms,
        loop=loop,
        fps_hint=12,
        events=events,
    )


def _project(root: Path) -> RenderProject:
    root.mkdir(parents=True, exist_ok=True)
    return RenderProject(
        root=root,
        manifest=build_stick_humanoid_manifest(),
        assets={},
    )


def _request(
    tmp_path: Path,
    *,
    destination: Path | None = None,
    clip: AnimationClip | None = None,
    directions: tuple[Direction, ...] = (Direction.SE, Direction.NE),
    fps: int = 2,
    allow_clipping: bool = False,
    cancellation: _Cancellation | None = None,
) -> ExportRequest:
    project = _project(tmp_path / "project")
    return ExportRequest(
        project=project,
        rig=build_stick_humanoid_rig(),
        animations=(clip or _clip(),),
        directions=directions,
        fps=fps,
        destination=destination or tmp_path / "published" / "actor",
        allow_clipping=allow_clipping,
        cancellation=cancellation,
    )


class _Renderer:
    def __init__(self, *, clipped: bool = False, fail_at: int | None = None) -> None:
        self.clipped = clipped
        self.fail_at = fail_at
        self.requests: list[RenderRequest] = []

    def render(self, request: RenderRequest) -> RenderedFrame:
        self.requests.append(request)
        if self.fail_at is not None and len(self.requests) == self.fail_at:
            raise RenderError("simulated renderer failure")
        direction_value = 17 if request.direction is Direction.SE else 29
        time_value = int(request.time_ms) % 256
        rgba = bytes((direction_value, time_value, 73, 255)) * (192 * 192)
        return RenderedFrame(
            canvas_size=IntSize(width=192, height=192),
            rgba=rgba,
            ground_anchor=Vec2(x=96.0, y=160.0),
            resolved_sockets={},
            active_events=(),
            clipping=ClippingEdges(right=self.clipped),
        )


class _Cancellation:
    def __init__(self, cancel_on_check: int) -> None:
        self.cancel_on_check = cancel_on_check
        self.checks = 0

    def is_cancelled(self) -> bool:
        self.checks += 1
        return self.checks >= self.cancel_on_check


class _CorruptWriter(PngFrameWriter):
    def write_project_frame(
        self,
        destination: Path,
        frame: RenderedFrame,
        project: RenderProject,
    ) -> None:
        del frame, project
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"not-a-png")


def _published_bytes(destination: Path) -> dict[str, bytes]:
    return {
        path.relative_to(destination).as_posix(): path.read_bytes()
        for path in sorted(destination.rglob("*"))
        if path.is_file()
    }


def _assert_no_transaction_debris(destination: Path) -> None:
    assert list(destination.parent.glob(f".{destination.name}.stage-*")) == []
    assert list(destination.parent.glob(f".{destination.name}.backup-*")) == []


def test_exporter_publishes_verified_tree_and_deterministically_replaces_it(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "published" / "actor"
    request = _request(tmp_path, destination=destination)
    renderer = _Renderer()
    exporter = FrameSequenceExporter(renderer)

    first = exporter.export(request)
    first_bytes = _published_bytes(destination)
    first_hashes = {
        relative: hashlib.sha256(payload).hexdigest() for relative, payload in first_bytes.items()
    }
    (destination / "stale.txt").write_text("old", encoding="utf-8")

    second = exporter.export(request)
    second_bytes = _published_bytes(destination)
    second_hashes = {
        relative: hashlib.sha256(payload).hexdigest() for relative, payload in second_bytes.items()
    }

    assert tuple(first_bytes) == (
        "walk/NE/000.png",
        "walk/NE/001.png",
        "walk/SE/000.png",
        "walk/SE/001.png",
        "walk/animation.json",
    )
    assert second_hashes == first_hashes
    assert not (destination / "stale.txt").exists()
    assert first == second
    assert first.destination == destination.resolve()
    assert first.animations[0].metadata_path == Path("walk/animation.json")
    assert first.animations[0].frame_count == 2
    assert first.animations[0].frame_paths == (
        Path("walk/SE/000.png"),
        Path("walk/SE/001.png"),
        Path("walk/NE/000.png"),
        Path("walk/NE/001.png"),
    )
    assert len(renderer.requests) == 8
    assert all(render_request.include_events for render_request in renderer.requests)
    assert (destination / "walk/animation.json").read_bytes().endswith(b"\n")
    _assert_no_transaction_debris(destination)


def test_backup_preparation_failure_preserves_previous_destination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")
    request = _request(tmp_path, destination=destination)
    original_rmdir = Path.rmdir

    def fail_backup_rmdir(path: Path) -> None:
        if path.name.startswith(".actor.backup-"):
            raise OSError("simulated backup preparation failure")
        original_rmdir(path)

    monkeypatch.setattr(Path, "rmdir", fail_backup_rmdir)

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer()).export(request)

    assert caught.value.kind is ExportFailureKind.PUBLICATION
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_failed_staging_promotion_restores_previous_destination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")
    request = _request(tmp_path, destination=destination)
    original_replace = frame_exporter_module.os.replace

    def fail_staging_promotion(source: Path, target: Path) -> None:
        if Path(source).name.startswith(".actor.stage-") and Path(target) == destination:
            raise OSError("simulated staging promotion failure")
        original_replace(source, target)

    monkeypatch.setattr(frame_exporter_module.os, "replace", fail_staging_promotion)

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer()).export(request)

    assert caught.value.kind is ExportFailureKind.PUBLICATION
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_backup_cleanup_failure_rolls_back_new_destination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")
    request = _request(tmp_path, destination=destination)
    original_rmtree = frame_exporter_module.shutil.rmtree

    def fail_backup_cleanup(path: Path, *args: object, **kwargs: object) -> None:
        if Path(path).name.startswith(".actor.backup-"):
            raise OSError("simulated backup cleanup failure")
        original_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(frame_exporter_module.shutil, "rmtree", fail_backup_cleanup)

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer()).export(request)

    assert caught.value.kind is ExportFailureKind.PUBLICATION
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_metadata_uses_exact_schedule_durations_events_and_order(tmp_path: Path) -> None:
    clip = _clip(
        events=(
            AnimationEvent(time_ms=0, event="start"),
            AnimationEvent(time_ms=249, event="sound:step"),
            AnimationEvent(time_ms=250, event="quarter"),
            AnimationEvent(time_ms=999, event="end"),
            AnimationEvent(time_ms=1000, event="endpoint"),
        )
    )
    request = _request(
        tmp_path,
        clip=clip,
        directions=(Direction.NE, Direction.SE),
        fps=4,
    )

    FrameSequenceExporter(_Renderer()).export(request)

    metadata_path = request.destination / "walk/animation.json"
    metadata = FrameSequenceMetadata.model_validate_json(metadata_path.read_bytes())
    assert metadata.directions == (Direction.NE, Direction.SE)
    assert metadata.frames_per_direction == 4
    assert [frame.duration_ms for frame in metadata.frames] == [250] * 8
    assert [frame.events for frame in metadata.frames[:4]] == [
        ("start", "sound:step"),
        ("quarter",),
        (),
        ("end", "endpoint"),
    ]
    assert metadata.frames[4].events == ("start", "sound:step")
    assert metadata.frames[-1].events == ("end", "endpoint")
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert payload["frame_size"] == [192, 192]
    assert payload["origin"] == [96.0, 160.0]
    assert payload["frames"][0]["image"] == "NE/000.png"


def test_clipping_failure_preserves_previous_destination(tmp_path: Path) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    marker = destination / "previous.txt"
    marker.write_text("previous", encoding="utf-8")
    request = _request(tmp_path, destination=destination)

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer(clipped=True)).export(request)

    assert caught.value.kind is ExportFailureKind.CLIPPING
    assert caught.value.path == "walk/SE/000.png"
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_cancellation_between_frames_preserves_previous_destination(tmp_path: Path) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")
    cancellation = _Cancellation(cancel_on_check=4)
    request = _request(
        tmp_path,
        destination=destination,
        cancellation=cancellation,
    )

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer()).export(request)

    assert caught.value.kind is ExportFailureKind.CANCELLED
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_pre_cancelled_export_performs_no_destination_io(tmp_path: Path) -> None:
    destination = tmp_path / "uncreated-parent" / "actor"
    request = _request(
        tmp_path,
        destination=destination,
        cancellation=_Cancellation(cancel_on_check=1),
    )

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer()).export(request)

    assert caught.value.kind is ExportFailureKind.CANCELLED
    assert caught.value.location == "before export IO"
    assert not destination.parent.exists()
    assert not destination.exists()


def test_renderer_failure_preserves_previous_destination(tmp_path: Path) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")
    request = _request(tmp_path, destination=destination)

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer(fail_at=2)).export(request)

    assert caught.value.kind is ExportFailureKind.RENDER
    assert caught.value.path == "walk/SE/001.png"
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_corrupt_staged_png_is_rejected_before_publication(tmp_path: Path) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")
    request = _request(tmp_path, destination=destination)

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer(), _CorruptWriter()).export(request)

    assert caught.value.kind is ExportFailureKind.VERIFICATION
    assert caught.value.path == "walk/NE/000.png"
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


@pytest.mark.parametrize("relative_destination", [".", "source/out", "exports"])
def test_exporter_rejects_unsafe_project_local_destinations(
    tmp_path: Path,
    relative_destination: str,
) -> None:
    project = _project(tmp_path / "project")
    request = ExportRequest(
        project=project,
        rig=build_stick_humanoid_rig(),
        animations=(_clip(),),
        directions=(Direction.SE,),
        fps=1,
        destination=project.root / relative_destination,
    )

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer()).export(request)

    assert caught.value.kind is ExportFailureKind.DESTINATION


def test_exporter_accepts_named_project_local_export_directory(tmp_path: Path) -> None:
    project = _project(tmp_path / "project")
    destination = project.root / "exports" / "actor"
    request = ExportRequest(
        project=project,
        rig=build_stick_humanoid_rig(),
        animations=(_clip(),),
        directions=(Direction.SE,),
        fps=1,
        destination=destination,
    )

    FrameSequenceExporter(_Renderer()).export(request)

    assert (destination / "walk/SE/000.png").is_file()


def test_exporter_rejects_destination_that_contains_project_root(tmp_path: Path) -> None:
    project = _project(tmp_path / "project")
    request = ExportRequest(
        project=project,
        rig=build_stick_humanoid_rig(),
        animations=(_clip(),),
        directions=(Direction.SE,),
        fps=1,
        destination=tmp_path,
    )

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer()).export(request)

    assert caught.value.kind is ExportFailureKind.DESTINATION
    assert project.root.is_dir()


def test_exporter_rejects_file_destination_and_symlink_ancestor(tmp_path: Path) -> None:
    file_destination = tmp_path / "published-file"
    file_destination.write_text("not a directory", encoding="utf-8")
    file_request = _request(tmp_path, destination=file_destination)

    with pytest.raises(ExportError) as file_error:
        FrameSequenceExporter(_Renderer()).export(file_request)

    assert file_error.value.kind is ExportFailureKind.DESTINATION

    real_parent = tmp_path / "real-parent"
    real_parent.mkdir()
    alias = tmp_path / "output-alias"
    alias.symlink_to(real_parent, target_is_directory=True)
    symlink_request = _request(tmp_path, destination=alias / "actor")

    with pytest.raises(ExportError) as symlink_error:
        FrameSequenceExporter(_Renderer()).export(symlink_request)

    assert symlink_error.value.kind is ExportFailureKind.DESTINATION
    assert not (real_parent / "actor").exists()


def test_mirrored_direction_is_rejected_before_creating_output(tmp_path: Path) -> None:
    destination = tmp_path / "published" / "actor"
    request = _request(
        tmp_path,
        destination=destination,
        directions=(Direction.SW,),
    )

    with pytest.raises(ExportError) as caught:
        FrameSequenceExporter(_Renderer()).export(request)

    assert caught.value.kind is ExportFailureKind.INVALID_PROFILE
    assert caught.value.location == "SW"
    assert not destination.exists()
