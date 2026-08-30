# CAATUU-LANG-02 interface baseline

Status: migration authority and acceptance specification. This document does
not record CAATUU-LANG-02 as complete.

## Decision

Caatuu has one learner-facing product interface and one Word World renderer.
A course selects language data, a language adapter, provider hooks, and
capabilities; it does not select a different product or a second renderer.

The Czech application is the migration authority for visible structure,
interaction behavior, responsive behavior, and accessibility. It is not an
instruction to preserve every legacy implementation technique. In particular,
the former state in which Czech Word World ran its legacy renderer in an
iframe while Mandarin used a separate inline renderer is rejected. Matching
outer geometry or screenshots from those parallel implementations is not
acceptance evidence.

This iframe rejection is specific to the multilingual Word World migration.
Unrelated Czech games may retain their current embedded delivery until their
own migration is scoped.

## Czech legacy interface inventory

The following inventory is the behavior and presentation oracle for the first
shared-shell migration. A replacement must preserve it or record an explicit,
reviewed product change.

### Product shell

The Czech shell consists of:

1. `.app-shell`
   - the Caatuu header, page/game identity, and course language pill;
   - the workspace containing Home, Dictionary, and Games;
   - the Waajacu footer.
2. `[data-caatuu-bottom-nav]`
   - Home;
   - Games and its chooser above the dock;
   - Backpack, with Items, Stats, and Settings in the same shell.
3. Games workspace
   - the galaxy/planet chooser;
   - one active game stage without a product-level layout change;
   - preserved theme, font size, progress, visibility, and lifecycle state when
     moving between shell views.

The mechanically promoted shared sources are the served implementation:

- [shared workspace and navigation logic](../apps/language-runtime/static/source/caatuu-workspace.js)
- [shared workspace styles](../apps/language-runtime/static/styles/caatuu-workspace.css)
- [shared chrome behavior](../apps/language-runtime/static/source/caatuu-chrome.js)
- [shared chrome styles](../apps/language-runtime/static/styles/caatuu-chrome.css)
- [shared theme tokens](../apps/language-runtime/static/styles/caatuu-theme.css)
- [shared Home styles](../apps/language-runtime/static/styles/caatuu-home.css)

The original Czech controller and styles at commit
`cf29a378dc7fcb3552c8f8427dad92d59bdf2eb3` remain the non-served historical
authority used by promotion contracts. The legacy stylesheet order is also
evidence: theme, base workspace/game layout, feature styles, Home, then chrome.
Extraction may consolidate files, but it must prove that cascade precedence and
responsive results did not drift. The authority copies must not remain reachable
as a second course-local implementation.

### Word World

The Czech Word World reference comprises:

- the display, audio, answer/meaning, and generation controls;
- a selected-word card with surface form, meaning, optional grammatical
  metadata, and selected-word playback;
- previous/next controls and horizontal swipe behavior;
- the central illustrated scene;
- selectable target-language word tokens with authored boundaries;
- the English sentence reconstruction challenge, answer modes, submit/result
  state, and XP award;
- sentence playback, reporting, progress/runtime status, and phrase history;
- keyboard, focus, live-region, reduced-motion, and touch behavior;
- stable state while leaving and returning to the Games view.

The detailed interface oracle is:

- [byte-pinned Czech Word World document fixture](../apps/language-runtime/tests/fixtures/czech-word-world-0.1.7-authority.html.fixture)
- [shared Word World controller](../apps/language-runtime/static/source/product-word-world.mjs)
- [shared Word World styles](../apps/language-runtime/static/styles/caatuu-word-world.css)
- [legacy Czech corpus provider](../apps/languages/czech/static/source/games/word-world/word-net-standard.mjs)
- [shared Word World meaning selection](../apps/language-runtime/static/source/word-net-core.mjs)
- [shared Word World queue](../apps/language-runtime/static/source/word-net-queue.mjs)

The course-local [word-net.html](../apps/languages/czech/static/word-net.html) is
only a compatibility redirect; it is not a detailed interface oracle. The Czech
corpus provider retains course history, while the shared controller, styles,
core, and queue are the only served Word World implementation. Byte-pinned
historical controller and CSS authority is read from commit
`cf29a378dc7fcb3552c8f8427dad92d59bdf2eb3` by the parity contracts; it is not
copied into a course-static runtime path. The accepted course route must not
navigate to or embed the compatibility document.

## Rejected parallel-renderer state

The following arrangement was implemented and reviewed, then rejected:

- Czech mounted `word-net.html` and its legacy controller in an iframe;
- Mandarin mounted a new authored renderer inline;
- the shared shell coordinated two different Word World lifecycles;
- browser comparisons measured the outer stages even though the inner DOM,
  controls, state machine, and responsive ownership differed.

That state failed the product boundary. It doubled renderer maintenance,
allowed course behavior to drift, made capability gating renderer-specific,
and could not prove that a third language would reuse either path. Prior
same-byte shell hashes, outer-geometry measurements, or a visual comparison of
the Czech iframe with the Mandarin inline view must not be cited as completion.

## Required shared renderer/provider contract

The intended implementation has exactly one public Word World mount path:

```text
shared app document
        |
        v
CaatuuWorkspaceShell -> CaatuuWordWorldHost.ensureLoaded()
        |
        v
mountWordWorld(root, course, manifest)
        |
        +-- standard-corpus provider ------+
        |                                  |
        +-- authored-realizations provider +
                                           |
                                           v
             mountProductWordWorld(root, preparedContext, options)
```

The candidate shared boundaries are
[the provider entry point](../apps/language-runtime/static/source/word-world-provider.mjs)
and
[the renderer](../apps/language-runtime/static/source/product-word-world.mjs).
The shared shell owns a single inline Word World root in
[the product document](../apps/language-runtime/static/app/index.html).

Providers may differ only in how they prepare data and optional services. They
must yield the same frozen renderer-facing context contract:

- course identity, source/target labels, adapter, policy, and capabilities;
- stable records with `conceptId`, English display/search text, scene intent,
  and target text;
- authored target tokens with `surface`, learner-facing `gloss`, and
  `playable`, plus reviewed pronunciation metadata only when allowed;
- deterministic selection and English semantic-search methods;
- optional provider hooks such as richer meaning lookup, generation, report,
  speech, or scene resolution.

The shared document and Czech-derived styles own the one learner-facing
component tree. The renderer binds the authoritative state transitions,
challenge behavior, accessibility, and responsive interactions to that
existing tree; it does not generate another page. A provider must not inject
an iframe, replace the renderer, or carry its own copy of the interface.
Shared code must not branch on `cz`, `zh`, a target language literal,
or a script; policy comes from the manifest, adapter, prepared context, and
declared capabilities.

## Language and feature boundaries

### Mandarin speech output is a supported capability

Mandarin speech output is distinct from pronunciation guidance. The course
declares `speech: true`, uses `zh-CN` for output, and speaks authored Hanzi.
It does not require the Czech LLM/verb runtime and it does not expose pinyin.
The adapter and shared browser/native speech boundaries have focused automated
coverage in:

- [adapter contract tests](../apps/language-runtime/tests/adapter.test.mjs)
- [shared speech boundary tests](../apps/language-runtime/tests/shared-speech-boundary.test.mjs)

This verifies the configuration and dispatch boundary. Acceptance still
requires live sentence and selected-word playback on the tested desktop and
mobile browsers. `pronunciationGuides` remains false until reviewed authored
pronunciation is available.

### Authored word meanings are not the full dictionary

Word World may show a selected token's authored gloss when its content
manifest declares `features.wordMeanings: true`. This is a game-content
feature and is valid for Mandarin.

The top-level `dictionary` capability means the separate full-dictionary
workspace/provider, including catalog installation, arbitrary lookup, and
dictionary-specific controls. Mandarin keeps `dictionary: false`; therefore
the authored in-game meaning card must remain available while the full
dictionary workspace and provider controls remain absent. Czech may enhance
the same meaning card through its full dictionary provider, but that must not
change the shared renderer.

### English-only embedding boundary

Semantic ranking is mediated through English for every course in this scope:

- the only model input is an English concept's `embeddingText`;
- target text, target tokens, glosses, Hanzi, and pinyin must never enter the
  embedding request or embedding-document metadata;
- both standard and authored providers must normalize into that same boundary;
- deterministic fallback ranking also operates on the English concept fields;
- the renderer consumes ranked records and must not construct model payloads.

The authoritative English catalog and guarded ranker are
[the shared English concepts](../apps/languages/shared/english-concepts/word-world-starter-v1.json)
and
[the English MiniLM ranker](../apps/language-runtime/static/source/english-minilm-ranker.mjs).

### Capability gates fail closed

A control or workspace is present only when every required authority agrees:

1. the course manifest enables the capability;
2. the game/content manifest enables the game-specific feature;
3. review or policy state permits learner exposure;
4. the provider supplies the required method or data;
5. the platform runtime supports the operation.

Missing, false, malformed, or contradictory state disables the feature; the
renderer must not guess from course ID or silently borrow a Czech provider.
Examples:

- semantic search requires `semanticSearch`, the English embedding policy, and
  a session search method;
- speech requires course and session policy approval, then uses the course
  `speechLocale`; unavailable runtime voices disable playback without enabling
  pronunciation guides;
- pronunciation requires both `pronunciationGuides` and reviewed authored
  pronunciation;
- generation requires its course capability and a provider hook;
- authored word meanings require `features.wordMeanings`, independently of the
  full `dictionary` capability;
- the full Dictionary workspace requires `dictionary` and a dictionary
  provider;
- Games and each planet require an enabled game declaration and a valid
  provider/route.

## Third-language maintainability test

CAATUU-LANG-02 is not accepted with only Czech and Mandarin fixtures. Add a
synthetic third-language test, for example an `es-test` authored provider, that
uses a new adapter, labels, locale, speech locale, capabilities, and records
without modifying the shared shell, renderer, or provider dispatcher.

The test must prove:

- the same `mountWordWorld` and `mountProductWordWorld` functions are used;
- no new course-ID, language, or script branch is added to shared code;
- authored token boundaries and punctuation render through the adapter;
- source/target labels and language tags come from the synthetic course;
- capability permutations add or remove speech, word meanings, semantic
  search, generation, pronunciation, and full dictionary independently;
- English-only model payload guards still reject target-language input;
- the synthetic course can be removed without leaving shared runtime changes.

An existing generic presentation or schema fixture is useful but does not
replace this renderer-level maintainability test.

## Acceptance evidence

No implementation is accepted merely because the candidate shared files
exist. Evidence must be recorded against one exact source revision and rebuilt
canonical server. Automated results and browser results are both required.

### Automated evidence

- shared renderer tests exercise Czech standard-corpus, Mandarin authored, and
  synthetic third-language sessions through the same DOM renderer;
- a source audit rejects iframes, legacy Word World document navigation, target
  language literals, and course-ID branches in the accepted Word World path;
- capability tests cover every gate above, including Mandarin speech present,
  pronunciation absent, authored meanings present, and full dictionary absent;
- adapter/speech tests prove Hanzi output uses `zh-CN` in browser and native
  dispatch without enabling an LLM;
- embedding tests capture the exact payload and prove it contains only English
  `embeddingText`;
- Czech regression tests cover the legacy inventory's interaction state,
  accessibility semantics, and provider behavior;
- service-worker, setup-assets, server-route, and Android packaging audits
  contain the single shared renderer/provider files and no parallel Mandarin
  renderer.

Passing these checks is necessary but is not completion without the browser
comparison below.

### Desktop/mobile browser comparison checklist

Record the browser name/version, operating system, source revision, route,
viewport, device-pixel ratio, and console/network result for every capture.
Use at least `1280 x 720` desktop and `390 x 844` mobile CSS viewports; add a
real touch-device pass when available.

For both `/cz/` and `/zh/`:

- [ ] Home uses the same header, workspace, footer, Home/Games/Backpack order,
      focus treatment, and scroll ownership.
- [ ] Games opens and closes above the dock, exposes only declared games, and
      retains the underlying shell state.
- [ ] Word World mounts inline into the same shared root with zero Word World
      iframes and one renderer identity.
- [ ] The toolbar, scene, target sentence, token selection, meaning card,
      reconstruction, result/XP state, navigation, reporting/status, and phrase
      history match the Czech inventory where capabilities permit.
- [ ] Selecting a target token shows the expected learner meaning; Mandarin
      uses its authored gloss even though the full Dictionary is unavailable.
- [ ] Sentence and selected-word playback produce the target language using
      `cs-CZ` for Czech and `zh-CN` for Mandarin; stop, replay, rate, voice, and
      unavailable-voice behavior are checked.
- [ ] Mandarin exposes no pinyin or pronunciation guide while its native-review
      gate is unresolved.
- [ ] English reconstruction can be completed, reports the correct state,
      awards XP once, and enables next/history navigation.
- [ ] Previous/next buttons and horizontal touch swipe obey the same gating and
      do not conflict with browser edge gestures.
- [ ] English semantic search selects an appropriate record and reports whether
      MiniLM or deterministic English fallback was used.
- [ ] Backpack and Settings preserve theme, text size, course identity, storage,
      and progress after returning to Word World.
- [ ] Mandarin omits chat, generation, local-model, verbs, pronunciation, full
      Dictionary, and Android-only controls while retaining speech, authored
      meanings, memory/progress, Word World, and semantic search.
- [ ] Desktop and mobile have no horizontal overflow, clipped controls,
      inaccessible fixed-dock content, double scrollbars, or unexpected layout
      shifts.
- [ ] Keyboard traversal, visible focus, live announcements, reduced motion,
      pointer/touch targets, and back/direct-link navigation work.
- [ ] Reload and offline return preserve the shared renderer and course-owned
      state; there are no console errors, CSP failures, failed required
      requests, or cross-course storage/cache writes.

Capture paired screenshots of Home, Games, Word World before and after a
submitted challenge, and Backpack/Settings at both viewport classes. Record
the interaction observations beside the captures. Do not substitute outer
geometry, response hashes, or automated screenshots for the interaction pass.

## Completion rule

CAATUU-LANG-02 may be marked complete only when all acceptance evidence above
is attached to one revision, the Czech legacy inventory has no unexplained
regressions, the rejected Word World iframe/parallel-renderer path is absent
from normal navigation, and the third-language renderer test passes without a
shared-runtime language branch. Until then, the current implementation is a
candidate under review.
