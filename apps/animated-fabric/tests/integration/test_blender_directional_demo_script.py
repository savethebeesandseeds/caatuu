"""Host-orchestration contract tests for the fixed AF-053 Blender demo."""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_SOURCE = APP_ROOT / "scripts" / "run_blender_directional_demo.sh"

pytestmark = pytest.mark.skipif(
    platform.system() != "Linux" or os.geteuid() == 0,
    reason="The AF-053 host orchestrator requires a non-root Linux environment.",
)


def _prepare_app(tmp_path: Path) -> tuple[Path, Path, dict[str, str], Path]:
    app_root = tmp_path / "animated-fabric"
    script_root = app_root / "scripts"
    script_root.mkdir(parents=True)
    script = script_root / SCRIPT_SOURCE.name
    shutil.copy2(SCRIPT_SOURCE, script)
    script.chmod(0o755)
    (app_root / "compose.yaml").write_text("name: af053-test\nservices: {}\n", encoding="utf-8")

    binary_root = tmp_path / "bin"
    binary_root.mkdir()
    log_path = tmp_path / "docker.log"
    host_python_marker = tmp_path / "host-python-was-called"

    fake_docker = binary_root / "docker"
    fake_docker.write_text(
        """#!/usr/bin/env bash
set -eu
command_line="$*"
printf '%s\n' "$command_line" >> "$FAKE_DOCKER_LOG"

if [[ "$command_line" == *"--entrypoint /usr/bin/id animated-fabric-blender -u"* ]]; then
  printf '%s\n' "${FAKE_WORKER_UID:-1001}"
fi

if [[ -n "${FAKE_DOCKER_FAIL_MATCH:-}" && "$command_line" == *"$FAKE_DOCKER_FAIL_MATCH"* ]]; then
  exit 17
fi

if [[ "$command_line" == *"animated-fabric-blender --out /output/af053-demo"* ]]; then
  evidence="$FAKE_APP_ROOT/workspaces/blender/af053-demo"
  rm -rf -- "$evidence"
  mkdir -p -- "$evidence/walk"
  printf 'directional\n' > "$evidence/directional-prerender.json"
  printf 'provenance\n' > "$evidence/provenance.json"
fi

if [[ "$command_line" == *"scripts/package_blender_walk_demo.py"* ]]; then
  review="$FAKE_APP_ROOT/workspaces/blender/af053-demo-review"
  rm -rf -- "$review"
  mkdir -p -- "$review"
  printf 'contact-sheet\n' > "$review/walk_contact_sheet.png"
  printf 'review-gif\n' > "$review/walk_review.gif"
fi

if [[ "$command_line" == *"scripts/package_blender_directional_export.py"* ]]; then
  product="$FAKE_APP_ROOT/workspaces/blender/af053-product"
  rm -rf -- "$product"
  mkdir -p -- "$product"
  printf 'spritesheet\n' > "$product/walk.png"
  printf 'metadata\n' > "$product/walk.spritesheet.json"
fi
""",
        encoding="utf-8",
    )
    fake_docker.chmod(0o755)

    for executable in ("python", "python3"):
        fake_python = binary_root / executable
        fake_python.write_text(
            """#!/usr/bin/env bash
printf 'called\n' > "$FAKE_HOST_PYTHON_MARKER"
exit 99
""",
            encoding="utf-8",
        )
        fake_python.chmod(0o755)

    environment = os.environ.copy()
    environment.update(
        {
            "FAKE_APP_ROOT": str(app_root),
            "FAKE_DOCKER_LOG": str(log_path),
            "FAKE_HOST_PYTHON_MARKER": str(host_python_marker),
            "PATH": f"{binary_root}{os.pathsep}{environment['PATH']}",
        }
    )
    return app_root, script, environment, host_python_marker


def _run(
    app_root: Path,
    script: Path,
    environment: dict[str, str],
    *arguments: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(script), *arguments],
        cwd=app_root,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )


def _commands(environment: dict[str, str]) -> list[str]:
    log_path = Path(environment["FAKE_DOCKER_LOG"])
    return log_path.read_text(encoding="utf-8").splitlines() if log_path.exists() else []


def _stage(command: str) -> str:
    if command.endswith("--profile blender config --quiet"):
        return "config"
    if "--profile blender build animated-fabric-dev animated-fabric-blender" in command:
        return "build"
    if "--entrypoint /usr/bin/id animated-fabric-blender -u" in command:
        return "uid"
    if "animated-fabric-blender --out /output/af053-demo" in command:
        return "render"
    if "scripts/verify_blender_directional_goldens.py" in command:
        return "golden"
    if "scripts/package_blender_walk_demo.py" in command:
        return "review"
    if "scripts/package_blender_directional_export.py" in command:
        return "product"
    raise AssertionError(f"Unexpected Docker command: {command}")


def _published_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


@pytest.mark.parametrize(
    ("arguments", "expected_stages"),
    [
        (
            (),
            ("config", "build", "uid", "render", "golden", "review", "product"),
        ),
        (
            ("--skip-build",),
            ("config", "uid", "render", "golden", "review", "product"),
        ),
    ],
)
def test_demo_script_runs_fixed_container_stages_and_publishes_outputs(
    tmp_path: Path,
    arguments: tuple[str, ...],
    expected_stages: tuple[str, ...],
) -> None:
    app_root, script, environment, host_python_marker = _prepare_app(tmp_path)
    prior_review = app_root / "workspaces" / "blender" / "af053-demo-review"
    prior_review.mkdir(parents=True)
    (prior_review / "old.txt").write_text("old", encoding="utf-8")

    completed = _run(app_root, script, environment, *arguments)

    assert completed.returncode == 0, completed.stderr
    commands = _commands(environment)
    assert tuple(_stage(command) for command in commands) == expected_stages
    assert all("/var/run/docker.sock" not in command for command in commands)
    assert "--source workspaces/blender/af053-demo" in commands[-3]
    assert "--out workspaces/blender/af053-demo-review" in commands[-2]
    assert "--out workspaces/blender/af053-product" in commands[-1]
    assert not host_python_marker.exists()

    evidence = app_root / "workspaces" / "blender" / "af053-demo"
    product = app_root / "workspaces" / "blender" / "af053-product"
    review = app_root / "workspaces" / "blender" / "af053-demo-review"
    assert not (evidence / "review").exists()
    assert _published_bytes(product) == {
        "walk.png": b"spritesheet\n",
        "walk.spritesheet.json": b"metadata\n",
    }
    assert _published_bytes(review) == {
        "walk_contact_sheet.png": b"contact-sheet\n",
        "walk_review.gif": b"review-gif\n",
    }
    assert not tuple((app_root / "workspaces" / "blender").glob(".af053-*.backup.*"))
    assert "AF-053 SHA-256 results:" in completed.stdout
    assert len(re.findall(r"(?m)^[0-9a-f]{64}  ", completed.stdout)) == 6
    assert "AF-053 end-to-end directional demo completed successfully." in completed.stdout


@pytest.mark.parametrize(
    ("failure_match", "expected_stages"),
    [
        (
            "scripts/verify_blender_directional_goldens.py",
            ("config", "build", "uid", "render", "golden"),
        ),
        (
            "scripts/package_blender_directional_export.py",
            ("config", "build", "uid", "render", "golden", "review", "product"),
        ),
    ],
)
def test_demo_script_short_circuits_and_preserves_the_prior_product(
    tmp_path: Path,
    failure_match: str,
    expected_stages: tuple[str, ...],
) -> None:
    app_root, script, environment, _marker = _prepare_app(tmp_path)
    product = app_root / "workspaces" / "blender" / "af053-product"
    product.mkdir(parents=True)
    (product / "previous.txt").write_bytes(b"previous")
    before = _published_bytes(product)
    environment["FAKE_DOCKER_FAIL_MATCH"] = failure_match

    completed = _run(app_root, script, environment)

    assert completed.returncode == 17
    assert tuple(_stage(command) for command in _commands(environment)) == expected_stages
    assert _published_bytes(product) == before
    assert "completed successfully" not in completed.stdout


def test_demo_script_help_and_unknown_arguments_do_not_touch_docker_or_workspace(
    tmp_path: Path,
) -> None:
    app_root, script, environment, _marker = _prepare_app(tmp_path)

    help_result = _run(app_root, script, environment, "--help")
    unknown_result = _run(app_root, script, environment, "--unexpected")

    assert help_result.returncode == 0
    assert "Usage:" in help_result.stdout
    assert unknown_result.returncode == 2
    assert "Unknown argument: --unexpected" in unknown_result.stderr
    assert _commands(environment) == []
    assert not (app_root / "workspaces").exists()


def test_demo_script_rejects_a_symlinked_workspace_before_docker(
    tmp_path: Path,
) -> None:
    app_root, script, environment, _marker = _prepare_app(tmp_path)
    workspace_parent = app_root / "workspaces"
    workspace_parent.mkdir()
    external_workspace = tmp_path / "external-workspace"
    external_workspace.mkdir()
    (workspace_parent / "blender").symlink_to(external_workspace, target_is_directory=True)

    completed = _run(app_root, script, environment)

    assert completed.returncode == 2
    assert "must not be symbolic links" in completed.stderr
    assert _commands(environment) == []


def test_demo_script_rejects_a_root_blender_worker_before_rendering(tmp_path: Path) -> None:
    app_root, script, environment, _marker = _prepare_app(tmp_path)
    environment["FAKE_WORKER_UID"] = "0"

    completed = _run(app_root, script, environment, "--skip-build")

    assert completed.returncode == 2
    assert "must run with a non-root numeric UID" in completed.stderr
    assert tuple(_stage(command) for command in _commands(environment)) == ("config", "uid")
    assert not (app_root / "workspaces" / "blender" / "af053-demo").exists()
