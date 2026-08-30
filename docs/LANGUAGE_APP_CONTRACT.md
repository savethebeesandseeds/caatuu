# Caatuu Language App Contract

Caatuu is one product with shared application contracts and language-owned,
reviewed game data. A future cross-language curriculum may coordinate learning
sequences, but it is not currently a runtime authority. A new language should
not require a fork of navigation, setup, updates, feedback, storage, or the
Android WebView shell.

## The six layers

1. **Product shell** owns the launcher, theme, navigation, settings, setup,
   update flow, feedback outbox, accessibility conventions, and platform
   boundaries.
2. **Reviewed game data** supplies the authored challenges used by each game.
   It must remain deterministic, inspectable, and independent of runtime model
   generation.
3. **Course profile** owns stable metadata: route, source and target languages,
   locale, writing direction, storage namespace, capabilities, linguistic
   features, enabled games, and public entry paths.
4. **Target-language adapter** owns real linguistic differences:
   natural utterances, accepted variants, tokenization, normalization,
   morphology, dictionaries, prompts, model catalogs, sentence rendering,
   scaffolding, and language-specific game presentation.
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
- Each manifest also names its publication contract. New packs use
  `language-content-v1` with authoritative English-concept and target-
  realization paths. Development validation permits explicit draft gates;
  active-course validation and launcher generation require native review and
  release-cleared licenses. The Czech-only `legacy-active-v1` marker is a
  confined migration exception and cannot be selected by another course.
- `apps/launcher/static/languages.json` is a checked public-launcher
  projection. It contains active courses only and is not a second source of
  configuration.
- Each game currently reads its reviewed language data directly. In Czech,
  game-owned data lives under `apps/languages/czech/static/data/games/<game-id>`.
- A future shared curriculum contract must be designed and reviewed separately.
  The retired experimental `apps/curriculum` package is not part of the runtime.
- Each language pack provides generated `course-profile.js` before runtime
  code. It exposes immutable `window.CaatuuCourse` metadata, the complete
  capability policy, and its adapter module. Drift from `course.json` fails the
  language-pack checks.
- `apps/server/src/language_catalog.rs` validates and mounts browser-enabled
  packs from the internal catalog. The backend is explicit; the server never
  infers it from a language ID.
- `apps/games/catalog.json` indexes authored games and their delivery
  manifests. Feature-enabled standalone exports are served through `/games/**`,
  independently of a language route. Catalog membership alone does not add a
  game to a language application or Android build.
- Android receives one `caatuuCourseManifest` property. Gradle derives the
  bundled ID, route, entry path, capabilities, static root, and per-course
  allowlist before generating `BuildConfig`. The WebView must not contain a
  literal course route such as `/cz` or `/zh`.

## Capability boundary

A profile declares which mechanics are available, but it does not implement
them. Current capability names are:

- `llm`
- `generation`
- `chat`
- `embeddings`
- `semanticSearch`
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

## Semantic and realization boundary

The shared MiniLM contract embeds authored English only. English concepts and
asset descriptions have stable IDs; each course supplies separate target
realizations for those IDs. Target text, generic pronunciation objects,
tokenization, glosses, and review metadata may be joined for learning, but none
may enter the English embedder or embedding-document metadata.

`tools/semantic-index` enforces this separation for generated indexes.
Target-language adapters own normalization and segmentation. Mandarin content
selects the named `mandarin-simplified-v1` content policy for Hans, contextual
pinyin, and polyphone-safe authored word boundaries; the shared realization
schema contains no Mandarin-specific rules. Pronunciation uses
`{ system, notation, languageTag, reviewed }`, and every `reviewed` value must
agree with the catalog-wide native-review gate. Draft learner projections use
their own narrow runtime schemas and omit unreviewed pronunciation entirely.
Only the schema-defined `native-reviewed` state may enable pronunciation or
speech; aliases such as `approved` are not accepted.

## Adding a language

1. Add a development manifest to `apps/languages/catalog.json`; choose one
   stable course route such as `/zh` and reserve any replaced route as an alias.
2. Create the adapter and deterministic realization data for each enabled
   game. Keep English concepts and embedding inputs separate.
3. Give every persisted key a course-specific namespace. Never reuse another
   course's progress keys.
4. Declare linguistic features separately from runtime capabilities. Enable a
   game only when its required feature, route, implementation, and reviewed
   content all exist.
5. Mark only existing, confined resources `present`, and enable only
   capabilities whose runtime and reviewed data are complete.
6. Use a static backend unless the course implements a named server API.
7. Give Android a course allowlist and build from `caatuuCourseManifest`.
8. Run language-pack, content, semantic, browser/offline, server, and Android
   audits. Change `status` to `active` only after linguistic, licensing, route,
   and platform review; then regenerate/check the launcher projection.

Archived experiments are not active language apps. Moving an archive into the
registry requires behavior parity, not only a redirect or a matching screen.
The fresh Mandarin pack is unrelated to the repository-only Chinese archive.
Legacy `/zh-hans/*` URLs redirect to the canonical `/zh/*` course; archive UI
and backend routes remain unreachable.
