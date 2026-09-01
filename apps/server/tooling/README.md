# Server tooling

This folder contains the Debian server image and launch script for the unified
Caatuu server.

The server container serves:

```text
/       apps/launcher/static
/cz/    apps/languages/czech/static
/zh/
        shared application with the Mandarin development course pack
/android/
        signed caatuu.apk/json and explicit caatuu-debug.apk/json artifacts
```

`/zh-hans` and `/zh-hans/**` redirect to the canonical `/zh/` course. The deprecated
Chinese trainer remains repository-only: `/archive/chinese/**` and its old
challenge, sequence, and writing aliases return `404`. Top-level `/api/v1/*`
and `/ws` remain retired as `410 Gone`.

The image uses a pinned Rust builder stage and a `debian:bookworm-slim` runtime
stage. `cargo build --release --locked` runs during the image build; Rust and
the source tree are not present in the final image. The running container
mounts only the static/model roots and generated game artifacts it serves,
Android artifacts, and the private dictionary-gap data directory.

Start or recreate the Debian server container:

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

## Dictionary-gap persistence

Compose sets `DICTIONARY_GAP_STORE_PATH` to
`/var/lib/caatuu/dictionary-gaps/czech-missing-words.v1.json` and mounts the
ignored host directory `artifacts/dictionary-gaps/` there read-write. A full
development client can submit its dedicated pending observations to
`POST /cz/api/dictionary/gaps`; it removes one only after the server confirms
`{"ok":true,"stored":true}`. The server ledger adds receipt timestamps and
deduplicates repeat observations before an atomic publish. The stable 162
product and static web profile keep these observations local and do not require
the route.

The endpoint accepts only the documented six-field dictionary-gap report and
has no public GET counterpart. Periodic Codex maintenance reads the server file
from `artifacts/dictionary-gaps/czech-missing-words.v1.json`, verifies each
observation independently, and authors reviewed changes in the tracked Czech
dictionary overlay. The ledger is not a replacement for the disabled general
diagnostic channel; sentence reports remain device-local and
`/api/bug-report` remains disabled.

The GitHub Pages cutover retires the public POST route. Preserve the ignored
ledger privately before DNS changes; do not add its contents to Git, Pages, or
a public GitHub Release. The cutover receipt is 3,309 bytes, 10 records, SHA-256
`3d5657bfb739f5cdd3db1e7bf0d2161c93efbbfd2cdcca2d05156048a8e9ee3f`.
After cutover the local runtime may still expose the route for deliberate local
development/API testing, but no public DNS path reaches it.

## Repository-only Chinese archive

The deprecated Chinese trainer remains under `archive/caatuu-chinese` for
historical reference only. Normal and exceptional Compose configurations do
not mount it, and no API, WebSocket, secret override, or legacy URL can
activate it. The launch environment also does not source executable local
configuration files.

## Boundary Audit

Folders directly under `assets/loading-animation/` whose names begin with
`animation` are playable sequences. When their PNGs are added, replaced, moved,
or deleted, synchronize both the playback manifest and the offline setup
catalog from the files that remain:

```powershell
docker exec caatuu-dev bash -lc `
  'cd /workspace && node apps/server/tooling/sync-loading-animation-assets.mjs'
```

Use `--check` in CI or before packaging to detect a stale frame list without
rewriting either manifest. The final numeric component of each filename defines
playback order. Numbers may contain gaps; playback follows the sorted manifest
entries rather than assuming a contiguous numeric range. The setup screen plays
`animation-backpack` once and then loops `animation-walking-arround`. Training
worlds open directly; the retired `animation-landing` and
`animation-leaving` folders remain beside the runtime sequences as preserved
source artwork. The synchronizer explicitly excludes them from the runtime and
setup catalogs.

After changing runtime routes, course static files, repository archive
inventory, or the Android package, run the boundary audit from
`C:\Work\caatuu`:

```powershell
docker exec caatuu-dev bash -lc `
  'cd /workspace && node apps/server/tooling/refresh-setup-assets.mjs --check'
```

This fast preflight checks every setup artifact byte count and SHA-256 against
its authoritative shared or language source. Android Gradle builds run the
write mode automatically before packaging. After that preflight, run the full
boundary audit:

```powershell
node apps\server\tooling\audit-runtime-boundary.mjs
```

The audit checks that the root browser launcher, `/cz/` Czech app, `/zh/`
Mandarin app, compatibility `/zh-hans` redirects, unreachable deprecated Chinese UI,
retired top-level backend paths, and rebuilt Android APK package contents still
match the intended split.

## Cloudflare Tunnel

Until public DNS switches to a validated GitHub Pages deployment, the Caatuu
URLs and Android in-app update flow can use Cloudflare Tunnel. After DNS
cutover, these exact paths live in Pages; retain the connector configuration
and token through the minimum 48-hour rollback window, then retire the
connector only after the remaining gate below passes. Local browser testing
works without it; installed phone updates expect:

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
docker compose --profile tunnel up -d --build caatuu caatuu-tunnel
```

The canonical connector pins its Cloudflare edge transport to HTTP/2 over TCP
port `7844`. QUIC proved unstable on the Windows/Docker path: it could pass the
startup precheck, lose every edge connection, and be selected again after the
60-second watchdog restarted the connector. Do not restore `auto` or `quic`
without updating the tunnel-resilience contract and completing a sustained
connectivity test.

Edge discovery uses Cloudflare's `1.1.1.1:53` and `1.0.0.1:53` resolvers
directly because Docker's embedded `127.0.0.11` resolver repeatedly returned
false `no such host` and `server misbehaving` responses for Cloudflare's
edge-discovery record. Keep both explicit resolvers unless a replacement is
validated from inside the tunnel container.

After recreating the connector, its startup log must report both explicit
resolvers in `Settings` and `Initial protocol http2`. Keep it running beyond
the watchdog window, confirm that `/ready` remains healthy, and verify that the
container restart count does not increase during the observation period.

The connector runs the canonical schema-aware game release checker before
opening the public tunnel and again from its watchdog. It refuses missing or
preview-only delivered games, dependencies, and authority metadata, including
changes made after startup. This does not affect the loopback-only local
runtime.

The tunnel has its own network namespace. A narrow local forward maps its
remote-configured `http://localhost:9172` origin to the `caatuu:9172` service,
so recreating the server does not strand the connector in an old network
namespace.

The Caatuu connector is not a Minerals origin. `minerals.waajacu.com` now
resolves directly to its GitHub Pages deployment, and the optional Minerals
administrator remains private on Windows loopback. Compose deliberately has no
`7979` listener; do not reintroduce one through this connector. Remove the
obsolete `minerals.waajacu.com -> http://localhost:7979` entry from the named
tunnel's remote configuration as a separate immediate control-plane action,
while retaining `caatuu.waajacu.com -> http://localhost:9172` until the Caatuu
retirement gate below passes. The missing local listener makes the stale route
fail closed but does not remove that remote configuration.

Do not retire this connector merely because a Pages artifact was generated.
The final `web-static-pages-cutover` bundle includes the exact stable 162 and
compatibility 161 Android trees, aliases, and setup closure, but every dynamic
API is retired publicly. Before removing the connector, publish and verify the
pinned `caatuu-pages-v162.tar` preservation asset, deploy the complete Pages
bundle, preserve the dictionary-gap ledger privately, cut the base origin to
Pages, obtain GitHub's HTTPS certificate, and validate the public site plus all
retained Android/setup routes with Docker Desktop stopped. Only then remove the
Compose service and revoke its credential after the minimum 48-hour rollback
window.

Until that gate passes, `restart: unless-stopped` remains intentional for both
`caatuu` and `caatuu-tunnel`, because they still own public compatibility
routes. After the gate passes, remove `caatuu-tunnel` from Compose entirely and
make `caatuu` an opt-in local-development/APK-test service without an automatic
restart policy. Merely stopping a retired container is not sufficient.

The runtime serves unknown app routes through
`apps/launcher/static/not-found.html` with HTTP `404`. This covers bad
URLs once traffic reaches the Rust server. Cloudflare connector/origin failures
such as `1033` happen before the request reaches the app, so those require a
healthy `caatuu-tunnel` service or Cloudflare-side Custom Errors.
