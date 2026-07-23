# Reconstruction upstream record

AF-045 uses pinned upstream software and separately provisioned model files. It
does not import a sibling checkout and does not commit model weights or generated
meshes.

## TripoSR

- Source: <https://github.com/VAST-AI-Research/TripoSR>
- Source revision: `d26e33181947bbbc4c6fc0f5734e1ec6c080956e`
- Source license: MIT, retained as `LICENSE.triposr`
- Model: <https://huggingface.co/stabilityai/TripoSR>
- Model revision: `5b521936b01fbe1890f6f9baed0254ab6351c04a`
- Model terms recorded upstream: MIT
- Expected checkpoint SHA-256:
  `429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee`

Local modifications are limited to three reviewable patches: pinning the DINO
configuration revision with a cache-only lookup, replacing TorchMCubes with
the pinned CPU PyMCubes adapter, and keeping unused `rembg`/`imageio` utility
imports lazy. Animated Fabric uses an owned CLI instead of upstream `run.py`,
omits Gradio and automatic background removal, requires an already prepared
RGBA cutout, writes an immutable candidate manifest, and refuses runtime
networking.

## DINO configuration

- Model/config source: <https://huggingface.co/facebook/dino-vitb16>
- Revision: `f205d5d8e640a89a2b8ef0369670dfc37cc07fc2`
- Runtime file: `config.json` only
- Expected SHA-256:
  `b87c0270b97db085fd82cf114a761fd0f62ae7914fbd407c752a2260646b689c`

The TripoSR checkpoint contains the learned tokenizer state. The separate DINO
artifact supplies only its architecture configuration.

## PyMCubes

- Source: <https://github.com/pmneila/PyMCubes>
- Package: `PyMCubes==0.1.6`
- Linux CPython 3.12 wheel SHA-256:
  `ea366a2064af0846093e0ad3f9035e375f4b14b62bb565c95dcc8dcaf78308a5`
- License: BSD-3-Clause, retained as `LICENSE.pymcubes`
- Purpose: CPU marching-cubes extraction after TripoSR computes the density
  field on the GPU

Animated Fabric replaces TripoSR's TorchMCubes adapter with the pinned
PyMCubes wheel. This removes the CUDA compiler toolchain from the image,
reduces downloads and peak VRAM, and preserves model inference on the GPU.

## PyTorch runtime

- Package: `torch==2.2.2+cu118`
- Index: <https://download.pytorch.org/whl/cu118>
- Runtime: CPython 3.12, Linux/amd64
- Wheel bytes: `819120631`
- Wheel SHA-256:
  `c0fa31b79d2c06012422e4ed4ed08a86179615463647ac5c44c8f6abef1d4aec`
- Purpose: TripoSR inference on the NVIDIA GPU without a CUDA compiler image

The CUDA 11.8 userspace runtime is supplied by the official PyTorch wheel. The
host NVIDIA driver is mounted by Docker and remains outside the image. The
Docker build retrieves the wheel through resumable ranges in a BuildKit cache,
then verifies the published byte count and SHA-256 before installation.

The reconstruction image is internal development tooling. Redistribution
requires a fresh dependency inventory, corresponding notices, and image scan.
