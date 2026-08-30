# Target-language adapter foundation

This package owns the browser-safe boundaries shared by every Caatuu course:
the product shell, capability policy, language adapters, authored Word World
mechanics, and English-only semantic runtime. Creating an adapter does not by
itself register or publish a course.

## Shared Caatuu product shell

Czech and Mandarin load the same authoritative interface assets.
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
| `static/source/product-word-world.mjs` | The mechanically promoted Czech Word World controller bound to the exact shared DOM: meanings, English reconstruction, XP, history, display controls, swipes, speech, and reporting. |
| `static/styles/caatuu-*.css` | The Czech-derived theme, workspace, Home, chrome, and Word World presentation used without per-course copies. |

Course packages supply only identity, labels, routes, capability flags,
linguistic features, enabled-game readiness, storage namespaces,
target-language adapters, reviewed content, and optional providers.
Unsupported controls are omitted by the shared capability policy.
Do not add a course-local shell stylesheet, alternate landing topology, or a
reduced game UI. Course-local `static/index.html` files are contract errors. If
a future language needs a new reusable interaction, extend the shared shell and
gate it through the course contract.

The shared document authors the one component tree. The Word World renderer
binds behavior to that existing tree; it must not create a replacement page or
generate an alternative layout for a course.

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
| `dictionary` | Language-owned lookup keys plus optional `lookup` and `search` hooks. |

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

## Learner content and Mandarin safety

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

## Shared semantic browser session

The public browser runtime lives under `static/`. Shared third-party code and
model-only artifacts are owned here as well, independently of every course, and
are pinned by `embedding-runtimes.json`. Before the canonical server starts,
`tooling/verify-embedding-runtime.mjs` checks every declared byte count and
SHA-256. Tests, repository notes, and course-specific vector databases remain
private.

`static/source/browser-shell.mjs` joins the reusable English concept catalog to
a course realization catalog by stable `conceptId`. Embedding rankers receive a
deliberately narrow payload: the query and candidate content use only the
English `embeddingText` field, accompanied by stable concept identifiers.
Target text, token readings, and transliteration never cross that hook boundary.

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
paths or hashes. When loading or local inference fails, the browser shell uses
deterministic lexical ranking so the authored lesson remains usable and tells
the learner which mode produced the search result.

Pronunciation rendering requires both an enabled course capability and an
approved content-review state. Draft course projections may therefore expose
authored target text and word boundaries without exposing unreviewed readings or
guessing segmentation and polyphones.

## Focused tests

Run the contract and both reference adapters in the repository development
container:

```sh
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/*.test.mjs
```
