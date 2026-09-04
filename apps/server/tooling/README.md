# Server tooling

This folder contains the Debian server image and launch script for the unified
Caatuu server.

The server container serves:

```text
/       apps/launcher/static
/cz/    apps/languages/czech/static
/zh/
        shared application with the Mandarin development course pack
/es/
        shared application with the Spanish development course pack
/android/
        signed caatuu.apk/json and explicit caatuu-debug.apk/json artifacts
```

These are local-server mounts. The `/es/` mount does not imply inclusion in the
deployed Pages snapshot or Android bundle.

`/zh-hans` and `/zh-hans/**` redirect to the canonical `/zh/` course. The deprecated
Chinese trainer remains repository-only: `/archive/chinese/**` and its old
challenge, sequence, and writing aliases return `404`. Top-level `/api/v1/*`
and `/ws` remain retired as `410 Gone`.

The image uses a pinned Rust builder stage and a `debian:bookworm-slim` runtime
stage. `cargo build --release --locked` runs during the image build; Rust and
the source tree are not present in the final image. The running container
mounts only the static/model roots and generated game artifacts it serves,
Android artifacts, and the private dictionary-gap data directory.

Build the Debian server image only after server or image-definition changes:

```powershell
docker compose build caatuu
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
`http://127.0.0.1:8765/` on Windows. The host binding is loopback-only. The
service is profile-gated and has restart policy `no`; explicitly naming it is
the deliberate local-development or APK/API-test action. Public traffic uses
GitHub Pages, the reporting Worker, and pinned GitHub Release assets. There is
no public tunnel service.

## Dictionary-gap persistence

Compose sets `DICTIONARY_GAP_STORE_PATH` to
`/var/lib/caatuu/dictionary-gaps/czech-missing-words.v1.json` and mounts the
ignored host directory `artifacts/dictionary-gaps/` there read-write. A full
development client can submit its dedicated pending observations to
`POST /cz/api/dictionary/gaps`; it removes one only after the server confirms
`{"ok":true,"stored":true}`. The server ledger adds receipt timestamps and
deduplicates repeat observations before an atomic publish. Stable Android
162/163 keep these observations local. The consent-gated Pages sender uses the
public Worker route described in `apps/reporting-worker/README.md`.

The endpoint accepts only the documented six-field dictionary-gap report and
has no public GET counterpart. Periodic local maintenance can read the server file
from `artifacts/dictionary-gaps/czech-missing-words.v1.json`, verifies each
observation independently, and authors reviewed changes in the tracked Czech
dictionary overlay. The ledger is not a replacement for the disabled general
diagnostic channel. Consented Pages sentence reports use the separate public
Worker route, while `/api/bug-report` remains disabled.

The GitHub Pages cutover moved the public POST route to the reporting Worker;
it no longer reaches this Rust server. Preserve the ignored ledger privately;
do not add its contents to Git, Pages, or a public GitHub Release. The cutover
receipt is 3,309 bytes, 10 records, SHA-256
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
  'cd /workspace && node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --check'
```

This fast preflight checks every setup artifact byte count and SHA-256 against
its authoritative shared or language source for every catalog-declared browser
course. It also requires each shared-runtime mapping from
`apps/language-runtime/app-assets.json` exactly once in every course's offline
list by URL pathname; cache-busting queries are allowed, while missing,
duplicate, or remapped pathnames fail. The build-only course service-worker
template is the sole exception. Revisioned shared URLs loaded by the canonical
app and its trusted shared module graph are synchronized into every course's
offline list; an unversioned reference never strips an intentional query. Run
the same command without `--check` to refresh all browser-course hashes and
canonical shared revisions. Canonical course validation and every
course inspection finish before the first manifest is written, so an invalid
pack cannot leave a partially refreshed catalog. The same inspection binds
`offline.cachePrefix` exactly to the owning course's `cache.prefix` and keeps
`offline.cacheName` versioned beneath that prefix, preventing a copied setup
from sharing another course's worker-managed cache namespace. Android Gradle builds run the
write mode automatically before packaging. After that preflight, run the full
boundary audit:

```powershell
node apps\server\tooling\audit-runtime-boundary.mjs
```

The audit checks that the root browser launcher, `/cz/` Czech app, `/zh/`
Mandarin app, `/es/` Spanish app, compatibility `/zh-hans` redirects,
unreachable deprecated Chinese UI, retired top-level backend paths, and rebuilt
Android APK package contents still match the intended split.

## Public hosting and local phone tests

Public DNS sends the application and Android update flow to GitHub Pages. The
Worker intercepts three reporting routes and four exact, Release-backed setup
file routes. Local browser testing works without either public component;
installed phone updates expect:

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

Remove the environment value and recreate `caatuu` from the base Compose file
after testing.

The former `caatuu-tunnel` connector is retired. Compose contains no tunnel
profile, connector, token mount, watchdog, or forwarding process, and the
runtime image does not install `cloudflared` or `socat`. Do not restore those
pieces as a publication shortcut. `caatuu` remains only as the opt-in loopback
development/APK-test service with restart policy `no`; `caatuu-dev` remains the
canonical tooling container.

The Minerals project is independent. Its public catalog resolves to its own
GitHub Pages deployment, and its private port `7979` must not appear in Caatuu
Compose or Worker routes.

The runtime serves unknown app routes through
`apps/launcher/static/not-found.html` with HTTP `404`. This covers bad
URLs during local testing. Cloudflare or GitHub origin failures happen before a
public request reaches the static app and must be corrected in the
Pages/Worker/Release deployment; the retired tunnel is not a rollback path.
