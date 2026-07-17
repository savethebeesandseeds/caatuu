# Runtime tooling

This folder contains the Debian runtime image and launch script for the unified
Caatuu server.

The runtime container serves:

```text
/       apps/launcher/static
/cz/    apps/languages/czech/static
/demos/ top-level demos (isolated development projects, not production assets)
/archive/chinese/
        archive/caatuu-chinese static app; API and WebSocket disabled by default
/android/
        signed caatuu.apk/json and explicit caatuu-debug.apk/json artifacts
```

The old `/zh/` pages redirect to `/archive/chinese/`. Top-level `/api/v1/*`
and `/ws` return `410 Gone` so the archived Chinese backend cannot be confused
with the active app runtime. The archived `/archive/chinese/api/v1/*` and
`/archive/chinese/ws` routes return `404` unless
`CAATUU_ENABLE_ARCHIVED_CHINESE_API=1` is set explicitly.

The image uses a pinned Rust builder stage and a `debian:bookworm-slim` runtime
stage. `cargo build --release --locked` runs during the image build; Rust and
the source tree are not present in the final image. The running container
mounts only the static/model roots and demo projects it serves, Android
artifacts, and the bug-report data directory.

Start or recreate the Debian runtime container:

```powershell
docker compose up -d --build caatuu
```

For normal daily startup after the image already exists:

```powershell
docker compose up -d caatuu
```

Inspect logs:

```powershell
docker compose logs -f caatuu
```

The server listens on port `9172` inside the container and is published on
`http://127.0.0.1:8765/` on Windows. The host binding is loopback-only; the
optional tunnel is the deliberate remote-access path.

## Secrets and archived backend opt-in

The normal Czech runtime does not require an OpenAI key. The archived Chinese
backend can also run from seed data without one. If you explicitly want its
OpenAI-backed features, store the key in the ignored `secrets/openai-api-key`
file; `compose/archived-chinese-openai.yaml` mounts only that file as
`OPENAI_API_KEY_FILE=/run/secrets/openai-api-key`.

The launch environment no longer sources `apps/runtime/env.local.sh`.
This prevents an executable local configuration file from silently injecting
secrets. Use a dedicated secret file or an explicit process environment value.

For trusted local development only:

```powershell
docker compose -f compose.yaml -f compose/archived-chinese.yaml up -d --build caatuu
```

Add `-f compose/archived-chinese-openai.yaml` only when the secret file exists and those
model-backed archive features are intended.

Do not combine this opt-in with the public tunnel: the archived API has no
authentication boundary and model requests can incur charges.

## Boundary Audit

After changing runtime routes, Czech static files, Chinese archive paths, or the
Android package, run the boundary audit from `C:\Work\caatuu`:

```powershell
docker exec caatuu-dev bash -lc `
  'cd /workspace && node apps/runtime/tooling/refresh-setup-assets.mjs --check'
```

This fast preflight checks every setup artifact byte count and SHA-256 against
its authoritative shared or language source. Android Gradle builds run the
write mode automatically before packaging. After that preflight, run the full
boundary audit:

```powershell
node apps\runtime\tooling\audit-runtime-boundary.mjs
```

The audit checks that the root browser launcher, `/cz/` Czech app,
`/archive/chinese/` archive, retired `/zh/` redirects, retired top-level
Chinese backend paths, and rebuilt Android APK package contents still match the
intended split.

## Cloudflare Tunnel

The public Caatuu URLs and Android in-app update flow depend on Cloudflare
Tunnel. Local browser testing works without it, but phone updates expect:

```text
https://caatuu.waajacu.com/android/caatuu.json
https://caatuu.waajacu.com/android/caatuu.apk
```

Those stable filenames are reserved for a signed, non-debuggable release and
may return `404` when no release has been published. Development builds use
`/android/caatuu-debug.json` and `/android/caatuu-debug.apk` and should be
sideloaded only when deliberately testing a debug build.

Debug downloads are also disabled at the HTTP boundary by default. For a
trusted LAN phone test, bind the server only to the intended PC interface and
opt in through the dedicated override:

```powershell
$env:CAATUU_PHONE_DEBUG_BIND = "<your-pc-lan-ip>"
docker compose -f compose.yaml -f compose/phone-debug.yaml up -d --force-recreate caatuu
```

Do not combine this mode with the tunnel. Remove the environment value and
recreate `caatuu` from the base Compose file after testing.

Store the tunnel token outside Git at `secrets/cloudflared-token`, then start:

```powershell
docker compose --profile tunnel up -d caatuu caatuu-tunnel
```

The tunnel has its own network namespace. A narrow local forward maps its
remote-configured `http://localhost:9172` origin to the `caatuu:9172` service,
so recreating the server does not strand the connector in an old network
namespace.

The current named tunnel also carries `minerals.waajacu.com` with a remote
`localhost:7979` origin. Compose forwards that listener to host port `7979` so
the existing Minerals service can still work when it is running. Prefer a
dedicated Caatuu tunnel token when the Cloudflare configuration is split.

The runtime serves unknown app routes through
`apps/launcher/static/not-found.html` with HTTP `404`. This covers bad
URLs once traffic reaches the Rust server. Cloudflare connector/origin failures
such as `1033` happen before the request reaches the app, so those require a
healthy `caatuu-tunnel` service or Cloudflare-side Custom Errors.
