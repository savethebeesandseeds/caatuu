# TripoSR reconstruction tooling

AF-045 uses TripoSR only in the internal, optional reconstruction research
image.

## Exact sources

- TripoSR repository: <https://github.com/VAST-AI-Research/TripoSR>
- TripoSR source revision:
  `d26e33181947bbbc4c6fc0f5734e1ec6c080956e`
- TripoSR model repository: <https://huggingface.co/stabilityai/TripoSR>
- TripoSR model revision:
  `5b521936b01fbe1890f6f9baed0254ab6351c04a`
- DINO configuration repository: <https://huggingface.co/facebook/dino-vitb16>
- DINO revision: `f205d5d8e640a89a2b8ef0369670dfc37cc07fc2`
- PyTorch package: `2.2.2+cu118` for CPython 3.12/Linux
- PyTorch wheel SHA-256:
  `c0fa31b79d2c06012422e4ed4ed08a86179615463647ac5c44c8f6abef1d4aec`
- PyMCubes repository: <https://github.com/pmneila/PyMCubes>
- PyMCubes package: `0.1.6`
- PyMCubes CPython 3.12 Linux wheel SHA-256:
  `ea366a2064af0846093e0ad3f9035e375f4b14b62bb565c95dcc8dcaf78308a5`

TripoSR's MIT text is retained at
[`tools/reconstruction/LICENSE.triposr`](../../tools/reconstruction/LICENSE.triposr).
PyMCubes' BSD-3-Clause text is retained at
[`tools/reconstruction/LICENSE.pymcubes`](../../tools/reconstruction/LICENSE.pymcubes).
The full integration and modification record is
[`tools/reconstruction/UPSTREAM.md`](../../tools/reconstruction/UPSTREAM.md).

## Local changes

The image applies three source patches: DINO configuration lookup uses the
exact revision above and `local_files_only=True`; CPU PyMCubes replaces the
upstream TorchMCubes extraction adapter; and optional `rembg`/`imageio` imports
remain lazy because their utility paths are not used. GPU model inference is
unchanged. Animated Fabric supplies its own non-server CLI, deterministic
cutout normalization, immutable output publication, model integrity checks,
and provenance manifest. Upstream Gradio, automatic background removal, video
rendering, and texture baking are not used.

## Distribution status

The image is internal-only. Model weights are separately provisioned into a
named Docker volume and mounted read-only during offline inference. Neither the
image, cache, nor generated GLB candidates are approved release artifacts.

Before distributing the image, generate a complete dependency/SBOM inventory,
retain all required notices and corresponding source obligations, scan the
image, and review the exact model and generated-output terms again.
