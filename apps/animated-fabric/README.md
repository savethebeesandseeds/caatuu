# Animated Fabric

Animated Fabric is a Linux-first desktop application and Python library for
turning prepared 2D image layers into reusable rigged actors, animation clips,
frames, and spritesheets.

Milestones M0 and M1 are complete, and M2 now includes immutable affine matrices,
stable bone ordering, direction-aware pose resolution, and deterministic animation
evaluation plus an OpenCV premultiplied-alpha compositor. The repository also contains
the installable package, English CLI and GUI shells, deterministic geometric fixtures,
strict data contracts, atomic JSON persistence, structural validation, and a bounded
project asset cache. It does not yet contain an importer, full renderer orchestration,
exporter, functional editor, or database.

The normative contract is [`docs/SPEC.md`](docs/SPEC.md), and verified progress
is recorded in [`docs/STATUS.md`](docs/STATUS.md).

## Repository boundary

The authoritative checkout is:

```text
C:\Work\caatuu\apps\animated-fabric
```

Animated Fabric is an application inside the Caatuu monorepo, but it has its
own dependency and container boundary. Caatuu does not serve this source tree
as web content. Only deliberately promoted export artifacts may be copied into
a Caatuu browser application or demo later.

## Authoritative Linux environment

All productive Python, Qt, OpenCV, fixture, test, rendering, packaging, and
cutout commands run in the repository-owned Linux containers.

The Windows host is limited to Git, text editing, read-only inspection, and
Docker invocation. Do not install project dependencies on Windows and do not
substitute a Codex-bundled Python or Node runtime for the containers.

The infrastructure boundary is explicit:

| Surface | Ownership and isolation |
|---|---|
| `animated-fabric-dev` | Python 3.12/Debian development and test image; non-root, no ports, runtime network disabled |
| `gui` profile | Same owned image with native-Linux X11 socket forwarding; still networkless |
| `cutout-classic` profile | Lightweight Pillow/NumPy cutout image with no model or ML packages |
| `cutout` / `cutout-cuda` profiles | Separate CPU or NVIDIA BiRefNet images; no source checkout and no runtime network |
| `cutout-provision` profile | The only network-enabled runtime action; seeds one pinned, hash-verified model snapshot |
| Named volumes | Independent pip cache and BiRefNet cache owned by this Compose project |
| GitHub Actions | Ubuntu 24.04 builds the same images and never installs project Python packages on the runner |

From this directory, build and start the normal development environment:

```powershell
docker compose up -d --build animated-fabric-dev
```

The image uses Python 3.12 on Debian Bookworm, installs the project editable
with its development dependencies, and runs as the non-root `animatedfabric`
user. The running container has no network access and exposes no ports. Image
construction still requires network access to obtain Debian and Python
packages.

On native Linux, map generated files to the current user when the account is
not UID/GID 1000:

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose build animated-fabric-dev
```

## CLI and GUI

```powershell
docker compose exec animated-fabric-dev python -m animated_fabric --help
docker compose exec animated-fabric-dev animated-fabric version
docker compose exec animated-fabric-dev python -m animated_fabric doctor
docker compose exec animated-fabric-dev python -m animated_fabric validate /path/to/project
docker compose exec animated-fabric-dev python -m animated_fabric validate /path/to/project --json
```

The GUI entry point is `animated-fabric-gui`. Automated tests use
`QT_QPA_PLATFORM=offscreen`. On a native Linux X11 desktop, keep the GUI inside
the project container and forward only the local display socket:

```bash
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose --profile gui run --rm animated-fabric-gui
```

The GUI profile remains networkless and exposes no port. Wayland-only desktops
need an XWayland-compatible display or a deliberately configured Wayland
override; the headless test service does not pretend to be an interactive GUI.

## Quality gate

Run every gate inside Linux:

```powershell
docker compose exec animated-fabric-dev ruff format --check .
docker compose exec animated-fabric-dev ruff check .
docker compose exec animated-fabric-dev mypy src
docker compose exec animated-fabric-dev pytest -q
docker compose exec animated-fabric-dev python -m pip check
docker compose exec animated-fabric-dev python scripts/generate_fixture_assets.py --out .tmp/fixtures
```

GitHub Actions builds the same Linux development image before running these
commands. Native Windows installation is not part of the authoritative
development workflow.

## Self-contained background cutout

Animated Fabric carries a project-local copy of the proven Tukevejtso cutout
method so operators do not need a separate Tukevejtso checkout. The capability
supports a lightweight classic foreground extractor and optional BiRefNet
segmentation with CPU or CUDA.

The cutout engine is isolated from the normal application dependency graph:
Torch, Transformers, CUDA wheels, and model weights are not installed in the
development image. They belong to the optional cutout image and cache. Prepared
layer workflows never require automatic segmentation.

See [`docs/CUTOUT.md`](docs/CUTOUT.md) for provisioning, single-image, batch,
CPU, CUDA, offline-runtime, attribution, and update instructions.

The minimal offline path is:

```bash
mkdir -p workspaces/cutout/input workspaces/cutout/output
docker compose --profile cutout-classic build animated-fabric-cutout-classic
docker compose --profile cutout-classic run --rm animated-fabric-cutout-classic \
  image /input/source.png /output/result.png --engine classic
```

BiRefNet uses a different image and requires one deliberate provisioning run;
normal application setup never downloads the model:

```bash
docker compose --profile cutout-provision run --rm animated-fabric-cutout-prefetch
docker compose --profile cutout run --rm animated-fabric-cutout \
  image /input/source.png /output/result.png --engine birefnet --device cpu
```

## Direct dependencies

The compatibility ranges are defined in `pyproject.toml`. The project records
the resolved Linux environment separately so container rebuilds can be
reproduced deliberately.

| Dependency | Purpose | Upstream license |
|---|---|---|
| Pydantic | strict models and typed operation results | MIT |
| NumPy | matrices and image buffers | BSD-3-Clause with bundled component notices |
| OpenCV headless | affine transforms and future compositing | Apache-2.0 |
| Pillow | PNG input, output, metadata, and fixtures | MIT-CMU |
| PySide6 | desktop GUI | LGPL-3.0-only or GPL alternatives; commercial terms also exist |
| Typer | typed CLI | MIT |
| Rich | CLI presentation | MIT |
| platformdirs | portable local paths | MIT |
| pytest, pytest-cov, pytest-qt | tests and coverage | MIT |
| Ruff | formatting and lint | MIT |
| mypy | static type checking | MIT |
| Hypothesis | property-based testing | MPL-2.0 |

Setuptools and wheel are build-only dependencies. Cutout-specific software and
model notices are documented separately because the optional image has a much
larger dependency and distribution surface.

Container-only system dependencies are also separated: the base image installs
the Debian Qt/OpenGL/XCB libraries needed for offscreen tests and X11 display;
the cutout image installs `libgomp1`; CUDA use additionally requires an NVIDIA
driver and Docker GPU runtime on the Linux host. None of these are installed on
Windows by the project workflow.

The current constraint file pins the resolved Python versions. A hash-locked release
set, Debian snapshot policy, SBOMs, and generated third-party notice reports
remain release gates rather than claims made by this development milestone.

## Stop the environment

```powershell
docker compose down
```

Use `docker compose down --volumes` only when intentionally discarding project
caches. Do not remove model or package volumes as routine cleanup.
