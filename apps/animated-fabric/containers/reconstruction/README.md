# Reconstruction container

This internal-only Linux/CUDA image owns the AF-045 TripoSR feasibility spike.
It is independent from the base application, cutout, and Blender images.

- Build-time networking fetches immutable TripoSR source and pinned Python wheels.
- `prefetch` is the only runtime command allowed to download model files.
- `doctor` and `reconstruct` operate with networking disabled.
- Inputs are mounted read-only, model snapshots read-only, and candidates are
  written only beneath the ignored reconstruction workspace.
- The image contains no server, public port, Docker socket, GUI, or product
  entry point.

The upstream patches pin the DINO configuration revision, force a cache-only
lookup, and move marching-cubes extraction to the pinned PyMCubes CPU wheel.
PyTorch's pinned `2.2.2+cu118` CPython 3.12 wheel supplies the userspace CUDA
runtime, while Docker mounts the host driver. This avoids a multi-gigabyte CUDA
compiler image and reduces peak GPU pressure without moving model inference off
the GPU. The TripoSR checkpoint already contains the DINO weights; only the
pinned architecture configuration is provisioned separately.
