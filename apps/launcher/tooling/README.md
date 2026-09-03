# Static web bundle tooling

`build-static-site.mjs` creates the reviewed browser-only `web-static-core`
intermediate. `build-pages-site.mjs` turns that intermediate into the final
`web-static-pages-cutover` bundle by adding the unlisted Mandarin browser
preview, every Android overlay in the append-only release descriptor, and the
fixed Android 162/161 preservation archive. Both builders change only generated
output; they do not edit the live server sources, Android product, models, or
canonical language source trees.

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

The Czech-only browser core preserves the launcher, Czech interface, ordinary
local progress, the 865-record curated dictionary, the six embedded browser
learning games, and all
646 reviewed visual assets. A 2.5 MB static supplement preserves exact
dictionary matches for every Standard Word World surface resolved by the
existing pinned full dictionary (1,195 of 1,277 surfaces); its 82 source
dictionary misses retain the existing local gap behavior. Only the three
transformed keymaps are required during first setup; the larger visual catalog
is downloaded and cached as it is used.

The browser core deliberately excludes Chat, language-model inference,
embedding models and databases, SQL/WASM model runtimes, the full server-backed
dictionary, Android packages, the standalone Godot preview, archives, and every
dynamic API.
Picture selection continues through the existing lexical keymap fallback. The
full-dictionary panel is relabeled as the static 865-record web dictionary.
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

The final Pages builder adds the unlisted, `noindex` Mandarin development
course at `/zh/`, restores the stable 162 / compatibility 161 preservation
archive, and overlays every exact Android release in the append-only descriptor.
It includes all retained aliases, all 662 release-162 native setup artifacts,
original keymaps, SQLite dictionary and vector database, ONNX/WASM runtime,
catalogs, and version-specific legacy assets. It regenerates both published
browser setup receipts against the final Pages bytes and verifies the archive,
every final byte/hash, same-origin Android URLs, alias equality, service-worker
exclusions, range bypass, case collisions, and size ceiling before replacing
generated output. The launcher offers only the newest signed stable release;
older releases remain at their immutable version paths, and transition 161
remains at its compatibility path and technical
`caatuu-debug.*` aliases for already-installed clients. The standalone
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

## Hosting boundary

The UI uses origin-root `/assets/`, `/cz/`, and `/zh/` paths. Publication therefore
requires `https://caatuu.waajacu.com` at the root; a GitHub project subpath is
not compatible. The manual Pages workflow checks that configuration before it
uploads anything and deploys through the Pages artifact API. It never creates a
publication branch.

See [`docs/STATIC_WEB_HOSTING.md`](../../../docs/STATIC_WEB_HOSTING.md) for the
external setup, validation, DNS cutover, and rollback sequence.
