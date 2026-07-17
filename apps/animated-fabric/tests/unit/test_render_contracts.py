"""AF-023 tests for the complete frame application's immutable contracts."""

from __future__ import annotations

from pathlib import Path

import pytest

from animated_fabric.application.render_frame import RENDER_FAILURE_CODE, RenderFrame
from animated_fabric.application.rendering import (
    ClippingEdges,
    RenderedFrame,
    Renderer,
    RenderProject,
    RenderQuality,
    RenderRequest,
)
from animated_fabric.domain.assets import AssetLayer
from animated_fabric.domain.exceptions import RenderError
from animated_fabric.domain.geometry import IntPoint, IntSize, Vec2
from animated_fabric.domain.project import Direction
from animated_fabric.domain.transforms import identity_matrix
from animated_fabric.infrastructure.fixtures import (
    build_stick_humanoid_manifest,
    build_stick_humanoid_rig,
)


def _asset(asset_id: str = "se_body") -> AssetLayer:
    return AssetLayer(
        asset_id=asset_id,
        direction=Direction.SE,
        semantic_part="body",
        path="source/body.png",
        source_canvas_size=IntSize(width=1, height=1),
        trim_origin=IntPoint(x=0, y=0),
        trim_size=IntSize(width=1, height=1),
        sha256="0" * 64,
    )


def _project(root: Path, assets: dict[str, AssetLayer] | None = None) -> RenderProject:
    return RenderProject(
        root=root,
        manifest=build_stick_humanoid_manifest(),
        assets=assets or {},
    )


def _frame() -> RenderedFrame:
    return RenderedFrame(
        canvas_size=IntSize(width=1, height=1),
        rgba=bytes((10, 20, 30, 40)),
        ground_anchor=Vec2(x=0.5, y=1.0),
        resolved_sockets={"hand": identity_matrix()},
        active_events=("footstep",),
        clipping=ClippingEdges(right=True),
    )


def test_render_project_snapshots_assets_and_requires_matching_catalog_ids(
    tmp_path: Path,
) -> None:
    asset = _asset()
    mutable_assets = {asset.asset_id: asset}

    project = _project(tmp_path, mutable_assets)
    mutable_assets.clear()

    assert project.assets == {asset.asset_id: asset}
    with pytest.raises(TypeError):
        project.assets["other"] = asset  # type: ignore[index]
    with pytest.raises(ValueError, match="does not match asset ID"):
        _project(tmp_path, {"other": asset})


@pytest.mark.parametrize("revision", [-1, True, 1.5])
def test_render_project_rejects_invalid_runtime_revisions(
    tmp_path: Path,
    revision: object,
) -> None:
    with pytest.raises((TypeError, ValueError), match="revision"):
        RenderProject(
            root=tmp_path,
            manifest=build_stick_humanoid_manifest(),
            assets={},
            project_revision=revision,  # type: ignore[arg-type]
        )


def test_render_request_normalizes_time_and_retains_explicit_options(tmp_path: Path) -> None:
    request = RenderRequest(
        project=_project(tmp_path),
        rig=build_stick_humanoid_rig(),
        clip=None,
        direction=Direction.NE,
        time_ms=25,
        quality=RenderQuality.NEAREST,
        alpha_threshold=7,
        include_events=True,
    )

    assert request.time_ms == 25.0
    assert isinstance(request.time_ms, float)
    assert request.direction is Direction.NE
    assert request.quality is RenderQuality.NEAREST
    assert request.alpha_threshold == 7
    assert request.include_events is True


@pytest.mark.parametrize("time_ms", [True, float("nan"), float("inf")])
def test_render_request_rejects_non_finite_or_boolean_time(
    tmp_path: Path,
    time_ms: object,
) -> None:
    with pytest.raises((TypeError, ValueError), match="time"):
        RenderRequest(
            project=_project(tmp_path),
            rig=build_stick_humanoid_rig(),
            clip=None,
            direction=Direction.SE,
            time_ms=time_ms,  # type: ignore[arg-type]
        )


def test_rendered_frame_is_byte_exact_and_snapshots_socket_metadata() -> None:
    sockets = {"hand": identity_matrix()}
    frame = RenderedFrame(
        canvas_size=IntSize(width=1, height=1),
        rgba=bytes((10, 20, 30, 40)),
        ground_anchor=Vec2(x=0.5, y=1.0),
        resolved_sockets=sockets,
        active_events=("footstep",),
        clipping=ClippingEdges(right=True),
    )
    sockets.clear()

    assert frame.rgba == bytes((10, 20, 30, 40))
    assert tuple(frame.resolved_sockets) == ("hand",)
    assert frame.active_events == ("footstep",)
    assert frame.clipping.is_clipped
    with pytest.raises(TypeError):
        frame.resolved_sockets["other"] = identity_matrix()  # type: ignore[index]


def test_rendered_frame_rejects_mutable_or_wrong_sized_pixel_data() -> None:
    arguments = {
        "canvas_size": IntSize(width=1, height=1),
        "ground_anchor": Vec2(x=0.0, y=0.0),
        "resolved_sockets": {},
        "active_events": (),
        "clipping": ClippingEdges(),
    }

    with pytest.raises(TypeError, match="immutable bytes"):
        RenderedFrame(rgba=bytearray(4), **arguments)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="exactly 4 bytes"):
        RenderedFrame(rgba=b"\x00\x00\x00", **arguments)


class _StaticRenderer:
    def __init__(self, frame: RenderedFrame) -> None:
        self.frame = frame

    def render(self, request: RenderRequest) -> RenderedFrame:
        del request
        return self.frame


class _FailingRenderer:
    def render(self, request: RenderRequest) -> RenderedFrame:
        del request
        raise RenderError("The selected frame cannot be rendered.")


def test_render_frame_use_case_returns_value_without_presentation_state(tmp_path: Path) -> None:
    request = RenderRequest(
        project=_project(tmp_path),
        rig=build_stick_humanoid_rig(),
        clip=None,
        direction=Direction.SE,
        time_ms=0,
    )
    renderer = _StaticRenderer(_frame())

    result = RenderFrame(renderer).execute(request)

    assert isinstance(renderer, Renderer)
    assert result.value == renderer.frame
    assert result.diagnostics == ()


def test_render_frame_use_case_translates_expected_renderer_failure(tmp_path: Path) -> None:
    request = RenderRequest(
        project=_project(tmp_path),
        rig=build_stick_humanoid_rig(),
        clip=None,
        direction=Direction.SE,
        time_ms=0,
    )

    result = RenderFrame(_FailingRenderer()).execute(request)

    assert result.value is None
    assert len(result.diagnostics) == 1
    assert result.diagnostics[0].code == RENDER_FAILURE_CODE
    assert result.diagnostics[0].message == "The selected frame cannot be rendered."
