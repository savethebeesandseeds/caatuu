# Caatuu Runtime

This folder contains the Debian runtime image and launch script for the unified
Caatuu server.

The runtime container serves:

```text
/       apps/caatuu-unified/static
/cz/    apps/caatuu-czech/static
/archive/chinese/
        archive/caatuu-chinese static app plus archived API and WebSocket routes
/android/
        debug APK and update manifest artifacts
```

The old `/zh/` pages redirect to `/archive/chinese/`. Top-level `/api/v1/*`
and `/ws` return `410 Gone` so the archived Chinese backend cannot be confused
with the active app runtime.

The image is built from `debian:latest` and installs only the tools needed to
run the already-built Rust runtime plus an optional Cloudflare tunnel client.
Rust is intentionally kept out of the runtime image.

From `C:\Work\caatuu`, rebuild the backend with the Rust tool container:

```powershell
docker compose -f compose.tools.yaml run --rm caatuu-build
```

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
`http://127.0.0.1:8765/` on Windows.

## Boundary Audit

After changing runtime routes, Czech static files, Chinese archive paths, or the
Android package, run the boundary audit from `C:\Work\caatuu`:

```powershell
node tools\runtime\audit-runtime-boundary.mjs
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

Store the tunnel token outside Git at `secrets/cloudflared-token`, then start:

```powershell
docker compose --profile tunnel up -d caatuu caatuu-tunnel
```

If the `caatuu` container is rebuilt or recreated, recreate the tunnel service
as well:

```powershell
docker compose --profile tunnel up -d --force-recreate caatuu-tunnel
```

The `caatuu-tunnel` service shares the `caatuu` network namespace because the
remote Cloudflare tunnel configuration points `caatuu.waajacu.com` to
`http://localhost:9172`.

The runtime serves unknown app routes through
`apps/caatuu-unified/static/not-found.html` with HTTP `404`. This covers bad
URLs once traffic reaches the Rust server. Cloudflare connector/origin failures
such as `1033` happen before the request reaches the app, so those require a
healthy `caatuu-tunnel` service or Cloudflare-side Custom Errors.
