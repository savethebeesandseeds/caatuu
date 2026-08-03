from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPOSITORY_ROOT / "tools" / "dev-container" / "check-gpu-readiness.sh"


def _executable(path: Path, source: str) -> Path:
    path.write_text(source, encoding="utf-8")
    path.chmod(0o755)
    return path


def _probe(
    tmp_path: Path,
    *,
    require_nvidia: str,
    nvidia_exit: int,
    cuda_available: bool,
) -> subprocess.CompletedProcess[str]:
    nvidia = _executable(
        tmp_path / "nvidia-smi",
        f"#!/usr/bin/env bash\nexit {nvidia_exit}\n",
    )
    python = _executable(
        tmp_path / "python",
        f"#!/usr/bin/env bash\nprintf '%s\\n' '{str(cuda_available).lower()}'\n",
    )
    environment = {
        **os.environ,
        "CAATUU_GPU_PYTHON": str(python),
        "CAATUU_NVIDIA_SMI": str(nvidia),
        "CAATUU_REQUIRE_NVIDIA": require_nvidia,
    }
    return subprocess.run(
        ["bash", str(CHECK)],
        check=False,
        capture_output=True,
        env=environment,
        text=True,
    )


@pytest.mark.skipif(os.name != "posix", reason="the shared development image is Linux")
def test_gpu_mode_requires_a_working_nvidia_command(tmp_path: Path) -> None:
    result = _probe(
        tmp_path,
        require_nvidia="1",
        nvidia_exit=1,
        cuda_available=True,
    )

    assert result.returncode == 1
    assert "working nvidia-smi" in result.stderr


@pytest.mark.skipif(os.name != "posix", reason="the shared development image is Linux")
def test_gpu_mode_requires_torch_cuda_readiness(tmp_path: Path) -> None:
    result = _probe(
        tmp_path,
        require_nvidia="1",
        nvidia_exit=0,
        cuda_available=False,
    )

    assert result.returncode == 1
    assert "torch.cuda.is_available()" in result.stderr


@pytest.mark.skipif(os.name != "posix", reason="the shared development image is Linux")
def test_gpu_mode_accepts_both_runtime_probes(tmp_path: Path) -> None:
    result = _probe(
        tmp_path,
        require_nvidia="1",
        nvidia_exit=0,
        cuda_available=True,
    )

    assert result.returncode == 0
    assert "torch CUDA readiness" in result.stdout


@pytest.mark.skipif(os.name != "posix", reason="the shared development image is Linux")
def test_cpu_mode_keeps_nvidia_optional(tmp_path: Path) -> None:
    result = _probe(
        tmp_path,
        require_nvidia="0",
        nvidia_exit=1,
        cuda_available=False,
    )

    assert result.returncode == 0
    assert "optional" in result.stdout
