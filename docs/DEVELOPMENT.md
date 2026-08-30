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

## Daily runtime

Build the locked Rust release and start the runtime:

```powershell
docker compose up -d --build caatuu
```

After the image exists, start without rebuilding:

```powershell
docker compose up -d caatuu
```

Useful operations:

```powershell
docker compose logs -f caatuu
docker compose restart caatuu
docker compose ps
docker compose down
```

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
http://127.0.0.1:8765/games/caatuu-game/
```

Backend or dependency changes require a rebuild. Static browser files are
mounted read-only and normally need only a reload.

The Mandarin routes are an unlisted, `noindex` development preview;
the public launcher remains Czech-only. Runtime startup verifies every shared
Transformers/MiniLM artifact against
`apps/language-runtime/embedding-runtimes.json` before serving either course.
Missing or mismatched model-only assets are a deployment failure, not a silent
semantic-search downgrade.

## Public tunnel

The public app and Android update routes use a named Cloudflare Tunnel. Store
its token in the ignored `secrets/` directory:

```powershell
New-Item -ItemType Directory -Force secrets
$token = Read-Host "Cloudflare tunnel token"
Set-Content -NoNewline -Path secrets\cloudflared-token -Value $token
Remove-Variable token
```

Start the runtime and tunnel:

```powershell
docker compose --profile tunnel up -d --build caatuu caatuu-tunnel
```

The canonical connector pins its Cloudflare edge transport to HTTP/2 over TCP
port `7844`. On the Windows/Docker path, QUIC could pass its startup checks and
then lose every edge connection; automatic selection repeatedly chose QUIC
again after the 60-second watchdog restarted the connector. Treat this
transport choice as part of the public-availability contract. Any change must
update the focused tunnel-resilience test and pass a sustained connectivity
check beyond the watchdog window.

Edge discovery also uses Cloudflare's `1.1.1.1:53` and `1.0.0.1:53`
resolvers directly. This bypasses Docker's embedded `127.0.0.11` resolver,
which repeatedly returned false `no such host` and `server misbehaving`
responses for Cloudflare's edge-discovery record. Keep both explicit resolvers
unless a replacement is validated from inside the tunnel container.

`caatuu-game` is a browser-only development preview and is enabled locally by
default. Disable it for an application-only public release before recreating
the runtime and tunnel:

```powershell
$env:CAATUU_ENABLE_CAATUU_GAME_PREVIEW = "0"
docker compose --profile tunnel up -d --build caatuu caatuu-tunnel
```

When the preview is enabled, the tunnel fails closed because the game and some
of its dependencies remain preview-only. Its watchdog rechecks that policy
after startup. An eventual public game preview must first pass the explicit
gate with `docker exec -w /workspace caatuu-dev node apps/games/tooling/check-release-readiness.mjs --surface public-tunnel --require-game caatuu-game`.

Recreate only the connector after token or tunnel-command changes:

```powershell
docker compose --profile tunnel up -d --force-recreate caatuu-tunnel
```

The named tunnel expects `http://localhost:9172` as the Caatuu origin. The
tunnel service also preserves the existing Minerals forward to host port
`7979`; that service remains owned by `C:\Work\Science\Minerals`.

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
changed language data still requires human language review before release.

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
