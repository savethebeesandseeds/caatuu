# Animated Fabric

Animated Fabric is a Linux-first desktop application and Python library for
turning prepared 2D image layers into reusable rigged actors, animation clips,
frames, and spritesheets.

Milestones M0 through M2 and the AF-030/AF-031 importer and template-registry slices are complete.
The application can inspect, confirm, trim, and safely publish prepared PNG layers into a typed
project catalog, then load the validated built-in `humanoid_v1` anatomy from its installed package.
The vertical renderer evaluates typed requests, resolves pose and sockets, plans stable draw order,
loads bounded cached assets, composites premultiplied RGBA through OpenCV, reports clipping, and
atomically writes PNG frames. It does not yet apply the template to imported layers or contain
animation generators, an exporter, a functional editor, or a database.

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
docker compose exec animated-fabric-dev animated-fabric import-layers /path/to/project `
  --direction SE --source /path/to/prepared/SE
docker compose exec animated-fabric-dev animated-fabric import-layers /path/to/project `
  --direction NE --source /path/to/prepared/NE --yes --json
docker compose exec animated-fabric-dev python scripts/generate_fixture_assets.py --out .tmp/fixtures
docker compose exec animated-fabric-dev animated-fabric render-frame `
  .tmp/fixtures/stick_humanoid --direction SE --time-ms 0 --out .tmp/preview.png
```

`import-layers` displays stable filename-to-semantic-part proposals and asks for confirmation.
Use repeatable `--map SOURCE.png=semantic_part` overrides when a filename needs correction; use
`--yes` only after reviewing those mappings. JSON mode returns each proposal as an `AFI010` info
diagnostic before any confirmation error or import result. The target must contain a valid project
manifest, the selected direction must be authored, and every layer must match the project canvas.
Imports accept direct RGBA or indexed-transparent PNGs, preserve exact trim geometry, never replace
an existing source PNG, and save the strict root `layers.manifest.json` catalog. The decision is in
[`docs/decisions/0001-layer-manifest.md`](docs/decisions/0001-layer-manifest.md).

`render-frame` still deliberately accepts the generated `stick_humanoid` project root. The general
catalog and built-in template registry are ready for rig application, but AF-031 does not create
bones, bindings, pivots, or direction profiles before AF-032 defines that use case.
The package-resource schema and deferred choices are recorded in
[`docs/decisions/0002-rig-template-resource.md`](docs/decisions/0002-rig-template-resource.md).

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
docker compose exec animated-fabric-dev python scripts/run_demo_pipeline.py --out .tmp/demo
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

Setuptools and wheel are build-only dependencies retained in the development extra so the
networkless Linux container can build an installable wheel; neither is a runtime application
dependency. Cutout-specific software and model notices are documented separately because the
optional image has a much larger dependency and distribution surface.

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
