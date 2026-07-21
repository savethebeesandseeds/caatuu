"""Tests for the Blender worker output boundary."""

from __future__ import annotations

from pathlib import Path

import pytest

from tools.blender.output_paths import resolve_output_path


def test_output_path_accepts_direct_and_existing_nested_parents(tmp_path: Path) -> None:
    root = tmp_path / "output"
    nested = root / "evidence"
    nested.mkdir(parents=True)

    assert resolve_output_path(Path("demo"), root) == (root, root / "demo")
    assert resolve_output_path(nested / "repeat", root) == (root, nested / "repeat")


@pytest.mark.parametrize("raw", [Path("."), Path("child/.."), Path("../escape")])
def test_output_path_rejects_mount_or_lexical_escape(tmp_path: Path, raw: Path) -> None:
    root = tmp_path / "output"
    (root / "child").mkdir(parents=True)

    with pytest.raises(ValueError):
        resolve_output_path(raw, root)


def test_output_path_rejects_symlink_even_when_target_is_inside_root(tmp_path: Path) -> None:
    root = tmp_path / "output"
    target = root / "target"
    target.mkdir(parents=True)
    alias = root / "alias"
    try:
        alias.symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("Filesystem does not permit symlinks.")

    with pytest.raises(ValueError, match="symbolic link"):
        resolve_output_path(alias, root)
