# Static web bundle tooling

These compilers run only for an explicit **website** publication. Routine
Android releases select `deployment_scope=android` in the existing Pages
workflow: they reuse the published website snapshot and overlay exact signed
Android files without running either compiler. See the
[Android release workflow](../../android/tooling/README.md#canonical-release-workflow).
Website publication selects `deployment_scope=website` and automatically seals
its output as an immutable GitHub Release artifact for later Android updates.

`build-static-site.mjs` creates the reviewed browser-only `web-static-core`
intermediate. `build-pages-site.mjs` turns that intermediate into the final
`web-static-pages-cutover` bundle by adding every catalog-declared,
Pages-enabled browser course, every Android overlay in the append-only release
descriptor, and the fixed Android 162/161 preservation archive. Both builders
change only generated output; they do not edit the live server sources, Android
product, models, or canonical language source trees.

Run it in the established development container from the repository root:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-pages-site.mjs --baseline-archive artifacts/android/caatuu-pages-v162.tar --output artifacts/web/github-pages
```

The output directory is ignored generated material. The command builds into a
staging directory, validates the complete payload, and replaces the requested
generated output only after validation succeeds. Recheck an existing build
without rebuilding it:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-pages-site.mjs --baseline-archive artifacts/android/caatuu-pages-v162.tar --output artifacts/web/github-pages --validate-only
```

The input archive must be exactly 535,674,368 bytes with SHA-256
`9564bf5dc318ab642468787dd6ef23e4e70923887ca622620d045255734cc6c5`.
CI downloads it from the exact GitHub Release tag `caatuu-pages-v162`; neither
the workflow nor the builder resolves `latest`. Use `build-static-site.mjs`
directly only when reviewing the smaller browser-core boundary, never as the
final Pages publication command.

## Static profile

The browser core derives its selected course from the Pages language plan.
The shared application entry, launcher branding and common asset receipts have
no course owner. Every Pages course is staged from the same application entry;
a different default, or a catalog without Czech, does not require a Czech source
tree. Local progress and the selected course's reviewed games remain available.

The supported full-dictionary provider has an explicit static adaptation that
preserves its 865-record curated dictionary and form supplement. This adaptation
is selected by its declared provider, independently of the default course.
The common asset catalog preserves all 662 reviewed visual assets. A 2.5 MB static supplement preserves exact
dictionary matches for every Standard Word World surface resolved by the
existing pinned full dictionary (1,195 of 1,277 surfaces); its 82 source
dictionary misses retain the existing local gap behavior. First setup requires
the transformed keymaps and the three shared music tracks with their credits
and license texts. Music uses the same verified `caatuu-music-v1` cache across
courses and is excluded from worker precaches; the larger visual catalog is
downloaded and cached as it is used.

The browser core deliberately excludes Chat, language-model inference,
embedding models and databases, SQL/WASM model runtimes, the full server-backed
dictionary, Android packages, the standalone Godot preview, archives, and every
dynamic API.
Picture selection continues through the existing lexical keymap fallback. The
full-dictionary panel is relabeled as the static 865-record web dictionary.
The launcher export recognizes the shared interface's keyed Android labels and
replaces those two development-only labels with static publication copy. Their
development translation keys are removed so initialization cannot restore the
old copy; the exporter also rejects any returning server-only preview link.
Model-backed Skill Compass mapping is hidden, while ordinary progress and stats
remain available.

The checked-in Word World supplement is generated only from the hash-pinned
SQLite dictionary already maintained by the project. Regenerate it in the
established container after an intentional corpus or dictionary update:

```powershell
docker exec -w /workspace caatuu-dev python3 apps/launcher/tooling/build-static-word-world-dictionary.py
```

The generator verifies both source manifests and hashes before writing
`data/word-world-static-dictionary.v1.json`. The static bundle also includes
the dictionary attribution; it does not include the SQLite database.

The core exporter enforces an exact file set, hashes and sizes every file, validates
all published setup assets and keymap targets, checks JavaScript syntax and
local imports, resolves HTML and service-worker references, confirms the
792-record Standard Word World corpus, and rejects server/model paths or calls.
Its deterministic manifest is `caatuu-web-bundle.json`.

The final Pages builder derives its browser routes from the course catalog and
the explicit `platforms.browser.pagesEnabled` gate. Every registered course
is enabled: Czech at `/cz/`, Mandarin at `/zh/`, Spanish at `/es/`,
English for Spanish speakers at `/es-en/`, Norwegian Bokmål at `/nb/`,
Arabic at `/ar/`, Scientific Latin at `/la/`, Georgian at `/ka/`, Russian at
`/ru/`, and Hebrew at `/he/`. Every course manifest is `active`, and the
public pages are indexable. The builder
restores the stable 162 / compatibility 161 preservation archive and overlays
every exact Android release in the append-only descriptor.
It includes all retained aliases, all 662 release-162 native setup artifacts,
original keymaps, SQLite dictionary and vector database, ONNX/WASM runtime,
catalogs, and version-specific legacy assets. It regenerates every staged
browser course's setup receipt against the final Pages bytes and verifies the archive,
every final byte/hash, same-origin Android URLs, alias equality, service-worker
exclusions, range bypass, case collisions, and size ceiling before replacing
generated output. The launcher offers only the newest signed stable release;
older releases remain at their immutable version paths.
`/android/caatuu-debug.json` and the transition JSON remain.
Pages does not publish `/android/caatuu-debug.apk` or
`/android/debug-releases/product-transition/161/caatuu-transition.apk`.
The standalone
`/games/caatuu-game/` preview is not published until its separate game and
asset release gates pass. Dynamic application APIs are not added. The
Cloudflare Worker owns three reporting routes plus four exact large-asset
routes. The Pages bundle retains and validates preservation copies of those
four files, but live requests use the same Caatuu paths and stream the pinned
`caatuu-setup-assets-v1` Release bytes through the Worker for raw resume
semantics.

The Pages-only product overlay may defer local source copies of setup-delivered
embedding binaries that Git intentionally excludes. It still requires their
catalog receipts, and the frozen archive plus final Pages validation must supply
and match every declared byte and SHA-256. Normal Android product builds keep
the stricter default and fail when those local runtime files are absent.

## Shared browser asset receipts

`apps/launcher/static/assets/browser-assets.json` is the authored publication
allowlist and hash/size authority for shared visuals, keymaps, music and credits.
Its URLs and receipts were preserved from the prior delivery catalog. Course
setup catalogs remain delivery projections; none owns this shared authority.
Adding or removing a shared asset requires an explicit reviewed catalog edit.

After an intentional shared asset edit, refresh the declared receipts first,
then refresh the course delivery receipts using the existing generator:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/refresh-browser-assets.mjs --write
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses
```

Use `--check` instead of `--write` to detect drift without changing the shared
catalog. The refresher never discovers or adds files, and rejects source aliases,
paths outside the shared authority, and duplicate destinations. Publication
still validates every declared hash and byte count against the actual file.

New shared worker caches use `caatuu-web-static-*`. Activation removes superseded
shared caches, including the historical Czech-prefixed shared caches, while
retaining other courses' caches and the verified shared music cache.

## Hosting boundary

For APK publication and retries, use the
[Android release operations runbook](../../../docs/ANDROID_RELEASE_OPERATIONS.md).
The existing Pages workflow's default Android scope preserves the published
website bytes; it does not run the website compiler. Changing website sources
requires explicit `deployment_scope=website`. A complete Pages artifact upload
is transport, not a reason to recompile the website for every APK.

The landing page's language control changes only page copy. Its small catalogs
live in `launcher-interface.mjs`, independently of learner preferences and
course publication. Both locales retain every course available in the current
registry, the same browser entry and the same Caatuu Android download. Pages
keeps its catalog publication boundary and preserves the language-change
handler when replacing the server's service-worker setup. The executable
`launcher-locale-behavior.test.mjs` covers both launcher variants.

Historical artwork keeps the public path and byte identity pinned in the
preservation descriptor. Current artwork uses a separate content-addressed URL;
renaming its local source must not require renaming the historical download.
The Pages artwork regression checks both files' hashes independently.

Pages reporting uses the v2 course catalog generated from the selected course
declarations. Sentence sharing requires consent for each report; dictionary
sharing requires a declared dictionary provider and a separate, default-off,
future-only opt-in. Queues are scoped to the course/language tuple. Existing
legacy queues stay local, and unavailable reporting initialization leaves local
reporting available. Status copy follows the actual authorized queue result.

The additive reporting database migration must be applied before deploying the
v2 Worker, and that Worker must be ready before publishing the new Pages client.
These source changes and tests do not apply migrations or deploy either service.
See the [reporting Worker guide](../../reporting-worker/README.md) for the
authorized rollout sequence. Android deployment repairs continue to reuse the
finalized APK receipt.

The published UI uses origin-root asset and course paths, including `/assets/`,
`/cz/`, `/zh/`, `/es/`, and `/es-en/`.
Publication therefore requires `https://caatuu.waajacu.com` at the root; a
GitHub project subpath is not compatible. The manual Pages workflow checks that
configuration before it uploads anything and deploys through the Pages artifact
API. It never creates a publication branch.

See [`docs/STATIC_WEB_HOSTING.md`](../../../docs/STATIC_WEB_HOSTING.md) for the
external setup, validation, DNS cutover, and rollback sequence.
