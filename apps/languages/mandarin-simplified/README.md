# Caatuu Mandarin

This is an English-to-Mandarin development course pack rendered by the shared
Caatuu product shell, enabled for browser, public Pages, and Android delivery.

## Product boundary

- `/zh/` uses the same header, Home/Games/Backpack navigation, theme,
  responsive layout, Settings interaction, and embedded-game lifecycle as the
  other courses.
- `course.json` owns Mandarin identity, routes, storage namespaces,
  capabilities, and platform eligibility.
- `static/source/language/adapter.mjs` owns authored Hans segmentation and
  normalization policy.
- Word World joins shared English concepts to authored Mandarin realizations
  and renders them through the shared product Word World controller.
- Course-local shell CSS and alternate landing-page structures are forbidden.

## Current capabilities

Word World and English-backed semantic search are enabled. The browser embeds
only each concept's English `embeddingText` with the shared MiniLM runtime;
Mandarin text, pinyin, and target tokens cannot enter that boundary. A
deterministic lexical fallback keeps authored lessons usable when local model
inference is unavailable.

Verb Nebula, Naturalization Nucleus, and Sounds Quasar are enabled with
course-owned catalogs. Memory Moon is playable from its own Mandarin bank.
Mandarin speech output is enabled with
the course-owned `zh-CN` locale, and authored token glosses remain available
inside Word World. LLM, chat, generated sentences, the separate full
Dictionary workspace, pronunciation guides, and offline model packaging are
disabled. Browser, public Pages, and Android distribution are enabled,
including bundling this disclosed development course in the shared APK.
Pending native Mandarin review is a visible quality
note and does not block Pages or APK preview publication. The shared shell hides
only the unsupported controls; it does not choose another renderer or layout.
The course remains
`development`, `noindex`, and blocked from active-course promotion and approved
pronunciation guidance until native Mandarin review passes. Its first-party
English and Mandarin curriculum licensing is release-cleared under
`AGPL-3.0-only`.

## Foundation path and sentence patterns

Word World's Next sentence menu offers **Foundation path** and **Sentence
patterns** when course-authored teaching records are available. The foundation
path introduces eligible examples in authored order, then revisits them;
presentation counts do not establish mastery. Pattern practice uses the same
answer controls and evidence ledger, scoped to the chosen unit and difficulty.
The ten introductory units cover greetings, identity, needs, negation, questions,
classifiers, payment, modal verbs, location and aspect. Existing explicit learner
settings are preserved. Unannotated courses retain their ordinary selection.

The optional **Pattern note** contains course-authored explanations. Opening it
before answering records assisted practice. Explicit alternate target token
orders accept only reviewed permutations; the game never guesses valid grammar.

Sounds Quasar excludes exact authored homophones from isolated-word choices.
Naturalization Nucleus connects all 640 characters to cited compounds or
sentences after a correct match. **Play example** speaks that context; character
playback remains separate. Contexts and pronunciation remain machine-assisted
previews, with qualified native and actual voice review pending.

Refresh the character context projection after its cited Word World text changes:

```sh
docker exec -w /workspace caatuu-dev node tools/language-content/project-mandarin-nucleus-contexts.mjs --write
```

Omit `--write` to check citations and generated context drift without changing
the catalog. Run the Word World builder before offline-catalog refreshes.

## Validation

Run from the repository development container:

```sh
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/*.test.mjs
docker exec -w /workspace caatuu-dev node --test apps/languages/mandarin-simplified/tests/*.test.mjs
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --check-views
```

Automated checks are necessary but not sufficient. A language-shell change
must also compare Czech and Mandarin Home, Games, Word World, and Settings at
desktop and mobile sizes in the session browser.
