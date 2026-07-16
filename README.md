# Caatuu Workspace

Caatuu is a workspace for language-learning app variants.

## Product, license, and release status

Caatuu is pre-release software. Its first-party software and developer
documentation are licensed `AGPL-3.0-only`. Models, data, dictionaries,
artwork, branding, and third-party components retain separate terms; see
[`LICENSING.md`](LICENSING.md) and [`LEGAL_INVENTORY.md`](LEGAL_INVENTORY.md).

Public debug APKs are development artifacts, not normal downloads. The public
launcher is reserved for a signed, non-debuggable build that passes
[`RELEASING.md`](RELEASING.md). Outside contributions are temporarily paused as
described in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Active Apps

- `apps/caatuu-unified` - the root landing page served at `/`.
- `apps/caatuu-runtime` - Rust/Axum server that owns the runtime routes.
- `apps/caatuu-czech` - Czech browser app, served at `/cz/`. Local WebLLM model exports live under `static/data/models/` but are generated artifacts, not Git payload.
- `apps/caatuu-android` - native Android shell for the Czech app and offline GGUF inference through llama.cpp.

## One Container

The runtime path is reproducible through `compose.yaml`. It defines only the
daily runtime server and the optional Cloudflare tunnel. Heavy build and ML
helpers live in `compose.tools.yaml` so they do not get mixed into normal
startup.

From PowerShell on Windows:

```powershell
cd C:\Work\caatuu
```

Rebuild the Rust backend with the Rust tool container:

```powershell
docker compose -f compose.tools.yaml run --rm caatuu-build
```

Start or recreate the Debian runtime container:

```powershell
docker compose up -d --build caatuu
```

For normal daily startup after the image already exists, do not rebuild:

```powershell
docker compose up -d caatuu
```

Watch logs:

```powershell
docker compose logs -f caatuu
```

For noisier Rust logs during debugging, set `CAATUU_RUST_LOG` before starting:

```powershell
$env:CAATUU_RUST_LOG = "debug"
docker compose up -d --build caatuu
```

Restart only the running server container:

```powershell
docker compose restart caatuu
```

If you need the old manual path for debugging, the equivalent container is:

```powershell
docker rm -f caatuu 2>$null

docker run -dit `
  --name caatuu `
  -p 8765:9172 `
  -v C:\Work\caatuu:/workspace `
  -w /workspace `
  caatuu-runtime:debian-latest
```

The runtime image already includes these tools:

```bash
bash ca-certificates cloudflared curl file gpg procps tini
```

If you change Rust dependencies or the backend source, rerun:

```powershell
docker compose -f compose.tools.yaml run --rm caatuu-build
docker compose up -d --build caatuu
```

The direct Rust build command remains available if Compose is not working:

```powershell
docker run --rm -v C:\Work\caatuu:/workspace -w /workspace/apps/caatuu-runtime -e CARGO_TARGET_DIR=/workspace/apps/caatuu-runtime/target-linux rust:latest cargo build
```

The runtime container executes this server command automatically:

```bash
bash /workspace/tools/runtime/start-caatuu.sh
```

If you override the image command for debugging, run that same command manually
inside the container.

Open locally:

```text
http://127.0.0.1:8765/
http://127.0.0.1:8765/cz/
http://127.0.0.1:8765/cz/home.html
http://127.0.0.1:8765/cz/chat.html
http://127.0.0.1:8765/archive/chinese/
```

## Cloudflare Tunnel

Cloudflare Tunnel is required for the public app routes and Android in-app
updates. The app can run locally without it, but `Update app`, phone downloads,
and public links under `https://caatuu.waajacu.com/` depend on the tunnel.

Keep the tunnel token outside Git. Create an ignored token file on the host:

```powershell
New-Item -ItemType Directory -Force secrets
$token = Read-Host "Cloudflare tunnel token"
Set-Content -NoNewline -Path secrets\cloudflared-token -Value $token
```

Start the runtime and tunnel profile:

```powershell
docker compose --profile tunnel up -d caatuu caatuu-tunnel
```

After rebuilding or recreating the `caatuu` container, recreate the tunnel
service too. The tunnel shares the app container network namespace, so a stale
tunnel can stay attached to a deleted namespace and Cloudflare will return a
530 / 1033 page even while `http://127.0.0.1:8765/` works locally:

```powershell
docker compose --profile tunnel up -d --force-recreate caatuu-tunnel
```

The Cloudflare named tunnel should point to the Rust server inside the shared
network namespace:

```text
http://127.0.0.1:9172
```

The equivalent manual command inside the `caatuu` container is:

```bash
cloudflared tunnel --protocol http2 --no-autoupdate run --token-file /run/secrets/cloudflared-token
```

Public routes after the tunnel is connected:

```text
https://caatuu.waajacu.com/
https://caatuu.waajacu.com/cz/
https://caatuu.waajacu.com/cz/home.html
https://caatuu.waajacu.com/cz/chat.html
https://caatuu.waajacu.com/archive/chinese/
https://caatuu.waajacu.com/android/caatuu.json
https://caatuu.waajacu.com/android/caatuu.apk
```

Verify the tunnel after a fresh environment starts:

```powershell
curl.exe -I https://caatuu.waajacu.com/android/caatuu.json
```

Unknown app routes are served by `apps/caatuu-unified/static/not-found.html`
with HTTP `404`, so typo URLs under the app show the Caatuu page instead of
the launcher. That only applies after the request reaches the Rust server. A
Cloudflare `1033` or tunnel-origin error means Cloudflare cannot find a healthy
`cloudflared` connector or origin, so recreate `caatuu-tunnel` or configure a
Cloudflare Custom Error page if the edge error body itself must be branded.

## Runtime Boundary Audit

After changing routes, browser shell files, archived Chinese files, or Android
packaging, rebuild/restart the local runtime and run:

```powershell
node tools\runtime\audit-runtime-boundary.mjs
```

This verifies the root launcher, Czech `/cz/` app, Chinese
`/archive/chinese/` archive, retired root Chinese backend routes, retired old
Czech filenames, and the rebuilt Android APK contents.

## Development Split

The browser/runtime container does not need Python or nginx. The Rust server
serves the unified landing page, the Czech browser app, Android download
artifacts, and the archived Chinese app from `archive/caatuu-chinese` under
`/archive/chinese/`.

Top-level `/api/v1/*` and `/ws` are intentionally retired so old Chinese
backend paths do not look like active app routes. The old `/zh/` pages redirect
to `/archive/chinese/` for compatibility only.

Training/export work uses the heavier Debian dev container:

```powershell
docker compose -f compose.tools.yaml --profile dev up -d --build caatuu-dev
docker compose -f compose.tools.yaml exec caatuu-dev bash
```

Verify it from inside the container:

```bash
check-caatuu-dev
```

That container includes CUDA 12.8 PyTorch, Transformers, PEFT, Accelerate,
Node.js, Rust, CMake/build tools, git/git-lfs, Java, and a separate
`/opt/caatuu-mlc` environment for MLC/WebLLM conversion packages.

The ML workspace is:

```text
tools/caatuu-cz-ml
```

That part still depends on Python/PyTorch until we replace the training stack.

## Archive

- `archive/caatuu-chinese` - preserved Chinese trainer static app. It is not
  part of the active language-selection path.
- `archive/caatuu-tauri-android-deprecated` - older Tauri/Android packaging experiment.
- `archive/caatuu-server-deprecated` - older Rust server/profile-engine experiment.

## Tools

- `tools/runtime` - launch script for the unified Rust server.
- `tools/dev` - heavy Debian dev/ML image for training, export, phone-bench,
  Android helper builds, and backend development.
- `tools/phone-bench` - native Android/Termux benchmark path for offline Czech
  model testing on phones without browser WebGPU.
- `tools/android-build` - Debian Docker build path for the native Android app,
  using Android command-line tools instead of host Windows installs.
- `tools/images-generation` - Stable Diffusion/image generation workspace.
