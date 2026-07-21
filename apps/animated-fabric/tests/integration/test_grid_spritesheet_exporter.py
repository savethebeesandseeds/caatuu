"""AF-051 integration tests for deterministic grid spritesheet export."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from PIL import Image

from animated_fabric.application.exporting import (
    AnimationExportResult,
    CancellationToken,
    ExportRequest,
    ExportResult,
    GridAnimationExportResult,
)
from animated_fabric.application.rendering import (
    ClippingEdges,
    RenderedFrame,
    RenderProject,
    RenderRequest,
)
from animated_fabric.domain.animation import AnimationClip, AnimationEvent
from animated_fabric.domain.exceptions import ExportError, ExportFailureKind, RenderError
from animated_fabric.domain.export import GridSpritesheetMetadata
from animated_fabric.domain.geometry import IntSize, Vec2
from animated_fabric.domain.project import Direction
from animated_fabric.infrastructure.exporters import FrameSequenceExporter, GridSpritesheetExporter
from animated_fabric.infrastructure.exporters import grid_spritesheet_exporter as grid_module
from animated_fabric.infrastructure.fixtures import (
    build_stick_humanoid_manifest,
    build_stick_humanoid_rig,
)


def _clip(
    *,
    clip_id: str = "walk",
    duration_ms: int = 1000,
    events: tuple[AnimationEvent, ...] = (),
) -> AnimationClip:
    return AnimationClip(
        format="animated-fabric.animation-clip.v1",
        schema_version="0.1.0",
        clip_id=clip_id,
        display_name=clip_id.replace("_", " ").title(),
        template_id="humanoid_v1",
        duration_ms=duration_ms,
        loop=False,
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


class _Renderer:
    def __init__(self, *, clipped: bool = False, fail_at: int | None = None) -> None:
        self.clipped = clipped
        self.fail_at = fail_at
        self.requests: list[RenderRequest] = []

    def render(self, request: RenderRequest) -> RenderedFrame:
        self.requests.append(request)
        if self.fail_at is not None and len(self.requests) == self.fail_at:
            raise RenderError("simulated grid renderer failure")
        direction_value = 17 if request.direction is Direction.SE else 29
        time_value = int(request.time_ms) % 256
        rgba = bytes((direction_value, time_value, 73, 127)) * (192 * 192)
        return RenderedFrame(
            canvas_size=IntSize(width=192, height=192),
            rgba=rgba,
            ground_anchor=Vec2(x=96.0, y=160.0),
            resolved_sockets={},
            active_events=(),
            clipping=ClippingEdges(right=self.clipped),
        )


class _UnexpectedRenderer:
    def render(self, request: RenderRequest) -> RenderedFrame:
        del request
        raise RuntimeError("simulated unexpected grid renderer failure")


class _TamperingFrameExporter(FrameSequenceExporter):
    def __init__(self, renderer: _Renderer, *, tamper: str) -> None:
        super().__init__(renderer)
        self._tamper = tamper

    def export(self, request: ExportRequest) -> ExportResult[AnimationExportResult]:
        result = super().export(request)
        animation = result.animations[0]
        if self._tamper == "metadata":
            metadata_path = result.destination / animation.metadata_path
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            payload["fps"] += 1
            metadata_path.write_text(
                json.dumps(payload, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
                newline="\n",
            )
        elif self._tamper == "frame_size":
            with Image.new("RGBA", (1, 1), (1, 2, 3, 4)) as image:
                image.save(result.destination / animation.frame_paths[0], format="PNG")
        elif self._tamper == "directory":
            (result.destination / animation.animation / "unexpected").mkdir()
        elif self._tamper == "metadata_symlink":
            metadata_path = result.destination / animation.metadata_path
            payload = metadata_path.read_bytes()
            metadata_path.unlink()
            target = result.destination / "metadata-target.json"
            target.write_bytes(payload)
            metadata_path.symlink_to(Path("..") / target.name)
        else:
            raise AssertionError(f"Unknown tamper mode: {self._tamper}")
        return result


class _Cancellation:
    def __init__(self, cancel_on_check: int) -> None:
        self.cancel_on_check = cancel_on_check
        self.checks = 0

    def is_cancelled(self) -> bool:
        self.checks += 1
        return self.checks >= self.cancel_on_check


class _CancelAfterSheetWritten:
    def __init__(self, destination: Path) -> None:
        self._destination = destination

    def is_cancelled(self) -> bool:
        return any(
            (stage / "walk.png").is_file()
            for stage in self._destination.parent.glob(f".{self._destination.name}.stage-*")
        )


def _request(
    tmp_path: Path,
    *,
    destination: Path | None = None,
    animations: tuple[AnimationClip, ...] | None = None,
    directions: tuple[Direction, ...] = (Direction.SE, Direction.NE),
    fps: int = 3,
    allow_clipping: bool = False,
    cancellation: CancellationToken | None = None,
) -> ExportRequest:
    return ExportRequest(
        project=_project(tmp_path / "project"),
        rig=build_stick_humanoid_rig(),
        animations=animations or (_clip(),),
        directions=directions,
        fps=fps,
        destination=destination or tmp_path / "published" / "actor",
        allow_clipping=allow_clipping,
        cancellation=cancellation,
    )


def _published_bytes(destination: Path) -> dict[str, bytes]:
    return {
        path.relative_to(destination).as_posix(): path.read_bytes()
        for path in sorted(destination.rglob("*"))
        if path.is_file()
    }


def _assert_no_transaction_debris(destination: Path) -> None:
    assert list(destination.parent.glob(f".{destination.name}.stage-*")) == []
    assert list(destination.parent.glob(f".{destination.name}.backup-*")) == []


def test_grid_packs_direction_rows_frame_columns_timing_events_and_alpha(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "published" / "actor"
    clip = _clip(
        events=(
            AnimationEvent(time_ms=0, event="foot_contact_l"),
            AnimationEvent(time_ms=500, event="foot_contact_r"),
        )
    )
    renderer = _Renderer()

    result = GridSpritesheetExporter(renderer).export(
        _request(tmp_path, destination=destination, animations=(clip,))
    )

    assert set(_published_bytes(destination)) == {"walk.png", "walk.spritesheet.json"}
    assert len(result.animations) == 1
    animation_result = result.animations[0]
    assert isinstance(animation_result, GridAnimationExportResult)
    assert animation_result.image_path == Path("walk.png")
    assert animation_result.metadata_path == Path("walk.spritesheet.json")
    assert animation_result.frame_count == 3

    metadata = GridSpritesheetMetadata.model_validate_json(
        (destination / "walk.spritesheet.json").read_bytes()
    )
    assert metadata.directions == (Direction.SE, Direction.NE)
    assert metadata.frames_per_direction == 3
    assert [frame.duration_ms for frame in metadata.frames[:3]] == [333, 333, 334]
    assert [frame.duration_ms for frame in metadata.frames[3:]] == [333, 333, 334]
    assert metadata.frames[0].events == ("foot_contact_l",)
    assert metadata.frames[1].events == ("foot_contact_r",)
    assert metadata.frames[3].events == ("foot_contact_l",)
    assert metadata.frames[4].events == ("foot_contact_r",)
    assert tuple(frame.rect for frame in metadata.frames) == (
        (0, 0, 192, 192),
        (192, 0, 192, 192),
        (384, 0, 192, 192),
        (0, 192, 192, 192),
        (192, 192, 192, 192),
        (384, 192, 192, 192),
    )

    with Image.open(destination / "walk.png") as sheet:
        sheet.load()
        assert sheet.format == "PNG"
        assert sheet.mode == "RGBA"
        assert sheet.size == (576, 384)
        assert sheet.getpixel((10, 10)) == (17, 0, 73, 127)
        assert sheet.getpixel((202, 10)) == (17, 77, 73, 127)
        assert sheet.getpixel((394, 10)) == (17, 154, 73, 127)
        assert sheet.getpixel((10, 202)) == (29, 0, 73, 127)
        assert sheet.getpixel((202, 202)) == (29, 77, 73, 127)
        assert sheet.getpixel((394, 202)) == (29, 154, 73, 127)

    assert len(renderer.requests) == 6
    _assert_no_transaction_debris(destination)


def test_grid_repeated_export_is_byte_identical_and_removes_stale_files(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "published" / "actor"
    request = _request(
        tmp_path,
        destination=destination,
        animations=(
            _clip(clip_id="idle", duration_ms=1000),
            _clip(clip_id="walk", duration_ms=1500),
        ),
        fps=2,
    )
    exporter = GridSpritesheetExporter(_Renderer())

    first = exporter.export(request)
    first_bytes = _published_bytes(destination)
    first_hashes = {
        path: hashlib.sha256(payload).hexdigest() for path, payload in first_bytes.items()
    }
    (destination / "stale.txt").write_text("stale", encoding="utf-8")

    second = exporter.export(request)
    second_bytes = _published_bytes(destination)
    second_hashes = {
        path: hashlib.sha256(payload).hexdigest() for path, payload in second_bytes.items()
    }

    assert set(second_bytes) == {
        "idle.png",
        "idle.spritesheet.json",
        "walk.png",
        "walk.spritesheet.json",
    }
    assert second_hashes == first_hashes
    assert first == second
    assert not (destination / "stale.txt").exists()
    with Image.open(destination / "idle.png") as idle, Image.open(destination / "walk.png") as walk:
        assert idle.size == (384, 384)
        assert walk.size == (576, 384)
    _assert_no_transaction_debris(destination)


@pytest.mark.parametrize(
    ("renderer", "cancellation", "directions", "expected_kind"),
    [
        (_Renderer(clipped=True), None, (Direction.SE,), ExportFailureKind.CLIPPING),
        (_Renderer(fail_at=2), None, (Direction.SE,), ExportFailureKind.RENDER),
        (_Renderer(), _Cancellation(5), (Direction.SE,), ExportFailureKind.CANCELLED),
        (_Renderer(), None, (Direction.SW,), ExportFailureKind.INVALID_PROFILE),
    ],
)
def test_grid_failures_preserve_previous_destination_and_remove_staging(
    tmp_path: Path,
    renderer: _Renderer,
    cancellation: _Cancellation | None,
    directions: tuple[Direction, ...],
    expected_kind: ExportFailureKind,
) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    marker = destination / "previous.txt"
    marker.write_bytes(b"previous")

    with pytest.raises(ExportError) as captured:
        GridSpritesheetExporter(renderer).export(
            _request(
                tmp_path,
                destination=destination,
                directions=directions,
                cancellation=cancellation,
            )
        )

    assert captured.value.kind is expected_kind
    assert marker.read_bytes() == b"previous"
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_grid_unexpected_failure_still_removes_owned_staging(tmp_path: Path) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")

    with pytest.raises(RuntimeError, match="unexpected grid renderer failure"):
        GridSpritesheetExporter(_UnexpectedRenderer()).export(
            _request(tmp_path, destination=destination)
        )

    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_grid_cancellation_is_observed_during_cell_verification(tmp_path: Path) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")

    with pytest.raises(ExportError) as captured:
        GridSpritesheetExporter(_Renderer()).export(
            _request(
                tmp_path,
                destination=destination,
                cancellation=_CancelAfterSheetWritten(destination),
            )
        )

    assert captured.value.kind is ExportFailureKind.CANCELLED
    assert captured.value.location is not None
    assert captured.value.location.startswith("verify:")
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


@pytest.mark.parametrize(
    "tamper",
    ["metadata", "frame_size", "directory", "metadata_symlink"],
)
def test_grid_rejects_a_tampered_intermediate_contract(
    tmp_path: Path,
    tamper: str,
) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")
    renderer = _Renderer()
    exporter = GridSpritesheetExporter(
        renderer,
        _TamperingFrameExporter(renderer, tamper=tamper),
    )

    with pytest.raises(ExportError) as captured:
        exporter.export(_request(tmp_path, destination=destination))

    assert captured.value.kind is ExportFailureKind.VERIFICATION
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_grid_rejects_failed_intermediate_removal(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "published" / "actor"
    destination.mkdir(parents=True)
    (destination / "previous.txt").write_text("previous", encoding="utf-8")
    original_discard = grid_module.discard_export_staging

    def retain_intermediate(path: Path) -> None:
        if path.name == ".frame-sequences":
            return
        original_discard(path)

    monkeypatch.setattr(grid_module, "discard_export_staging", retain_intermediate)

    with pytest.raises(ExportError) as captured:
        GridSpritesheetExporter(_Renderer()).export(_request(tmp_path, destination=destination))

    assert captured.value.kind is ExportFailureKind.VERIFICATION
    assert _published_bytes(destination) == {"previous.txt": b"previous"}
    _assert_no_transaction_debris(destination)


def test_grid_dimension_limit_fails_before_destination_io(tmp_path: Path) -> None:
    destination = tmp_path / "published" / "actor"
    request = _request(
        tmp_path,
        destination=destination,
        animations=(_clip(duration_ms=342_000),),
        directions=(Direction.SE,),
        fps=1,
    )

    with pytest.raises(ExportError) as captured:
        GridSpritesheetExporter(_Renderer()).export(request)

    assert captured.value.kind is ExportFailureKind.INVALID_PROFILE
    assert "65535" in str(captured.value)
    assert not destination.exists()
    assert not destination.parent.exists()
