# Target-language adapter foundation

This package owns the browser-safe boundaries shared by every Caatuu course:
the product shell, capability policy, language adapters, authored Word World
mechanics, and English-only semantic runtime. Creating an adapter does not by
itself register or publish a course.

## Shared Caatuu product shell

Czech, Mandarin, and Spanish load the same authoritative interface assets.
A course route chooses course data; it never chooses a different product UI.

| Shared asset | Responsibility |
| --- | --- |
| `static/app/index.html` | The one physical Caatuu product document served at every browser course entry URL. |
| `static/source/app-bootstrap.mjs` | Resolves the route-local course profile and providers, then starts the one product shell. |
| `static/source/caatuu-chrome.js` | Header, Home/Games/Backpack dock, game chooser, Settings, theme, and text-size interactions. |
| `static/source/shell-policy.js` / `.mjs` | Fail-closed navigation, game, setting, and capability visibility derived from a course profile. |
| `static/source/caatuu-workspace.js` | Mechanically promoted Czech-authoritative Home/Games navigation, planet layout, state model, and game lifecycle used by every course. |
| `static/source/word-world-host.mjs` | The sole lazy-loading boundary between the workspace controller and the shared Word World provider/renderer. |
| `static/source/word-world-provider.mjs` | Prepares one frozen context from standard or authored course content, adapter tools, English-only ranking, meanings, and optional hooks. |
| `static/source/product-word-world.mjs` | The mechanically promoted Czech Word World controller bound to the exact shared DOM: meanings, learner-base/target reconstruction, XP, history, display controls, swipes, speech, and reporting. |
| `static/games/*` and `static/source/games/*` | Shared game documents, mechanics, and hosts. Conjugation Comet and Agreement Aurora resolve revisioned course-owned catalogs only through the generated `gameContent` projection; they never infer a language directory. |
| `static/styles/caatuu-*.css` | The Czech-derived theme, workspace, Home, chrome, and Word World presentation used without per-course copies. |

Course packages supply only identity, learner source/base and target labels,
routes, capability flags, linguistic features, enabled-game readiness, storage
namespaces, target-language adapters, reviewed content, and optional providers.
Unsupported controls are omitted by the shared capability policy.
Do not add a course-local shell stylesheet, alternate landing topology, or a
reduced game UI. Course-local `static/index.html` files are contract errors. If
a future language needs a new reusable interaction, extend the shared shell and
gate it through the course contract.

The shared document authors the one component tree. The Word World renderer
binds behavior to that existing tree; it must not create a replacement page or
generate an alternative layout for a course.

Optional browser providers are manifest resources rather than capability
side effects. The generated profile's `browserProviders` map may name a
revisioned course runtime, semantic-learning provider, setup-progress provider,
or setup provider beneath that course's exact static source root. Bootstrap
loads only those declarations, so a new course cannot acquire Czech runtime
code merely by enabling a similarly named feature.

For modern course content, `publication.runtimeProjection` binds that renderer
to one exact shared English catalog, course-owned target catalog, optional
learner-base catalog, policy-defined supplemental outputs, and
`resources.wordWorldManifest`. Projection policies may adapt target
pronunciation and supplementary aids, but they cannot introduce a different
component tree or silently redirect a manifest reference to another output.

`contract.mjs` exports the versioned contract, structural validation, immutable
adapter definition, safe composition, capability assertions, and checked
operation helpers. It has no Node.js imports, DOM access, network access,
storage access, model calls, or platform side effects.

## Contract shape

An adapter owns these fields:

| Field | Responsibility |
| --- | --- |
| `languageTags` | Canonical BCP 47 primary, locale, HTML, and fallback tags. |
| `normalization` | Display-text normalization plus separate search and answer keys. |
| `segmentation` | A declared `computed` or `authored` strategy and token production. |
| `learner` | Display metadata and pronunciation metadata for learner-facing content. |
| `answers` | The primary answer and only the variants the language pack accepts. |
| `speech.input` | Recognition locale/config and an optional platform `recognize` hook. |
| `speech.output` | Synthesis locale/config, safe text preparation, and an optional platform `speak` hook. |
| `dictionary` | Language-owned lookup keys, mandatory entry presentation when the feature is enabled, plus optional `lookup` and `search` hooks. |

Those hooks describe token lookup behavior; the course-level `dictionary`
capability means a complete interactive lexicon. It is separate from the
English translation/audit anchor required on learning items. Enabling the
capability requires five explicit course resources: `dictionaryCatalog`,
`dictionaryCoreEntries`, `dictionaryScriptLines`,
`dictionaryReferenceDocument`, and `dictionaryProvider`. The catalog selects
an active provider, retains primary IDs in `lookupLanguage` and
`meaningLanguage` for compatibility, fixes `lookupLanguageTag` to the exact
course target locale/script, and fixes `meaningLanguageTag` to canonical
English. The core entries and script lines remain
auditable data; the reference document is a sanitized, inert fragment inserted
into the shared layout; and the cache-versioned provider declares a stable
`providerId`.

The generated profile exposes all five confined paths plus the expected
provider identity through `dictionaryContent`. Bootstrap rejects a loaded
provider whose registration or mount acknowledgement differs from that
identity. The adapter's `dictionary.presentEntry` maps every record to
language-neutral `targetText` and mandatory `englishAuditText` plus optional
category, part-of-speech, example, and usage copy; the shared browse, search,
script, reference, and print paths consume only those contracts and fail
closed when a declaration or required value is missing.

Dictionary-gap reporting is optional and fail-closed. A provider that supports
it declares the exact active `dictionaryKey` and target-to-English
`dictionaryDirection`; the generated profile binds that tuple to the same
`providerId`. Without an exact declaration the shared renderer never persists
or submits a missing-entry report.

Optional I/O is attached without mutating the language policy:

```js
import {
  LANGUAGE_CAPABILITIES,
  assertLanguageCapabilities,
  composeLanguageAdapter
} from "./contract.mjs";
import czech from "../languages/czech/static/source/language/adapter.mjs";

const runtimeAdapter = composeLanguageAdapter(czech, {
  dictionary: {
    lookup: ({ key, options }) => dictionaryClient.lookup(key, options)
  },
  speech: {
    output: {
      speak: ({ text, config }) => speechClient.speak(text, config)
    }
  }
});

assertLanguageCapabilities(runtimeAdapter, LANGUAGE_CAPABILITIES.DICTIONARY_LOOKUP);
```

Capabilities are derived from the policy and optional hooks. Extensions cannot
change the adapter identity or its language tags, and cannot claim capability
flags directly.

## Learner content and course-specific safety

The Mandarin skeleton deliberately does not infer word boundaries or
pronunciation. Learner-facing records use reviewed authored data:

```js
const content = {
  text: "银行",
  pronunciation: {
    system: "pinyin",
    notation: "yínháng",
    reviewed: true
  },
  tokens: [
    {
      type: "word",
      text: "银行",
      pronunciation: {
        system: "pinyin",
        notation: "yínháng",
        reviewed: true
      }
    }
  ]
};
```

Missing or unreviewed pinyin is rejected. A raw Han string is never split into
characters, and a character reading is never guessed. Pinyin is not an accepted
answer unless an author explicitly includes it in the accepted-answer list.

Spanish likewise uses authored word boundaries. Its adapter preserves accents
for display and answer comparison and permits accent-folded search keys.
Pronunciation fields remain absent until a separate reviewed pronunciation
policy exists and `pronunciationGuides` is deliberately enabled.

## Shared semantic browser session

The shared browser runtime source lives under `static/`; inclusion in a public
Pages bundle is a separate, release-gated publication decision. Shared
third-party code and model-only artifacts are owned here as well, independently
of every course, and are pinned by `embedding-runtimes.json`. Before the canonical server starts,
`tooling/verify-embedding-runtime.mjs` checks every declared byte count and
SHA-256. Tests, repository notes, and course-specific vector databases remain
private.

`static/source/browser-shell.mjs` joins the reusable English concept catalog to
a course realization catalog by stable `conceptId`. Embedding rankers receive a
deliberately narrow payload: the query and candidate content use only the
English `embeddingText` field, accompanied by stable concept identifiers.
Target text, token readings, and transliteration never cross that hook boundary.

English here is an immutable audit/retrieval pivot, not necessarily the
learner's `sourceLanguage`. The current Czech, Mandarin, and Spanish courses
happen to use English as their learner base. A non-English-base course supplies a separate, reviewed,
concept-ID-keyed learner-base realization and its narrow runtime projection
while retaining English for search and auditing. The shared join keeps all
three roles explicit; it never labels English concept text as the configured
learner base.

The currently complete non-English-base presentation paths are Word World,
Conjugation Comet, and Agreement Aurora. The two grammar games validate
pack-owned learner-base copy independently from mandatory English audit text;
English audit fields never enter playable round projections. Campaign is ready
only when every contained planet has one of these registered presentation
contracts. Dictionary, Verb Lab, Case Cosmos, and Naturalization Nucleus fail
`source-language.presentation` until they implement the same three-role shared
rendering boundary. Browser offline setup must include every projection output,
including each exact revisioned game catalog and the shared English-concept URL,
while Android packages every course-scoped projection output through the course
asset catalog.

`static/source/english-minilm-ranker.mjs` provides the shared semantic ranker.
It independently validates the complete payload before loading model code,
rejects non-contract fields and non-English scripts, embeds queries and English
candidate text with normalized 384-dimensional vectors, and caches candidate
vectors across searches. It disables remote model loading and uses the pinned
local qint8 `all-MiniLM-L6-v2` runtime through these language-neutral server
paths:

- `/language-runtime/vendor/transformers/transformers.min.js`
- `/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/**`

The small ranker module can be precached, but its model and ONNX Runtime assets
remain browser-on-demand for courses that do not claim `offlineModels`. They are
not copied into each language pack or its Android assets. A course selects the
shared model ID through its own embedding catalog instead of duplicating model
paths or hashes. The generated course profile projects that declared catalog
directly as `embeddingContent.catalog`, and the shared workspace loads it
without a target-specific runtime dependency or inferred path. When loading or
local inference fails, the browser shell uses deterministic lexical ranking so
the authored lesson remains usable and tells the learner which mode produced
the search result.

Pronunciation rendering requires both an enabled course capability and an
approved content-review state. Draft course projections may therefore expose
authored target text and word boundaries without exposing unreviewed readings or
guessing segmentation and polyphones.

## Focused tests

Run the shared runtime and course-adapter contract tests in the repository
development container:

```sh
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/*.test.mjs
```
