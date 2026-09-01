# Static web bundle tooling

`build-static-site.mjs` creates the reviewed `web-static-core` bundle used by
GitHub Pages. It builds on the existing Android product compiler, then changes
only its generated copy. The live server sources, Android product, models, and
the canonical Czech source tree are not edited by the build.

Run it in the established development container from the repository root:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-static-site.mjs --output artifacts/web/github-pages
```

The output directory is ignored generated material. The command builds into a
staging directory, validates the complete payload, and replaces the requested
generated output only after validation succeeds. Recheck an existing build
without rebuilding it:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-static-site.mjs --output artifacts/web/github-pages --validate-only
```

## Static profile

The bundle preserves the launcher, Czech interface, ordinary local progress,
the 865-record curated dictionary, the four browser learning games, and all
646 reviewed visual assets. A 2.5 MB static supplement preserves exact
dictionary matches for every Standard Word World surface resolved by the
existing pinned full dictionary (1,195 of 1,277 surfaces); its 82 source
dictionary misses retain the existing local gap behavior. Only the three
transformed keymaps are required during first setup; the larger visual catalog
is downloaded and cached as it is used.

The generated bundle deliberately excludes Chat, language-model inference,
embedding models and databases, SQL/WASM model runtimes, the full server-backed
dictionary, Android packages, Godot previews, archives, and every dynamic API.
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

The exporter enforces an exact file set, hashes and sizes every file, validates
all published setup assets and keymap targets, checks JavaScript syntax and
local imports, resolves HTML and service-worker references, confirms the
792-record Standard Word World corpus, and rejects server/model paths or calls.
Its deterministic manifest is `caatuu-web-bundle.json`.

## Hosting boundary

The UI uses origin-root `/assets/` and `/cz/` paths. Publication therefore
requires `https://caatuu.waajacu.com` at the root; a GitHub project subpath is
not compatible. The manual Pages workflow checks that configuration before it
uploads anything and deploys through the Pages artifact API. It never creates a
publication branch.

See [`docs/STATIC_WEB_HOSTING.md`](../../../docs/STATIC_WEB_HOSTING.md) for the
external setup, validation, DNS cutover, and rollback sequence.
