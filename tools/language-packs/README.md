# Language pack contracts

This directory owns the versioned, language-neutral contract for Caatuu course
packs. The internal catalog at `apps/languages/catalog.json` lists active and
development packs. Only courses whose manifest status is `active` appear in the
release-capable `languages` collection of the generated public launcher
registry. Its separate `browserSetup` projection advertises browser-enabled
active and development courses without promoting previews to active status.

Each course manifest is authoritative for identity, routes, source and target
language tags, storage/cache namespaces, capabilities, platform support, the
browser server backend, and resource locations. A resource marked `present`
must exist with the declared file kind. A development course may reserve a
confined future path with `state: "planned"`; an active course may not.
Browser-enabled courses, including development previews, must provide present
course-scoped `staticRoot` and the canonical shared `appEntry` resource at
`apps/language-runtime/static/app/index.html`. The manifest `entryPath` is the
course-owned browser URL at which that same document is served. Public Pages
delivery remains separately gated. Active courses
must enable the browser because they are emitted into the clickable launcher;
retired courses cannot enable it.

Every manifest also names a publication contract. New courses use
`language-content-v1`, which points at their authoritative shared English
concepts and target realizations. English is the immutable audit/retrieval
language and is independent of `sourceLanguage`, which names the learner's base
language. A non-English learner base therefore needs its own reviewed
concept-ID-keyed realization; English concept text must not be relabeled as the
base language. `publication.learnerBaseRealizations` is `null` for an English
base and names a confined shared learner-base catalog for any other base.
Publication validation loads the English, base, and target catalogs as three
independent roles. Development validation accepts explicitly marked drafts, but
changing a course to `active` makes both catalog validation and launcher
generation enforce native review and release-cleared licensing.
That native-review requirement belongs to course activation and approved
pronunciation, not to packaging or publishing an APK that includes a disclosed
development course. Distribution still requires release-cleared licensing.
The existing Czech app alone uses the confined `legacy-active-v1` migration
marker; future courses cannot use that compatibility exception.

A `language-content-v1` course that enables Word World also declares
`publication.runtimeProjection`. That object binds the selected versioned
projection policy to the exact shared English runtime catalog, course-owned
target runtime catalog, optional learner-base runtime catalog, policy-defined
supplemental outputs, and `resources.wordWorldManifest`. Validation requires
the policy's exact supplemental-output key set, unique confined paths, and
manifest references that resolve to those declared outputs. The projection
policy may customize target pronunciation and supplementary presentation, but
it cannot replace the shared English, learner-base, target, or manifest
authority.

Each playable authored planet also requires its declared present course data:
Verb Lab uses `verbNebulaCatalog`, Word World uses `wordWorldManifest`,
Conjugation Comet uses `conjugationCometCatalog`, Case Cosmos uses
`caseCosmosCatalog`, Agreement Aurora uses `agreementAuroraCatalog`, and
Naturalization Nucleus uses `naturalizationNucleusCatalog`. This closes the
route-only failure mode in which the shared shell could expose a planet whose
course data was absent. The same shared planet registry assigns a versioned
English-audit contract to every one of those resources, and full validation
reads each real catalog to prove item-level English coverage.

The generated browser profile exposes those declared paths through
`gameContent[gameId][resourceName]`. Shared game hosts must read that projection
and resolve it inside the active course route; they must not infer a language
directory or embed a course ID. This is the runtime half of the one-app rule:
the game renderer is shared, while each course owns its reviewed content pack.

Per-item English translation/audit content is mandatory and is not the same as
the optional full `dictionary` capability. Czech currently supplies the full
dictionary provider; Mandarin and Spanish supply English concepts and token
glosses but do not claim that provider. Existing English-base data may use its legacy
source-role fields, but a non-English learner base must carry an explicit
`englishAuditText`, `english`, or `en` value rather than presenting base text as
English evidence. Enabling the full dictionary requires five present,
course-scoped file resources with distinct roles:

- `dictionaryCatalog` selects an active dictionary. Compatibility primary IDs
  live in `lookupLanguage` and `meaningLanguage`; authoritative
  `lookupLanguageTag` exactly matches the target locale and script, while
  `meaningLanguageTag` remains canonical English.
- `dictionaryCoreEntries` supplies the browsable, English-audited entries.
- `dictionaryScriptLines` supplies the reviewed script/example lines.
- `dictionaryReferenceDocument` supplies a constrained, inert HTML reference
  fragment for the shared dictionary layout.
- `dictionaryProvider` supplies the cache-versioned browser provider and
  declares its stable `providerId`. A provider that supports missing-entry
  review may also declare `gapReporting` with its exact active
  `dictionaryKey` and target-to-English `dictionaryDirection`; validation
  binds both values to the dictionary catalog. Without that declaration the
  shared app never persists or submits a dictionary-gap report.

The generated browser profile projects all five resources through
`dictionaryContent`, including the expected provider identity. The shared
workspace loads only those confined declarations. It rejects a catalog whose
lookup language differs from the course target or whose meaning language is
not English, and every rendered entry must pass the adapter's neutral
`targetText` plus `englishAuditText` presentation contract. The loaded provider
registration and its mount acknowledgement must both match the manifest's
`providerId`.

The contract keeps the English audit language independent of
`sourceLanguage`. Any browser, Android, or launcher delivery whose source
locale is not English must use `language-content-v1`, name a non-null reviewed
`publication.learnerBaseRealizations` catalog, and name a non-null
`publication.runtimeProjection.learnerBaseRuntime`. The currently reusable
non-English-base presentation path is Word World: playable games must be
limited to `word-net`, with `campaign` allowed only as its wrapper and not as a
route to another planet. The dictionary and every other current planet reject
that configuration with `source-language.presentation` until their shared
three-role rendering contracts exist.

Delivery closure is part of the same readiness check. Browser
`setup-assets.json` must include every runtime-projection output, including the
shared English-concept URL. An Android-enabled course must include every
course-scoped runtime-projection output in its `android-assets.json` file list,
and the app-wide asset catalog must bind each shared projection's exact source
to its exact runtime output. Missing, remapped, or duplicate bindings fail
closed. In addition, every browser course must cache exactly once by pathname
every `apps/language-runtime/` to `language-runtime/` mapping in
`apps/language-runtime/app-assets.json`; query-string revisions are allowed.
The exact build-only `course-service-worker.js` template mapping is excluded
because each course owns its generated worker. Missing, duplicate, or remapped
shared-runtime paths fail canonical course validation. The guarded Android
release builder runs this canonical course and generated-view validation before
Gradle.

Browser cache ownership is equally course-derived. A setup catalog must bind
`offline.cachePrefix` exactly to its manifest's `cache.prefix`, and its
versioned `offline.cacheName` must start with that exact prefix. Reusing a
sibling course's prefix is rejected before packaging so one worker's cache
replacement cannot select another course's caches.

This projection closure applies to every delivered `language-content-v1` Word
World course, including an English learner base; only the learner-base runtime
overlay is conditional. The shared authored renderer is reusable across
targets, but the current optional generation strategy is Czech-specific.
Consequently a non-Czech Word World course must keep `generation` disabled
until it owns an explicit versioned model/prompt/fallback strategy.

Browser embedding selections, shared embedding runtimes, and Android asset
allowlists each have their own versioned schema beside the course and catalog
schemas. When `embeddings` is enabled, the generated profile projects the
course's declared `embeddingCatalog` directly as `embeddingContent.catalog`;
the shared workspace does not load a Czech runtime or infer a conventional
path to discover it. Android catalogs also declare capability-matched native
providers, so packaging never infers a Czech vector database, dictionary, or
speech locale from a course ID.

The Android product bundle declaration must exactly match the catalog's
Android-enabled courses in catalog order and use the catalog default. The
publication plan carries both source and target language identities,
capabilities, routes, entries, and resolved native providers for every course;
missing, extra, reordered, or course-ID-inferred packages fail before assets
are emitted.

The explicit `llm`, `generation`, and `embeddings` flags prevent semantic
search from being coupled to text generation. The public launcher continues to
project the original eight discoverability capabilities. Browser course
profiles project the complete capability set, script and speech tags, and the
language-adapter module so runtime consumers do not infer policy from a course
ID. The internal manifest remains the authority for both views.

Optional browser implementations are explicit resources, not consequences of
a broad capability flag. When present, `courseRuntime`,
`semanticLearningProvider`, `setupProgressProvider`, and `setupProvider` must
each be a revisioned JavaScript file beneath that course's declared static
source root. The generated profile exposes them through `browserProviders`,
and the shared bootstrap loads only those declared modules in dependency
order. A future course therefore cannot inherit Czech runtime, semantic, or
setup code merely by enabling a similarly named capability.

The browser `backend` is also explicit. `dictionary-api-v1` requests the
versioned dictionary server protocol and requires the dictionary capability;
`static` mounts no language backend. Server implementations are registered
against that capability-oriented protocol and fail closed when no supported
provider is available. Tooling must not infer a backend or provider from a
course ID, language, directory, or resource name.

Pages publication preflights a catalog-derived browser-course plan and stages
each course whose browser and Pages flags are both enabled from its declared
setup catalog and route. `platforms.browser.enabled` means the canonical local
server may mount the course; `platforms.browser.pagesEnabled` is the separate
public staging gate. A new course therefore uses the same compiler and shared
runtime; missing entrypoints, assets, stale markers, or route collisions fail
before publication output is mutated. Pages-eligible modern content is also
validated with release licensing enabled. This prevents a local draft from
leaking into the public selector or offline graph without introducing a second
app layout.

## Validation in the established development container

Use the existing `caatuu-dev` container with the canonical checkout mounted at
`/workspace`. If it is unavailable, follow the root repository procedure; do
not create a parallel checkout, container, Compose project, or preview port.

Validate schemas, manifests, collisions, capabilities, resource confinement,
and present paths:

```sh
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs
```

Check every catalog browser course's setup closure and artifact hashes together:

```sh
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --check
```

Omit `--check` only when intentionally refreshing all validated browser-course
setup manifests; the tool validates and inspects the complete set before its
first write.

Check that the public launcher and every present course profile have not
drifted (including unlisted development courses):

```sh
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --check-views
```

When onboarding or changing courses, regenerate those catalog-derived views in
one guarded transaction:

```sh
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --sync-views
```

This is the validator's only write mode. It fully validates every manifest and
every non-generated present resource, checks the shared course-selector asset
mappings, then stages the launcher registry and every browser course profile
before replacing any of them. Only those exact generated outputs may be absent
or stale during this action; an invalid target or failed install rejects the
transaction and restores the prior generated views. Run the relevant content
projectors first, then refresh setup-asset hashes after synchronizing views.

Run the focused contract tests:

```sh
docker exec -w /workspace caatuu-dev node --test tools/language-packs/tests/course-contract.test.mjs
docker exec -w /workspace caatuu-dev node --test tools/language-packs/tests/generated-views.test.mjs
```

The generated views can be inspected without changing the worktree:

```sh
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --emit-launcher
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --emit-profile cz
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --emit-profile zh
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --emit-profile es
```

The emit modes remain read-only and are useful for review or debugging a
single view.
