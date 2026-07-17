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

The normal runtime binds only to Windows loopback at port `8765`. Open:

```text
http://127.0.0.1:8765/
http://127.0.0.1:8765/cz/
http://127.0.0.1:8765/cz/home.html
http://127.0.0.1:8765/cz/chat.html
http://127.0.0.1:8765/demos/
http://127.0.0.1:8765/archive/chinese/
```

Backend or dependency changes require a rebuild. Static browser files are
mounted read-only and normally need only a reload.

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
docker compose --profile tunnel up -d caatuu caatuu-tunnel
```

Recreate only the connector after token or tunnel-command changes:

```powershell
docker compose --profile tunnel up -d --force-recreate caatuu-tunnel
```

The named tunnel expects `http://localhost:9172` as the Caatuu origin. The
tunnel service also preserves the existing Minerals forward to host port
`7979`; that service remains owned by `C:\Work\Science\Minerals`.

## Archived Chinese backend

Archived pages are visible for reference, but their API and WebSocket routes
are disabled by default. Enable the seed-only archived backend explicitly:

```powershell
docker compose -f compose.yaml -f compose/archived-chinese.yaml up -d --build caatuu
```

OpenAI-backed archive features additionally require an ignored key file:

```powershell
New-Item -ItemType Directory -Force secrets
$key = Read-Host "OpenAI API key"
Set-Content -NoNewline -Path secrets\openai-api-key -Value $key
Remove-Variable key
docker compose -f compose.yaml -f compose/archived-chinese.yaml -f compose/archived-chinese-openai.yaml up -d --build caatuu
```

The archived API has no public authentication boundary and may make billable
requests. Never combine it with the public tunnel without adding an explicit
authentication layer.

## Tooling container

Heavy build, ML, embedding, model-export, and Android helper work runs in the
separate development image:

```powershell
docker compose --profile dev up -d --build caatuu-dev
docker compose exec caatuu-dev bash
```

Inside the container:

```bash
check-caatuu-dev
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
docker compose -f compose.yaml -f compose/archived-chinese.yaml config --quiet
docker compose -f compose.yaml -f compose/phone-debug.yaml config --quiet
```

Run repository and browser/runtime contract tests in a container:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace node:24-bookworm `
  bash -lc "node tools/repository/check-tracked-files.mjs && node tools/repository/check-markdown-links.mjs && node --test apps/runtime/tooling/tests/*.test.mjs"
```

After route, browser shell, packaged asset, or Android changes, start the local
runtime and run the boundary audit in the established dev container:

```powershell
docker compose --profile dev run --rm caatuu-dev `
  node apps/runtime/tooling/audit-runtime-boundary.mjs `
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
