# Caatuu development and operations

The authoritative development environment is Docker. Windows is used for Git,
editing, inspection, and invoking the repository-owned containers; project
dependencies are not installed directly on the host.

## Prerequisites

- Docker Desktop with Linux containers
- Git
- An NVIDIA-compatible Docker runtime only for GPU-backed ML work

Run commands from the repository root:

```powershell
cd C:\Work\caatuu
```

## Daily local runtime

Build the locked Rust release only after server or image-definition changes:

```powershell
docker compose build caatuu
```

Start the existing image without rebuilding:

```powershell
docker compose up -d caatuu
```

`caatuu` is opt-in through only the `local` profile. Explicitly naming it, as
above, activates it. Its restart policy is `no`, so it does not return after
Docker Desktop or the computer restarts. It is for deliberate loopback
development and APK/API tests, never public hosting.

Useful operations:

```powershell
docker compose logs -f caatuu
docker compose restart caatuu
docker compose ps
docker compose stop caatuu
```

`docker compose restart` restarts an existing container with its existing
configuration; it does not apply changes from `compose.yaml`. After an
intentional service-configuration change, use the explicit `docker compose up
-d caatuu` command above and let Compose recreate the service if required.

Set noisier Rust logs before recreating the service:

```powershell
$env:CAATUU_RUST_LOG = "debug"
docker compose up -d --build caatuu
```

The normal server binds only to Windows loopback at port `8765`. Open:

```text
http://127.0.0.1:8765/
http://127.0.0.1:8765/cz/
http://127.0.0.1:8765/cz/index.html
http://127.0.0.1:8765/cz/chat.html
http://127.0.0.1:8765/zh/
http://127.0.0.1:8765/zh/index.html?game=word-net
http://127.0.0.1:8765/es/
http://127.0.0.1:8765/es/index.html?game=verb-lab
http://127.0.0.1:8765/es/index.html?game=word-net
http://127.0.0.1:8765/games/caatuu-game/
```

Backend or dependency changes require a rebuild. Static browser files are
mounted read-only and normally need only a reload.

The Mandarin and Spanish routes are unlisted, `noindex` development previews;
the launcher's release-capable language collection remains Czech-only. Runtime
startup verifies every shared Transformers/MiniLM artifact against
`apps/language-runtime/embedding-runtimes.json` before serving any browser
course. Missing or mismatched model-only assets are a deployment failure, not a
silent semantic-search downgrade.

These routes describe checked-in local browser availability. Mandarin is in the
current public Pages snapshot; Spanish is not publicly deployed and remains
withheld while its release-license review is pending.

## Public hosting boundary

Public traffic uses GitHub Pages, the `caatuu-reporting` Worker, and the pinned
GitHub Release described in `STATIC_WEB_HOSTING.md`. The former Cloudflare
Tunnel is retired: Compose has no tunnel profile or connector service, and the
runtime image does not install `cloudflared`. Do not restore the old token,
watchdog, DNS resolver workaround, or forwarding process as a shortcut.

The standalone `caatuu-game` remains a local browser preview unless its own
release gates are completed. The Minerals project is independent; its private
port `7979` must never be added to Caatuu Compose or public routes.

## Repository-only Chinese archive

The deprecated Chinese trainer remains under `archive/caatuu-chinese` for
historical reference only. It has no runtime mount, route, backend override, or
secret configuration. Use `/zh/` for the current Mandarin course; `/zh-hans/*`
is a compatibility redirect only.

## Tooling container

Heavy build, ML, embedding, model-export, Android helper, and Animated Fabric
work runs in the single shared development service:

```powershell
docker compose --profile dev up -d --build caatuu-dev
docker compose exec caatuu-dev bash
```

Inside the container:

```bash
check-caatuu-dev
```

Animated Fabric selects its baked Python 3.12 tool environment through the
wrapper while retaining the same repository mount and container:

```powershell
docker exec -w /workspace/apps/animated-fabric caatuu-dev `
  caatuu-animated-fabric python -m animated_fabric doctor
```

GPU and native-X11 overrides modify this same service in the same `caatuu`
Compose project; they do not define additional development containers:

```powershell
docker compose -f compose.yaml -f compose/dev-gpu.yaml --profile dev config --quiet
docker compose -f compose.yaml -f compose/dev-gui.yaml --profile dev config --quiet
```

The main ML workspace is [`tools/czech-ml`](../tools/czech-ml/). Follow
its README and task-specific runbooks rather than assembling host-side Python
or Node environments.

## Android builds

Android command-line tools and build dependencies belong to the maintained
container workflow under [`apps/android/tooling`](../apps/android/tooling/).
Development APKs are written to the ignored `artifacts/android/` directory.
The current Android bundle contains Czech and Mandarin. Spanish declares
`platforms.android.enabled: false` and remains browser-only until a separate
Android asset and release decision.

Phone-debug exposure is a deliberate trusted-LAN override:

```powershell
$env:CAATUU_PHONE_DEBUG_BIND = "192.0.2.10"
docker compose -f compose.yaml -f compose/phone-debug.yaml up -d --force-recreate caatuu
```

Replace the example with the PC's trusted LAN IPv4. Do not use `0.0.0.0`.

## Validation

Validate Compose configuration:

```powershell
docker compose config --quiet
docker compose --profile tools --profile dev config --quiet
docker compose -f compose.yaml -f compose/dev-gpu.yaml --profile dev config --quiet
docker compose -f compose.yaml -f compose/dev-gui.yaml --profile dev config --quiet
docker compose -f compose.yaml -f compose/phone-debug.yaml config --quiet
```

Run repository and browser/runtime contract tests in a container:

```powershell
docker exec -w /workspace caatuu-dev bash -lc `
  "node tools/repository/check-tracked-files.mjs && node tools/repository/check-markdown-links.mjs && node --test apps/server/tooling/tests/*.test.mjs"
```

Reviewed game data is validated by the browser/runtime contract suite. New or
changed language data requires human language review before active-course
promotion or approved pronunciation guidance. A disclosed development course
may be packaged before that review when its distribution licensing and all
other applicable release gates are clear.

After route, browser shell, packaged asset, or Android changes, start the local
runtime and run the boundary audit in the established dev container:

```powershell
docker exec -w /workspace caatuu-dev `
  node apps/server/tooling/audit-runtime-boundary.mjs `
  --base-url http://host.docker.internal:8765 `
  --allow-debug-artifacts
```

The audit verifies route ownership, retired legacy paths, packaged browser
assets, Android manifests, APK contents, and release-channel metadata.

## Secrets and generated files

Never commit:

- `.env` files, API keys, tunnel tokens, signing material, or keystores;
- `artifacts/`, build outputs, dependency directories, or runtime logs;
- model caches, training batches, downloaded dictionaries, or local databases
  unless an explicit Git exception documents a required runtime payload;
- raw demo research inputs or generated candidate workspaces.

Run `git status --short` before every commit and investigate any unexpectedly
large binary rather than assuming it belongs in source control.
