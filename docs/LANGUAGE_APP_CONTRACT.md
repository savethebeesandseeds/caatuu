# Caatuu Language App Contract

Caatuu is one product with one English-specified curriculum and
language-owned realization adapters. A new language should not require a fork
of the learning sequence, navigation, setup, updates, feedback, storage, or the
Android WebView shell.

## The six layers

1. **Product shell** owns the launcher, theme, navigation, settings, setup,
   update flow, feedback outbox, accessibility conventions, and platform
   boundaries.
2. **Canonical curriculum** is specified in English and owns stable unit IDs,
   order, prerequisites, observable outcomes, learning stages, semantic scope,
   transfer requirements, and mastery policy for every target language.
3. **Course profile** owns stable metadata and release pins: route, source and
   target languages, locale, writing direction, storage namespace,
   capabilities, entry paths, and exact curriculum/realization digests.
4. **Target-language realization adapter** owns real linguistic differences:
   natural utterances, accepted variants, tokenization, normalization,
   morphology, dictionaries, prompts, model catalogs, sentence rendering,
   scaffolding, and language-specific game presentation. It cannot reorder,
   omit, split, merge, or redefine canonical units.
5. **Game implementation** owns language-independent mechanics and generated
   delivery artifacts. A language adapter may provide localized host copy,
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
- `apps/curriculum/data/canonical-curriculum.v1.en.json` is the current shared
  learning contract. Target packs reference it by ID, version, unit revision,
  and digest; they do not copy or override its pedagogical fields.
- `apps/curriculum/data/<locale>.realization-pack.v1.json` contains reviewed
  target-language realizations and executable opportunities. The conformance
  validator must reject divergence before runtime assets are generated.
- Each language app provides `course-profile.js` before `runtime.js` and shared
  Chrome. It exposes an immutable `window.CaatuuCourse` object whose curriculum
  pins come from trusted release configuration, not from the pack itself.
- `apps/server/src/routes/mod.rs` mounts active apps from its route
  registry. The route and entry path must match the public registry.
- `apps/games/catalog.json` indexes authored games and their delivery
  manifests. Generated exports are served through `/games/**`, independently
  of a language route.
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
- `offlineModels`
- `semanticSearch`

Future shared UI must hide an absent capability instead of assuming every
language has Czech verbs, a Czech-English dictionary, or the same model slots.

## Adding a language

1. Create `apps/languages/<language>/static` with a course profile and language
   adapter.
2. Create a complete target realization pack for the existing canonical unit
   IDs and order. Escalate an impossible realization to shared curriculum
   governance instead of silently forking the course.
3. Give every persisted key a language-specific namespace. Never reuse another
   course's progress keys.
4. Add the runtime mount and only the API adapter that language implements.
5. Add the active course to `languages.json` only after curriculum conformance,
   native-teacher review, and its route are verified.
6. For Android, build with the new language Gradle properties and provide its
   own model, dictionary, vector, and setup catalogs.
7. Run curriculum and binding conformance, the language contract, runtime
   boundary audit, browser checks, and an Android package audit before
   publishing.

Archived experiments are not active language apps. Moving an archive into the
registry requires behavior parity, not only a redirect or a matching screen.
