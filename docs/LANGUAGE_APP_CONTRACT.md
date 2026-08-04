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
   locale, writing direction, storage namespace, capabilities, and entry paths.
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

- `apps/launcher/static/languages.json` is the public registry used by the
  launcher. Only active, reachable language apps belong there.
- Each game currently reads its reviewed language data directly. In Czech,
  Conjugation Comet reads `apps/languages/czech/static/data/verbs.json`.
- A future shared curriculum contract must be designed and reviewed separately.
  The retired experimental `apps/curriculum` package is not part of the runtime.
- Each language app provides `course-profile.js` before `runtime.js` and shared
  Chrome. It exposes an immutable `window.CaatuuCourse` object containing the
  course metadata and enabled capabilities.
- `apps/server/src/routes/mod.rs` mounts active apps from its route
  registry. The route and entry path must match the public registry.
- `apps/games/catalog.json` indexes authored games and their delivery
  manifests. Feature-enabled standalone exports are served through `/games/**`,
  independently of a language route. Catalog membership alone does not add a
  game to a language application or Android build.
- Android receives its bundled language ID, route prefix, entry path, and static
  source directory through Gradle properties and generated `BuildConfig`
  fields. The WebView client must not contain a literal `/cz` route.

The duplicated build-time declarations are intentionally checked by
`apps/server/tooling/tests/language-contract.test.mjs`; drift should fail CI instead
of producing an app that launches one language and serves another.

## Capability boundary

A profile declares which mechanics are available, but it does not implement
them. Current capability names are:

- `chat`
- `dictionary`
- `memory`
- `verbs`
- `wordWorld`
- `conjugationComet`
- `offlineModels`
- `semanticSearch`

Future shared UI must hide an absent capability instead of assuming every
language has Czech verbs, a Czech-English dictionary, or the same model slots.

## Adding a language

1. Create `apps/languages/<language>/static` with a course profile and language
   adapter.
2. Create reviewed, deterministic target-language data for every enabled game.
3. Give every persisted key a language-specific namespace. Never reuse another
   course's progress keys.
4. Add the runtime mount and only the API adapter that language implements.
5. Add the active course to `languages.json` only after native-teacher review
   and its route are verified.
6. For Android, build with the new language Gradle properties and provide its
   own model, dictionary, vector, and setup catalogs.
7. Run the language-data contracts, language contract, runtime boundary audit,
   browser checks, and an Android package audit before publishing.

Archived experiments are not active language apps. Moving an archive into the
registry requires behavior parity, not only a redirect or a matching screen.
