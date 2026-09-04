# Static web hosting

Last reviewed: 3 September 2026

Caatuu has a deterministic GitHub Pages deployment profile. It serves the
website, already-built stable 163 (`0.1.11`), previous stable 162 (`0.1.10`),
compatibility transition 161, and most setup dependencies without a workstation
origin. Four large setup files live in a pinned GitHub Release and retain their
original Caatuu URLs through the reporting Worker. This deployment does not
build or relabel an Android release.

## Canonical deployment architecture

This document is the public, non-secret deployment record. Future maintainers
and Codex sessions should start here before changing hosting, DNS, Android
downloads, reporting, or Docker services.

```text
Browser or installed Android app
              |
              v
  caatuu.waajacu.com at Cloudflare
              |
              +-- ordinary pages, assets and APKs ----------> GitHub Pages
              |
              +-- four large setup files --> caatuu-reporting Worker --> GitHub Release
              |                              (exact bytes and resumable ranges)
              |
              +-- two report POST paths ---> caatuu-reporting Worker --> EU D1
              +-- data-free health path ---> caatuu-reporting Worker

Local Docker: development and release tooling only; never a public dependency
```

| Component | Responsibility | Repository authority |
| --- | --- | --- |
| GitHub Pages | Serves the launcher, active Czech product, unlisted/noindex Mandarin preview, embedded course games, ordinary setup assets, and retained Android downloads; it does not publish the standalone Godot preview | `.github/workflows/pages.yml` and `apps/launcher/tooling/build-pages-site.mjs` |
| GitHub Releases | Holds the preservation archive and every Android release overlay consumed by the Pages workflow, plus the four large setup files in `caatuu-setup-assets-v1` | `apps/android/tooling/pages-baseline.json`, the append-only list in `apps/android/tooling/pages-current-release.json`, and the fixed map in `apps/reporting-worker/src/index.mjs` |
| Cloudflare DNS/proxy | Gives the Pages site its public custom hostname and sends only the declared reporting and raw-range paths through the Worker | The live DNS record plus the cutover procedure below |
| `caatuu-reporting` Worker | Validates and stores the two narrow, consent-gated report types and streams four fixed GitHub Release assets without buffering so resumable downloads use raw offsets; it does not store those files or serve the application shell | `apps/reporting-worker/` |
| EU D1 | Stores accepted dictionary-gap and sentence reports; it has no public read route | `apps/reporting-worker/migrations/` and the D1 binding in `wrangler.jsonc` |
| `caatuu-dev` | Canonical local dependency, test, and release-tool environment | Root `README.md` and the existing named container |
| `caatuu` | Profile-gated, restart-disabled loopback runtime for deliberate local development or APK/API testing | `compose.yaml` and `apps/server/README.md` |
| `caatuu-tunnel` | Retired. It is absent from Compose and must not be recreated | The retirement record below |

At the final audit, neither `caatuu` nor `caatuu-tunnel` existed on the
canonical host. `caatuu-dev` was the only running Caatuu container and remained
untouched. `caatuu` is available only through the explicit `local` profile and
has `restart: "no"`; it is not part of public hosting.

The deployment order is intentional:

1. Commit and push the exact reviewed source to the sole `main` branch.
2. Publish and digest-verify the version-pinned setup Release assets.
3. Deploy `apps/reporting-worker` and verify its data-free health route and D1
   binding.
4. Manually dispatch the Pages workflow. It packages the pinned release files;
   it does not build an APK.
5. Point the custom hostname at GitHub Pages in DNS-only mode until strict
   GitHub HTTPS works.
6. Enable Cloudflare proxying so only the declared Worker route patterns
   intercept reporting requests and the four raw-range setup files.
7. Validate the public site, Android downloads, reporting protections, and
   independence from local Docker before deleting the obsolete tunnel.

Never commit or paste into documentation, issues, logs, or chat output:

- Cloudflare or GitHub passwords, session cookies, OAuth credentials, API
  tokens, recovery codes, or account-specific authorization links;
- the Cloudflare Tunnel connector token or any reusable deployment secret;
- Android signing private keys or their passwords;
- raw report rows, private dictionary-gap words, generated import SQL, or D1
  exports; or
- private backup locations that reveal credentials or personal storage paths.

Public hostnames, repository paths, Worker/service names, release versions,
artifact hashes, schemas, and retention behavior are safe operational facts.
Opaque provider identifiers should remain only where a checked-in deployment
configuration technically requires them; do not repeat them in prose.

Before acting in a later session, verify `main` is still the only branch, this
is the canonical checkout, no concurrent session owns overlapping changes, and
the live control-plane state still matches this record. Never infer current DNS
or deployment status solely from an old transcript.

## What the static site contains

`web-static-core` remains the small browser-only intermediate generated by
`build-static-site.mjs`. It contains the launcher, Czech interface, ordinary
local progress and stats, curated web dictionary, browser games, reviewed
visuals, and lexical fallbacks. It is not the deployable cutover payload.

`web-static-pages-cutover`, generated by `build-pages-site.mjs`, adds every
catalog course with `platforms.browser.pagesEnabled`, currently the unlisted,
`noindex` Mandarin development preview, and overlays every release in the
append-only Android descriptor on the fixed 162/161 preservation archive.
Spanish remains locally browser-enabled but Pages-disabled while its curriculum
license is `release-review-required`.
The newest descriptor release becomes the stable aliases, while every older
immutable route remains. The currently deployed v163 snapshot retains these
same-origin Android contracts as exact byte copies:

- `/android/releases/163/caatuu.json` and `/android/releases/163/caatuu.apk`;
- `/android/releases/162/caatuu.json` and `/android/releases/162/caatuu.apk`;
- `/android/caatuu.json` and `/android/caatuu.apk`, which point to 163;
- `/android/debug-releases/product-transition/161/caatuu-transition.json` and
  `/android/debug-releases/product-transition/161/caatuu-transition.apk`; and
- the technical compatibility aliases `/android/caatuu-debug.{json,apk}` used
  by already-installed preview clients.

The public launcher advertises only the signed, non-debuggable newest descriptor
release, currently stable 163. Pages
does not publish `/android/caatuu-preview.{json,apk}`, so debuggable transition
161 cannot become an ungated automatic fallback.

The embedded Czech and Mandarin course games are part of their respective
course routes. The separate `/games/caatuu-game/` Godot preview remains absent
and must return `404` until its game, scenery, distribution, and provenance
release gates pass.

The frozen baseline retains all 662 release-162 native-required artifacts, the
original release keymaps, ONNX/WASM runtime, vector database, full SQLite
dictionary, catalogs, and exact legacy artwork. The complete release-162 setup
download closure is 480,853,526 bytes. The builder separately validates both
Czech and Mandarin setup manifests embedded in the newest descriptor APK
(currently 163) against the final static site. The current Agreement artwork is retained at a content-addressed path so
the old Android URL can keep its release-162 bytes.

The Pages workflow does not require Git-ignored local copies of the large ONNX
and WASM setup-delivered files. It reads their tracked catalog receipts, then
requires the frozen archive to provide the exact declared bytes and SHA-256.
The ordinary Android product builder retains the stricter local-file check.

| Consumer | Public URL | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Android release 162 | `/assets/planets/agreement-aurora.png` | 1,511,588 | `abfc3a443f60e1a1c2f4c16fbb2cda0e20f46b4daeb75bdc35d3b99718cc79a6` |
| Current web and Android release 163 | `/assets/planets/releases/5fe5c25467d51dbe/agreement-aurora.png` | 1,258,690 | `5fe5c25467d51dbec0c7e6600f187a685ccb0d42c34a47c3d1a737d2b6051966` |

The Android product transform changes only the current artwork's remote setup
URL. Its APK-local `asset_path` remains
`assets/planets/agreement-aurora.png`. The Pages builder copies the current
bytes first, rewrites the current web setup URL without changing that local
path, and overlays the frozen release-162 bytes at the unversioned URL last.

The published root and Mandarin course-worker policies do not precache Android
downloads or the preserved database, model, and runtime payloads. They bypass
Android, dictionary/embedding/model/vendor paths and all range requests.
Ordinary web assets, including setup visuals under `/assets`, keep the normal
service-worker behavior and may be cached on demand.

Pages has no dynamic application server. Three narrow dynamic paths are routed
through the separate `caatuu-reporting` Cloudflare Worker while the application
and its retained downloads remain Pages-hosted:

- `POST /cz/api/dictionary/gaps` for default-off, future-only missing-word
  sharing;
- `POST /api/sentence-reports` for individually consented Word World sentence
  reports; and
- `GET /api/reporting/health`, which returns only readiness and the Worker
  deployment version.

Both POST routes require `X-Caatuu-Reporting-Policy: 2026-09-02.v1`. This is a
public rollout marker, not a secret. Clients without it are rejected before the
body is read, so older local queues cannot begin uploading merely because the
hostname now has an endpoint.

Four additional exact Worker routes protect the large setup files used by APK
163 and the web runtime:

| Public Caatuu path | Release asset | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `/cz/data/dictionaries/kaikki-cs-en-2026-07-09/caatuu-cs-en.sqlite` | `caatuu-cs-en.sqlite` | 143,106,048 | `80e47c922b3abb42ecb363b06844a26c8fc2fd5ae2578203824dc6b94f130a71` |
| `/cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite` | `caatuu-cz-curriculum.sqlite` | 20,029,440 | `d30277c5180b6c927ad116f8d00852f747b22c497480f36aa33f4bbf61cb7e13` |
| `/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx` | `model_qint8_arm64.onnx` | 23,026,053 | `4278337fd0ff3c68bfb6291042cad8ab363e1d9fbc43dcb499fe91c871902474` |
| `/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/ort/ort-wasm-simd-threaded.wasm` | `ort-wasm-simd-threaded.wasm` | 12,942,611 | `f4f290847a4df02d0b93cdbf39b4b0e71acefbe80573e7e6b9342a7abd7b290a` |

The assets live in the public GitHub Release `caatuu-setup-assets-v1`. Treat
that release as write-once: never replace an asset in place or use upload
`--clobber`. Changed bytes require a new tag such as
`caatuu-setup-assets-v2`, updated fixed mappings, and full validation.

The Worker fetches only those fixed release URLs with
`Accept-Encoding: identity`, follows GitHub's asset redirect, preserves the
range and HTTP conditional headers needed for safe resume, streams the body
without buffering it, and returns `no-transform`. GitHub's CDN does not accept
suffix-range syntax, so the Worker translates a valid suffix into the
equivalent explicit byte interval. It fails closed on compressed data, a wrong
full length, a wrong interval, or a wrong total size. Query strings remain
inside the public compatibility route but are never forwarded to GitHub. No R2
bucket, secret, scheduled task, watchdog, health poller, or persistent
connection is involved.

The cutover explicitly retires:

- `/android/caatuu-preview.json` and `/android/caatuu-preview.apk`;
- `/android/releases/status` and `/android/debug-releases/status`;
- `/android/termux-install-debug.sh`;
- `/cz/api/dictionary/status` and `/cz/api/dictionary/search`;
- `/api/bug-report`, `/api/v1`, and `/ws`.

Releases 162/163 keep dictionary-gap observations local. The Pages web product
uses new authorized v2 outboxes only after the relevant consent. Existing v1
sentence and gap queues remain permanently local and are never migrated.

The reporting Worker stores accepted data in the EU-jurisdiction D1 database
whose configured resource name is `caatuu-reporting-production`; that historical
name does not represent a second deployment tier. Sentence reports become eligible for deletion
after 90 days and dictionary gaps 365 days after their latest observation.
Cleanup is requested after an accepted write when the recorded successful run
is at least a day old; eligible rows can remain longer when no later report
arrives. There is no cron job, watchdog, health poller, or persistent
connection. There is no public data-listing route and Worker observability is
disabled.

The private ledger is not published: its cutover receipt is schema
`caatuu.dictionary-gap-store.v1`, 10 records, 3,309 bytes, SHA-256
`3d5657bfb739f5cdd3db1e7bf0d2161c93efbbfd2cdcca2d05156048a8e9ee3f`,
at `artifacts/dictionary-gaps/czech-missing-words.v1.json`. The exact records
were imported to D1 after verifying that receipt; the private import SQL,
receipt, and Time Travel bookmark are under the ignored
`artifacts/reporting-worker/private/` directory. No R2 bucket or other hidden
backup component exists. A longer-lived independent backup destination remains
unconfigured and must not be claimed otherwise.

## Build and inspect locally

Place the fixed preservation archive at
`artifacts/android/caatuu-pages-v162.tar`. It is 535,674,368 bytes with SHA-256
`9564bf5dc318ab642468787dd6ef23e4e70923887ca622620d045255734cc6c5`.
Also retain the exact finalized APK, manifest, and receipt for every release
listed in `pages-current-release.json` under
`artifacts/android/releases/<versionCode>/`. Release names, local paths, public
paths, and download URLs are derived from each validated version code; the
descriptor stores the source identity, sizes, and hashes in one place:
[`pages-current-release.json`](../apps/android/tooling/pages-current-release.json).
The adjacent
[`Android Pages preservation baseline`](../apps/android/tooling/PAGES_BASELINE.md)
records how those existing bytes are reproduced without an Android build. Then
use the maintained container and ignored output directory:

The builder fails if the published payload exceeds 1,000,000,000 bytes, matching
GitHub's [1 GB published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
The preservation archive is also below GitHub's
[2 GiB per-release-file limit](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases),
and the Pages workflow remains below the
[10 GB uncompressed artifact limit](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
Size alone does not prove operational fit: Pages has a 10-minute deployment
limit and a soft 100 GB monthly bandwidth limit. The four largest files use
GitHub Releases at runtime, but the preservation bundle still validates their
exact bytes. Recheck these limits before expanding beyond the current personal
use case.

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-pages-site.mjs --baseline-archive artifacts/android/caatuu-pages-v162.tar --output artifacts/web/github-pages
```

Recheck an existing generated payload with the same archive:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-pages-site.mjs --baseline-archive artifacts/android/caatuu-pages-v162.tar --output artifacts/web/github-pages --validate-only
```

The successful command prints the profile, exact file count, total bytes,
newest stable release, its predecessor, compatibility 161, and the
preservation-archive digest. For the currently deployed v163 snapshot, the
published bundle manifest records 824 payload files totaling 644,405,653
bytes; those figures change when a release or web payload is appended. The builder also writes
`artifacts/web/github-pages/caatuu-web-bundle.json`, whose sorted inventory
binds every other file by byte count and SHA-256.

Before publication, inspect `/`, `/cz/`, `/zh/`, Dictionary, Backpack, the six
Czech embedded games, and the three Mandarin embedded games from the generated
directory through an approved local review route. Confirm that setup completes,
image hints appear, saved progress survives reload, and the browser does not
precache or automatically download Android, model, dictionary-database, or
embedding payloads. Confirm `/games/caatuu-game/` remains `404`. Separately
inspect every retained Android manifest and artifact path from the generated
directory.

## One-time GitHub Pages configuration

The repository owner performs these control-plane steps in GitHub. They are not
done by the workflow:

1. Confirm that `main` is still the only local and remote branch.
2. With explicit publication confirmation, create the preservation release tag
   `caatuu-pages-v162` and attach only `caatuu-pages-v162.tar`. Verify its exact
   byte count and digest above. This is durable relocation of existing release
   bytes, not a new Android release. Never resolve `latest`.
3. The published tag `caatuu-android-v163` points to Pages handoff commit
   `0a23fc17c1af6285bd969ae057f13bf2f6f19759`. Its attached receipt—not the tag
   target—binds the immutable APK bytes to Android source commit
   `91ba021979275160ca30cacabe8a954aa1bf2341`. Do not force-move the published
   tag. Verify `caatuu-163.apk`, `caatuu-163.json`, and
   `caatuu-163-release-candidate.json` against every byte count and SHA-256 in
   `pages-current-release.json`. This promotes the already-built APK; it does
   not run an Android build.
4. Publish the four setup files in the table above under the fixed
   `caatuu-setup-assets-v1` tag. Verify GitHub's server-side SHA-256 for every
   asset before deploying the Worker. Never replace an existing asset.
5. In repository **Settings → Pages**, select **GitHub Actions** as the source.
6. Add the custom domain `caatuu.waajacu.com` and complete GitHub's domain
   verification. Keep the current DNS route in place while local validation is
   still underway.
7. Leave HTTPS enforcement enabled once GitHub reports the certificate and DNS
   as ready.

The first artifact may need to be deployed before GitHub can provision the
custom-domain certificate. For that deployment only, manually enable the
workflow's `allow_http_certificate_bootstrap` input. It accepts the exact HTTP
custom origin while keeping the hostname and root-path checks intact. Leave the
input off after DNS points to Pages; the default path requires the exact HTTPS
origin.

GitHub's current instructions for these controls are [configuring a publishing
source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
and [managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

The manual `Deploy static Caatuu to GitHub Pages` workflow fails closed unless:

- it is dispatched from `main`;
- its required `expected_revision` input is the exact 40-character SHA of the
  pushed `main` commit being deployed;
- `main` is the only local and remote branch;
- GitHub Pages reports the exact origin `https://caatuu.waajacu.com` with an
  empty base path, except for the explicit default-off certificate-bootstrap
  input described above;
- the exact `caatuu-pages-v162.tar` release asset exists and matches the pinned
  535,674,368-byte SHA-256 descriptor;
- all three assets for every Android release in the append-only descriptor
  match their pinned sizes and SHA-256 values, and each receipt binds its APK
  to its signer and source commit; and
- every schema-v2 descriptor snapshot on the first-parent history is an exact
  append-only prefix of the next snapshot, and the checked-out descriptor is
  byte-identical to the last snapshot; and
- the complete Pages, Android alias, setup, service-worker, inventory, and size
  validators pass.

It uploads a Pages artifact and uses GitHub's Pages deployment API. There is no
`gh-pages` branch and no push trigger.

## Routine Android release and Pages deployment

After incrementing the Android version and committing and pushing the exact
source on `main`, run the maintained release command:

```powershell
pwsh -NoProfile -File apps/android/tooling/release-android.ps1
```

It runs the following guarded build/finalization stage only when the declared
version does not already have a finalized receipt:

```powershell
docker exec -w /workspace caatuu-dev bash apps/android/tooling/publish-release.sh --build-once
```

That command has at most one Gradle invocation. It produces one AAB, derives the
authoritative universal APK from that AAB, validates and signs it, and seals a
version-owned receipt. It no longer creates a second direct APK that is thrown
away. Each major phase prints its elapsed time.

The wrapper then publishes the exact finalized bytes through:

```powershell
pwsh -NoProfile -File apps/android/tooling/deploy-pages-release.ps1 `
  -CandidateReceipt artifacts/android/releases/<versionCode>/caatuu-release-candidate.json
```

The deployer never runs Gradle and never calls the builder. It validates the
receipt and sibling APK/manifest, appends the release to the Pages descriptor,
commits and pushes only that descriptor on `main`, uploads only missing assets
to the version-owned GitHub Release, verifies GitHub's hashes, dispatches the
Pages workflow, waits for it, and checks the public site, all retained Android
routes, and the data-free reporting health route. The release list is
append-only: publishing 164 retains 163 rather than replacing it.

If upload, workflow execution, or public verification is interrupted, rerun
the routine command. It detects the finalized version-owned receipt and skips
the build stage; the deployer reuses exact completed phases and rejects
conflicting local or remote bytes. To resume directly, run only the deploy
command with that same receipt. Use `-PlanOnly` on the deployer to validate and
display the intended release without changing tracked files, creating commits,
uploading a release, or deploying Pages. Plan mode may refresh the local
`origin/main` reference and use a temporary validation directory, which it
removes before exiting.

## DNS and deployed cutover record

`caatuu.waajacu.com` is a proxied CNAME to
`savethebeesandseeds.github.io`. Proxying remains enabled because Cloudflare
must intercept exactly the seven Worker route patterns; every other path
continues to GitHub Pages. GitHub Pages reports the custom domain verified,
HTTPS enforced, and its certificate approved.

`minerals.waajacu.com` is a separate DNS-only CNAME to GitHub Pages. Its former
`localhost:7979` entry inside the old Caatuu tunnel was stale configuration,
not a live dependency. Port `7979` belongs to the independent Minerals project
and must never appear in Caatuu Compose or Worker routes.

### Deployment receipt

The reviewed Pages payload was deployed from `main` commit
`12d23086ef695fd7555a166a52a2eb098f3525a1` by
[Pages workflow run 33687857013](https://github.com/savethebeesandseeds/caatuu/actions/runs/33687857013).
The run completed successfully at 2026-09-02 21:59 UTC without rebuilding an
APK or creating a publication branch. The final Release-backed range proxy is
Worker version `2026-09-03.v5`, sourced from `main` commit
`4f267fb0d02570c5af63b298272faf78ca687f6d`; its focused suite passes 20/20.
The four fixed setup assets were published in GitHub Release
`caatuu-setup-assets-v1` on 2026-09-03. Their server-side digests match the
table above.

The final public validation on 2026-09-03 established:

- `caatuu.waajacu.com` is a proxied CNAME to
  `savethebeesandseeds.github.io`; normal responses show GitHub Pages/Fastly as
  the origin behind Cloudflare, while only the seven declared Worker paths are
  intercepted;
- `/caatuu-web-bundle.json` identifies the
  `web-static-pages-cutover` profile with 824 payload files, 644,405,653 payload
  bytes, and payload SHA-256
  `33ecce9653c5a69290938c69f23026ee87fa211066fc803db6e36e18a5b57d93`;
- `/`, `/cz/`, and `/zh/` return HTTPS `200`; the root launcher remains
  Czech-only, Mandarin remains unlisted and renders `noindex, nofollow`, and
  `/games/caatuu-game/` returns the intentional static `404`;
- stable Android 163, previous stable 162, and compatibility 161 manifests,
  APKs, aliases, content types, and representative byte ranges passed from the
  same origin. APK 163 remained the already-built 26,553,893-byte artifact with
  SHA-256
  `fd1d4bd283c558174eacd68e08c01a93235fae0b28970e6993e1e84a2d142545`;
- complete dictionary, vector-database, ONNX, and WASM downloads matched their
  pinned byte counts and SHA-256 values. HEAD, bounded, open-ended, suffix, and
  unsatisfied ranges returned correct raw-file lengths and offsets. A real WASM
  test downloaded the first 1 MiB, resumed the same file at byte 1,048,576, and
  produced the exact 12,942,611-byte file and pinned SHA-256;
- the reporting health route returned ready, and deliberately invalid requests
  to both write routes returned `422`, `stored: false` before either D1 storage
  function. Retired dynamic routes returned GitHub Pages `404` responses;
- no synthetic successful report was submitted because every valid POST would
  store real data. The focused Worker tests cover successful D1 acknowledgement,
  idempotency, conflicts, retention cleanup, and fail-closed storage errors;
- neither `caatuu` nor `caatuu-tunnel` existed on the canonical host during
  validation. `caatuu-dev` remains a restart-disabled local development/build
  environment and is not a public dependency; and
- the old remote tunnel was down with no connected machines while all Caatuu
  routes and the independent Minerals Pages site passed, proving there was no
  remaining tunnel dependency.

After that dependency proof, the remote `caatuu` Cloudflare Tunnel object was
permanently deleted on 2026-09-03 and its obsolete ignored connector credential
file was removed from the canonical host. The existing GitHub Pages CNAME
records for `caatuu.waajacu.com` and `minerals.waajacu.com` were preserved. No
container, image, volume, APK, Pages deployment, Worker binding, or D1 data was
changed during retirement; `caatuu-dev` remained available for local work.

The maintained validation contract is:

- `/caatuu-web-bundle.json` is served by the public origin and matches the
  deployed Pages payload;
- `/zh/` serves the unlisted, `noindex` Mandarin development preview while the
  active-only root launcher remains unchanged, and `/games/caatuu-game/`
  remains an intentional static `404`;
- every retained Android manifest, immutable APK, legacy transition path,
  alias, byte range, hash, content type, and no-redirect contract works from its
  durable same-origin home;
- the APK-embedded release-162 setup manifest matches the frozen archive
  receipt; both Czech and Mandarin setup manifests embedded in APK 163 resolve
  every native-required artifact; and the rewritten public
  `/cz/setup-assets.json` resolves every listed web asset;
- the dictionary and vector SQLite files, ONNX model, and WASM runtime return
  the pinned lengths and hashes; normal, `identity`, `gzip`, and Brotli-capable
  clients all receive raw-file semantics; bounded, open-ended, and suffix
  ranges return correct `206 Partial Content`; an unsatisfied range returns a
  correct `416`; and public `Content-Length` and `Content-Range` values match
  the uncompressed files;
- the dictionary-gap ledger's D1 import receipt matches the digest above, a
  durable Worker acknowledgement occurs only after a D1 write, and a request
  without the current policy marker is rejected without changing the database;
- the retained reporting routes reach only the Worker, while the retired
  dynamic routes return static `404` responses rather than reaching a
  workstation;
- the public site and all retained routes remain healthy with Docker Desktop
  and the local Caatuu connector stopped; and
- Compose contains no tunnel service or credential mount, while the local
  `caatuu` runtime and `caatuu-dev` remain available for deliberate development.

GitHub Pages controls response caching. Its normal `Cache-Control: max-age=600`
replaces the runtime's prior one-year `immutable` versioned-file header and
`no-store` alias header. The frozen hashes and version-owned paths remain the
integrity authority; allow up to ten minutes for a changed mutable alias in any
future Pages-based publisher. Accept this cache-contract change explicitly when
confirming the external cutover.

## Rollback

Rollback no longer means starting a home-server tunnel. For a Pages failure,
redeploy the last known-good Pages artifact or correct the workflow and dispatch
it again from `main`. For a Worker failure, restore the known-good Worker files
as a new commit on `main`, then deploy that commit. Switching the CNAME
temporarily to DNS-only can isolate Pages: reporting becomes unavailable and
the four setup URLs fall through to Pages copies whose resumable raw-range
behavior is unsafe and unvalidated. Never silently fall back to a workstation.

The pinned release tags and hashes are the recovery authority. Do not overwrite
release assets or reuse a version for changed bytes. The static deployment and
its rollback do not rebuild, delete, or relabel Android artifacts and do not
touch browser progress. If a public application server is ever needed again,
design and review it as a new deployment rather than restoring the retired
tunnel token or Compose service.
