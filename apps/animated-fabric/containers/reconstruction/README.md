# Reconstruction container

These internal-only Linux images own the AF-045 TripoSR feasibility spike.
They are independent from the base application, cutout, and Blender images.

- Build-time networking fetches immutable TripoSR source and only
  version-and-SHA-locked Python artifacts for Linux x86-64 / CPython 3.12.
  Debian packages are not snapshot-locked, so future OCI byte identity is not
  claimed.
- The small provisioner has the only network-enabled runtime and contains no
  inference code. Its resumable range staging is never mounted by inference.
- `doctor` and `reconstruct` operate with networking disabled.
- Inputs are mounted read-only, model snapshots read-only, and candidates are
  written only beneath the ignored reconstruction workspace.
- Neither image contains a server, public port, Docker socket, GUI, or product
  entry point.

The upstream patches pin the DINO configuration revision, force a cache-only
lookup, and move marching-cubes extraction to the pinned PyMCubes CPU wheel.
PyTorch's pinned `2.2.2+cu118` CPython 3.12 wheel supplies the userspace CUDA
runtime, while Docker mounts the host driver. This avoids a multi-gigabyte CUDA
compiler image and reduces peak GPU pressure without moving model inference off
the GPU. The TripoSR checkpoint already contains the DINO weights; only the
pinned architecture configuration is provisioned separately.
