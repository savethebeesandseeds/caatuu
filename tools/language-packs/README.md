# Language pack contracts

This directory owns the versioned, language-neutral contract for Caatuu course
packs. The internal catalog at `apps/languages/catalog.json` lists active and
development packs. Only courses whose manifest status is `active` appear in the
generated public launcher registry.

Each course manifest is authoritative for identity, routes, source and target
language tags, storage/cache namespaces, capabilities, platform support, the
browser server backend, and resource locations. A resource marked `present`
must exist with the declared file kind. A development course may reserve a
confined future path with `state: "planned"`; an active course may not.
Browser-enabled courses, including development previews, must provide present
course-scoped `staticRoot` and `entryFile` resources, and the entry file's path
must map exactly to the URL suffix declared by `entryPath`. Active courses must
enable the browser because they are emitted into the clickable launcher;
retired courses cannot enable it.

Every manifest also names a publication contract. New courses use
`language-content-v1`, which points at their authoritative shared English
concepts and target realizations. Development validation accepts explicitly
marked drafts, but changing a course to `active` makes both catalog validation
and launcher generation enforce native review and release-cleared licensing.
The existing Czech app alone uses the confined `legacy-active-v1` migration
marker; future courses cannot use that compatibility exception.

Browser embedding selections, shared embedding runtimes, and Android asset
allowlists each have their own versioned schema beside the course and catalog
schemas. Android catalogs also declare capability-matched native providers, so
packaging never infers a Czech vector database, dictionary, or speech locale
from a course ID.

The explicit `llm`, `generation`, and `embeddings` flags prevent semantic
search from being coupled to text generation. The public launcher continues to
project the original eight discoverability capabilities. Browser course
profiles project the complete capability set, script and speech tags, and the
language-adapter module so runtime consumers do not infer policy from a course
ID. The internal manifest remains the authority for both views.

The browser `backend` is also explicit. `czech-dictionary` mounts the existing
Czech dictionary API; `static` mounts no language backend. Server tooling must
not infer this choice from a language ID, directory, or resource name.

## Validation in the established development container

Start the existing container if it is not already running:

```sh
docker compose --profile dev up -d caatuu-dev
```

Validate schemas, manifests, collisions, capabilities, resource confinement,
and present paths:

```sh
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs
```

Check that the public launcher and every present course profile have not
drifted (including unlisted development courses):

```sh
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --check-views
```

Run the focused contract tests:

```sh
docker exec -w /workspace caatuu-dev node --test tools/language-packs/tests/course-contract.test.mjs
```

The generated views can be inspected without changing the worktree:

```sh
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --emit-launcher
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --emit-profile cz
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --emit-profile zh
```

The validator has no write mode. Integrators should review emitted output and
make the corresponding consumer change deliberately.
