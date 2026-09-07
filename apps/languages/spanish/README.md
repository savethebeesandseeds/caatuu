# Caatuu Spanish

This is an English-to-Spanish development course pack rendered by the shared
Caatuu product shell, enabled for browser, public Pages, and Android delivery.

## Product boundary

- `/es/` resolves to the canonical shared app document. This pack must not own
  an `index.html`, alternate shell, copied layout, or private Word World
  renderer.
- `platforms.browser.enabled` keeps the course available on the canonical local
  server. `platforms.browser.pagesEnabled` and `platforms.android.enabled` also
  enable delivery as a disclosed development preview.
- `course.json` owns Spanish identity, routes, storage namespaces,
  capabilities, resources, and platform eligibility.
- `static/source/language/adapter.mjs` owns Spanish normalization,
  segmentation, answer matching, and the `es-ES` speech boundary.
- Word World joins the shared English concept authority to course-owned
  Spanish realizations through stable concept IDs. English remains both the
  learner base and the immutable retrieval and audit language.
- Verb Nebula consumes only its course-owned Spanish vocabulary catalog while
  retaining the shared game controller and shell layout.
- Conjugation Comet and Grammar Gravity use the same shared game hosts as
  other courses. This pack contributes only finite Spanish content catalogs,
  European-Spanish copy, and reviewed language-role text; it owns no game
  HTML, controller, or stylesheet.

## Current capabilities

Word World, Verb Nebula, Conjugation Comet, Grammar Gravity, English-backed
semantic search, and Spanish speech are available in this development preview.
The two grammar games load their declared course catalogs through the generated
`gameContent` profile projection. Every assessed item retains explicit English
audit text and the runtime performs neither dictionary lookup nor form
generation. The shared MiniLM runtime receives only English `embeddingText`;
Spanish text and target tokens cannot cross that boundary. Deterministic
English lexical ranking remains available if local model inference cannot
start.

The separate full Dictionary workspace, pronunciation guides, LLM, chat,
generated sentences, offline models, and Memory Moon are disabled. Android
includes the development course in the shared APK. Memory Moon remains a
shared coming-later planet. Sounds Quasar provides shared listen-and-choose
practice using device speech and course-owned
words and sentences. Correct answers earn XP; it does not provide pronunciation
assessment. Word World's authored token glosses are not a declaration
of full dictionary support. Campaign availability is derived by the shared
shell from its playable planets.

The Spanish curriculum is machine-assisted and remains
`native-review-required`. Its license gate is `release-review-required`; the
course remains a disclosed development preview on Pages and Android, with
`noindex` Pages delivery and its draft metadata preserved. Active-course
promotion still requires recorded native-review and release-license clearance,
along with the repository's applicable artwork/model notice gates.

## Validation

Run from the repository development container:

```sh
docker exec -w /workspace caatuu-dev node --test apps/languages/spanish/tests/*.test.mjs
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --check-views
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --course es
```

Automated checks are necessary but not sufficient. Before promotion, compare
Spanish with the Czech and Mandarin Home, Games, Word World, Settings, desktop,
and mobile surfaces in the same canonical browser app.
