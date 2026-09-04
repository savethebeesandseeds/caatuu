# Caatuu Language App Contract

Caatuu is one product with shared application contracts and language-owned,
reviewed game data. English is the permanent semantic retrieval and content-
audit authority; that is different from a future cross-language curriculum,
which may coordinate learning sequences but is not currently a runtime
authority. A new language should not require a fork of navigation, setup,
updates, feedback, storage, or the Android WebView shell.

## The six layers

1. **Product shell** owns the launcher, theme, navigation, settings, setup,
   update flow, feedback outbox, accessibility conventions, and platform
   boundaries.
2. **Reviewed game data** supplies the authored challenges used by each game.
   Every assessed item retains an English translation/audit anchor even when
   both learner-facing languages are non-English. Data must remain
   deterministic, inspectable, and independent of runtime model generation.
3. **Course profile** owns stable metadata: route, learner source/base and
   target languages, locale, writing direction, storage namespace,
   capabilities, linguistic features, enabled games, and public entry paths.
4. **Target-language adapter** owns real linguistic differences:
   natural utterances, accepted variants, tokenization, normalization,
   morphology, dictionaries, prompts, model catalogs, sentence rendering,
   scaffolding, and language-specific game presentation within shared layout
   slots. It may change what a component renders, not replace the product or
   game topology.
5. **Game implementation** owns language-independent mechanics and generated
   delivery artifacts. A standalone game does not require a language adapter
   and remains outside language and Android packages. If a game is deliberately
   embedded later, a language adapter may provide localized host copy,
   curriculum bindings, and navigation placement, but never owns engine source
   or compiled game payloads.
6. **Platform adapter** supplies browser or Android implementations for the
   capabilities requested by a course profile.

Do not move morphology or prompts into the product shell merely to make them
look shared. Share a mechanic only when its inputs and outputs can be described
without naming a particular language.

## Authoritative contracts

- `apps/languages/catalog.json` is the internal course catalog. It reserves
  identities and route prefixes for active and development packs.
- Each catalog entry points to one authoritative
  `apps/languages/<pack>/course.json`. That manifest owns identity, language
  and script tags, speech locale, route, storage/cache namespaces,
  capabilities, browser backend, platform eligibility, adapter, and resources.
- Every browser course names the same shared `resources.appEntry`:
  `apps/language-runtime/static/app/index.html`. A course owns its public route
  and content root, but it cannot own or replace the product document.
- Every browser course's setup offline list contains exactly once by URL
  pathname every canonical `apps/language-runtime/` to `language-runtime/`
  mapping in `apps/language-runtime/app-assets.json`. Cache-busting queries may
  differ between courses; missing, duplicate, or remapped pathnames fail
  validation. The exact build-only `course-service-worker.js` template mapping
  is excluded because publication generates the course-owned worker.
- A browser setup manifest's `offline.cachePrefix` is exactly the owning
  course's `cache.prefix`, and its versioned `offline.cacheName` begins with
  that same prefix. A copied prefix from another course is invalid: service
  workers use this boundary when replacing their own caches and must never be
  able to select a sibling course's cache namespace.
- Each manifest also names its publication contract. New packs use
  `language-content-v1` with authoritative English-concept and target-
  realization paths. The concept catalog language is always English and does
  not have to equal `sourceLanguage`, which is the learner's base language.
  Word World courses additionally declare `publication.runtimeProjection`,
  binding a versioned projection policy to the exact shared English output,
  course-owned target output, optional learner-base output, supplemental
  outputs, and runtime manifest. The manifest must be the declared
  `resources.wordWorldManifest`, and its references must resolve exactly to
  those outputs.
  Development validation permits explicit draft gates;
  active-course validation and launcher generation require native review and
  release-cleared licenses. The Czech-only `legacy-active-v1` marker is a
  confined migration exception and cannot be selected by another course.
  Native review is not a packaging or APK-publication gate for an explicitly
  disclosed development course; licensing remains a distribution gate.
- `apps/launcher/static/languages.json` is a checked launcher projection. Its
  release-capable `languages` collection contains active courses only;
  `browserSetup.courses` separately contains browser-enabled active and
  development courses. Neither is a second configuration authority.
- Each enabled authored game names a present, course-scoped content resource.
  In Czech, game-owned data lives under
  `apps/languages/czech/static/data/games/<game-id>`. Merely declaring a route
  or capability must never make a planet playable without its declared data.
  That same shared planet registry names an `englishAuditContract` for each
  authored resource. Course validation reads the real catalogs (including the
  linked legacy Word World runtime) and rejects any assessed item without an
  English audit value. Game-specific validators remain responsible for the
  rest of their review and item integrity.
- A future shared curriculum contract must be designed and reviewed separately.
  The retired experimental `apps/curriculum` package is not part of the runtime.
- Each language pack provides generated `course-profile.js` before runtime
  code. It exposes immutable `window.CaatuuCourse` metadata, the complete
  capability policy, its adapter module, and any explicitly declared
  `browserProviders`. Optional course runtime, semantic-learning, setup-
  progress, and setup providers must be revisioned JavaScript resources under
  that course's exact static source root; the shared bootstrap never infers
  them from a capability or course identity. Drift from `course.json` fails
  the language-pack checks.
- `apps/server/src/language_catalog.rs` validates and mounts browser-enabled
  packs from the internal catalog. The capability-oriented backend is explicit;
  the server resolves only registered implementations and never infers one from
  a course or language ID.
- `apps/launcher/tooling/pages-language-plan.mjs` derives public browser-course
  coverage from that same catalog. `platforms.browser.enabled` controls local
  browser mounting, while the separate `pagesEnabled` flag controls Pages
  eligibility. The Pages compiler stages one shared app document plus
  course-owned data for every eligible course and removes local-only courses
  from its generated registry, fallback, selectors, routes, and offline graph.
- `apps/games/catalog.json` indexes authored games and their delivery
  manifests. Feature-enabled standalone exports are served through `/games/**`,
  independently of a language route. Catalog membership alone does not add a
  game to a language application or Android build.
- Android preflights the exact ordered set of Android-enabled courses in the
  language catalog against its bundle declaration. Its publication plan
  carries each course's source and target languages, route, entry path,
  capabilities, native providers, static root, and per-course allowlist before
  generating `BuildConfig`. The WebView must not contain any literal course
  route.

## Capability boundary

A profile declares which mechanics are available, but it does not implement
them. Current capability names are:

- `llm`
- `generation`
- `chat`
- `embeddings`
- `semanticSearch`
- `skillCompass`
- `dictionary`
- `memory`
- `verbs`
- `wordWorld`
- `conjugationComet`
- `offlineModels`
- `speech`
- `pronunciationGuides`

Future shared UI must hide an absent capability instead of assuming every
language has Czech verbs, a Czech-English dictionary, or the same model slots.
`embeddings` and `semanticSearch` do not imply `llm`, `generation`, or `chat`.

The mandatory English translation/audit anchor on each learning item is not
the `dictionary` capability. `dictionary` means a complete interactive
lexicon/search provider.
Czech currently has that feature; Mandarin and Spanish have authored token
glosses and English concepts but no full dictionary. A new full dictionary
must supply a language-neutral provider and presentation contract instead of
selecting the Czech implementation through a boolean flag. A dictionary-
enabled manifest explicitly declares five present, course-scoped resources:
`dictionaryCatalog`, `dictionaryCoreEntries`, `dictionaryScriptLines`,
`dictionaryReferenceDocument`, and `dictionaryProvider`. The catalog keeps
compatibility primary IDs in `lookupLanguage`/`meaningLanguage`, while
authoritative `lookupLanguageTag` must exactly match the target locale and
script and `meaningLanguageTag` must remain canonical English. The
provider declares a stable `providerId` and cache revision, and both its browser
registration and mount acknowledgement must match that identity. The adapter
presents every item as target text plus mandatory English audit text, while the
reference fragment remains inert content inside the one shared layout. The
generated course profile projects every declaration; the shared workspace
never guesses a Czech, Verb Lab, or conventional language-data path.

Missing-entry reporting is a separate, opt-in provider contract. A dictionary
provider may declare `gapReporting` only with the exact active catalog
`dictionaryKey` and its target-to-English `dictionaryDirection`; the generated
profile binds those values to the same `providerId`. With no declaration—or
with any identity mismatch—the shared app neither stores nor submits a gap.
This prevents a future dictionary from silently sending words to the Czech
review ledger.

Browser backends name protocols, not languages. `dictionary-api-v1` requests
the registered dictionary server protocol and requires the dictionary
capability; `static` mounts no course backend. An unknown protocol, missing
provider implementation, or identity mismatch fails closed.

An embeddings-enabled course similarly declares `embeddingCatalog`. Its
generated profile projects that resource directly as
`embeddingContent.catalog`, so the shared workspace can load it without a
Czech runtime dependency or inferred path. The shared loader discriminates by
schema rather than course ID: it accepts the legacy `models` artifact catalog
used by the Czech vector database or the versioned course embedding-selection
schema used by Mandarin, Spanish, and future courses. A course selection must name its
own course, keep English `embeddingText` as the only model input, reject target
text and pronunciation as embedding inputs, and declare its runtime notices.

Developer and diagnostic destinations are course-owned optional routes. Shared
Chrome may expose `routes.chat`, `routes.audioLab`, `routes.dictionary`,
`routes.embeddingImages`, or `routes.verbDifficulty` only when both that route
and its required capability set are present. It must not infer conventional
Czech filenames for another course, and it removes the Developer section when
no authored tool routes are available.

Capabilities describe whether a runtime mechanic exists. Linguistic features
describe whether a language has the concept a game teaches. The shared game
registry combines both with an explicit course `games` list and route. For
example, Conjugation Comet requires `verb-conjugation`, Case Cosmos requires
`grammatical-case`, and Agreement Aurora requires
`grammatical-agreement`. No course ID or locale is allowed in that decision.

## Current course and planet support

| Course | Lifecycle | Manifest-declared planets | Upcoming | Full dictionary |
| --- | --- | --- | --- | --- |
| Czech (`cz`, target `cs-CZ`) | Active | Campaign, Verb Lab, Word World, Conjugation Comet, Case Cosmos, Agreement Aurora | Memory Moon, Sounds Quasar | Yes |
| Mandarin (`zh`, target `zh-Hans`) | Development preview | Verb Lab, Word World, Naturalization Nucleus | Memory Moon, Sounds Quasar | No |
| Spanish (`es`, target `es-ES`) | Local development preview | Verb Lab, Word World, Conjugation Comet, Agreement Aurora | Memory Moon, Sounds Quasar | No |

All three are browser-enabled in source. Pages currently includes Czech and
Mandarin; Android contains Czech and Mandarin only. Spanish remains local-only
until a licensed publication is explicitly enabled.

Spanish's current playable authored set is Verb Lab, Word World, Conjugation
Comet, and Agreement Aurora. The generated course profile exposes each
course-owned, revisioned catalog through `gameContent`; shared game hosts read
only that projection and never infer a language directory. Conjugation Comet
and Agreement Aurora use the registry's exact language-neutral host routes,
`/language-runtime/static/games/conjugation-comet.html` and
`/language-runtime/static/games/agreement-aurora.html`. Czech, Spanish, and
future courses therefore share the same game document, layout, styles, host,
and core controller. Language-specific copy, rules, accepted answers, and
custom presentation remain reviewed course content or adapter behavior inside
the shared layout rather than course-owned game forks.

Except for the exact `/` language selector and a route key's exact
registry-declared shared host, course routes are confined relative paths.
Schemes, protocol-relative URLs, fragments, backslashes, and literal or encoded
path traversal are invalid.

Planet readiness is a conjunction, not a language allowlist:

| Planet | Required course data | Additional requirement |
| --- | --- | --- |
| Verb Lab | `verbNebulaCatalog` | `routes.verbNebula` |
| Word World | `wordWorldManifest` | `wordWorld` capability and `routes.wordWorld` |
| Conjugation Comet | `conjugationCometCatalog` | `conjugationComet`, `verb-conjugation`, and its route |
| Case Cosmos | `caseCosmosCatalog` | `grammatical-case` and its route |
| Agreement Aurora | `agreementAuroraCatalog` | `grammatical-agreement` and its route |
| Naturalization Nucleus | `naturalizationNucleusCatalog` | `hanzi-pinyin`, a Chinese target, and its route |
| Memory Moon | No authored catalog yet | `memory` and its route when promoted from upcoming |
| Sounds Quasar | No authored catalog yet | `speech`, reviewed language-owned audio/challenge authority, and its route when promoted from upcoming |
| Campaign | No separate catalog | Its route and at least one explicitly Campaign-eligible playable planet |

Mandarin and Spanish do not declare Campaign directly; Spanish Campaign is
derived by the shared shell from its eligible playable planets. One immutable shared registry now governs
planet IDs, routes, capabilities, linguistic features, content resources, and
Campaign eligibility in both browser runtime and language-pack validation.
Verb Lab, Word World, Conjugation Comet, Case Cosmos, and Agreement Aurora are
Campaign-eligible; Naturalization Nucleus, Memory Moon, and Sounds Quasar are
intentionally not. Campaign is available after one eligible planet, whether
its availability is derived by the shell or validated from an explicit course
declaration.

## Semantic and realization boundary

The shared MiniLM contract embeds authored English only. Three language roles
must remain distinct:

1. `sourceLanguage` is the learner's base/prompt language.
2. `targetLanguage` is the language being learned.
3. The audit/retrieval language is invariantly English.

English concepts and asset descriptions have stable IDs; each course supplies
separate target realizations for those IDs. If `sourceLanguage` is not English,
the same IDs also need a reviewed learner-base realization. Do not relabel the
English concept text as the learner base. Joined learning records retain their
English audit value, while only English `embeddingText` enters semantic search.
Target text, learner-base text, pronunciation objects, tokenization, glosses,
and review metadata may be joined for learning, but none may enter the English
embedder or embedding-document metadata.

The course publication object makes this third role explicit through
`learnerBaseRealizations`. English-base courses must set it to `null` and may
not duplicate the English concept catalog. A non-English base must point it at
a confined shared learner-base catalog with exact concept-ID coverage,
independent review evidence, and independent licensing evidence. The same
reviewed base overlay can therefore mediate multiple target courses without
copying either target text or English retrieval text.

`language-content-v1` enforces the concept-ID English-to-target join for modern
Word World content. Every authored planet resource additionally declares a
versioned English-audit contract in the shared planet registry. Current
English-base catalogs retain compatibility with legacy game fields such as
`en`, `source`, `meaning`, `english`, and `translation`; a non-English learner
base cannot use its source-role field as audit evidence and must carry a
separate `englishAuditText` (or explicitly named `english`/`en`) value. Thus
resource presence and per-item English coverage are both checked before a
course is considered valid.

`tools/semantic-index` enforces this separation for generated indexes.
Target-language adapters own normalization and segmentation. Mandarin content
selects the named `mandarin-simplified-v1` content policy for Hans, contextual
pinyin, and polyphone-safe authored word boundaries; the shared realization
schema contains no Mandarin-specific rules. Pronunciation uses
`{ system, notation, languageTag, reviewed }`, and every `reviewed` value must
agree with the catalog-wide native-review gate. Draft learner projections use
their own narrow runtime schemas and omit unreviewed pronunciation entirely.
Only the schema-defined `native-reviewed` state may enable authored
pronunciation guides; aliases such as `approved` are not accepted. Course-owned
text-to-speech may remain available independently when its locale and platform
contracts are satisfied.

Spanish selects `spanish-spain-v1`: authored word boundaries, accent-preserving
answer comparison, accent-folded search, and no pronunciation guide until a
separate reviewed pronunciation policy is approved.

## Adding a language

1. Add a development manifest to `apps/languages/catalog.json`; choose one
   stable course route such as `/zh` and reserve any replaced route as an alias.
2. Create the adapter and deterministic realization data for each enabled
   game. Give every assessed item an English translation/audit anchor. If the
   learner base is not English, add a separate base-language realization
   keyed by the same stable concept ID; keep all three roles separate.
3. Give every persisted key a course-specific namespace. Never reuse another
   course's progress keys.
4. Declare linguistic features separately from runtime capabilities. Enable a
   game only when its required feature, route, implementation, and reviewed
   content all exist.
5. Mark only existing, confined resources `present`. Every enabled authored
   planet must name its own present course resource. Enable only capabilities
   whose runtime, provider, presentation, and reviewed data are complete.
6. Use the `static` backend unless the course implements a registered,
   capability-oriented server protocol such as `dictionary-api-v1`. For a
   dictionary, declare all five resources, the exact target-locale/English
   language pair,
   and one provider identity shared by the manifest and runtime registration.
7. If Android is enabled, add the course manifest and asset catalog in catalog
   order. Otherwise keep `platforms.android.enabled` false and leave the course
   out of the bundle. Declare capability-matched native providers and both
   source and target presentation; the catalog-derived bundle plan rejects
   omissions, extras, and reordering.
8. Run language-pack, content, semantic, browser/offline, server, publication,
   and Android audits. Pages and Android both compare their declared delivery
   sets against the browser- or Android-enabled catalog courses and fail closed
   on omissions, extras, duplicates, reordering, and default-course drift. Add
   each enabled platform's delivery implementation deliberately before launch. Change `status`
   to `active` only after linguistic, licensing, route, and platform review;
   then regenerate/check the launcher projection.

The manifest model keeps English audit authority independent from the learner
base. Any browser, Android, or launcher delivery whose source locale is not
English must use `language-content-v1`, provide a non-null reviewed
`publication.learnerBaseRealizations` catalog, and project it through a
non-null `publication.runtimeProjection.learnerBaseRuntime`. The currently
complete shared presentation paths are Word World, Conjugation Comet, and
Agreement Aurora. Their registered contracts keep learner-base presentation
separate from English audit authority; the two grammar games also keep English
audit fields out of playable round projections. Campaign may wrap only planets
whose presentation contracts are ready. Dictionary, Verb Lab, Case Cosmos,
and Naturalization Nucleus fail closed with `source-language.presentation`
until they implement the same three-role rendering contract. This readiness is declared by the shared learner-base
presentation registry, not by a language or course allowlist: each game or
capability names a presentation contract and its required English and
learner-base authorities. Campaign derives readiness from every planet it
contains. Adding a presentation path extends that registry and its validator;
it never weakens the English audit requirement.

Every enabled platform must also contain the declared projection closure.
Browser `setup-assets.json` includes every projection output, including the
shared English-concept URL and each enabled game's exact revisioned course
catalog URL. Android `android-assets.json` includes every
course-scoped projection output, while the app-wide asset catalog must map
each shared projection from its exact repository source to its exact runtime
output. Missing, remapped, or duplicate English authority mappings fail before
Gradle. These packaging requirements prevent a valid authoring join from
becoming a partially available offline app.

Word World's deterministic authored-content renderer is language-neutral.
Its optional local generation strategy is not yet: the registered models,
prompts, and fallbacks are Czech-specific. Validation and runtime therefore
reject `generation: true` for a non-Czech Word World course until that course
declares and implements an explicit versioned generation strategy. This keeps
new languages on the shared layout without silently generating the wrong
language.

Archived experiments are not active language apps. Moving an archive into the
registry requires behavior parity, not only a redirect or a matching screen.
The fresh Mandarin pack is unrelated to the repository-only Chinese archive.
Legacy `/zh-hans/*` URLs redirect to the canonical `/zh/*` course; archive UI
and backend routes remain unreachable.
