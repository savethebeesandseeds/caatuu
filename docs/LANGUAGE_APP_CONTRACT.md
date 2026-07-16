# Caatuu Language App Contract

Caatuu is one product with language-owned learning adapters. A new language
should not require a fork of navigation, setup, updates, feedback, storage, or
the Android WebView shell.

## The four layers

1. **Product shell** owns the launcher, theme, navigation, settings, setup,
   update flow, feedback outbox, accessibility conventions, and platform
   boundaries.
2. **Course profile** owns stable metadata: route, source and target languages,
   locale, writing direction, storage namespace, capabilities, and entry paths.
3. **Language adapter** owns real linguistic differences: tokenization,
   normalization, morphology, dictionaries, prompts, model catalogs, sentence
   rendering, and language-specific games.
4. **Platform adapter** supplies browser or Android implementations for the
   capabilities requested by a course profile.

Do not move morphology or prompts into the product shell merely to make them
look shared. Share a mechanic only when its inputs and outputs can be described
without naming a particular language.

## Authoritative contracts

- `apps/caatuu-unified/static/languages.json` is the public registry used by the
  launcher. Only active, reachable language apps belong there.
- Each language app provides `course-profile.js` before `runtime.js` and shared
  Chrome. It exposes an immutable `window.CaatuuCourse` object.
- `apps/caatuu-runtime/src/routes/mod.rs` mounts active apps from its route
  registry. The route and entry path must match the public registry.
- Android receives its bundled language ID, route prefix, entry path, and static
  source directory through Gradle properties and generated `BuildConfig`
  fields. The WebView client must not contain a literal `/cz` route.

The duplicated build-time declarations are intentionally checked by
`tools/runtime/tests/language-contract.test.mjs`; drift should fail CI instead
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

1. Create `apps/caatuu-<language>/static` with a course profile and language
   adapter.
2. Give every persisted key a language-specific namespace. Never reuse another
   course's progress keys.
3. Add the runtime mount and only the API adapter that language implements.
4. Add the active course to `languages.json` after its route is reachable.
5. For Android, build with the new language Gradle properties and provide its
   own model, dictionary, vector, and setup catalogs.
6. Run the language contract, runtime boundary audit, browser checks, and an
   Android package audit before publishing.

Archived experiments are not active language apps. Moving an archive into the
registry requires behavior parity, not only a redirect or a matching screen.
