# Caatuu Mandarin

This is a development course pack rendered by the shared Caatuu product shell.
It is not a separate Mandarin application and is not yet a public course.

## Product boundary

- `/zh/` uses the same header, Home/Games/Backpack navigation, theme,
  responsive layout, Settings interaction, and embedded-game lifecycle as the
  Czech reference course.
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

Mandarin speech output is enabled with the course-owned `zh-CN` locale, and
authored token glosses remain available inside Word World. LLM, chat,
generated sentences, the separate full Dictionary workspace, pronunciation
guides, offline model packaging, and Android distribution are disabled. The
shared shell hides only those precise unsupported controls; it does not choose
another renderer or layout. The course remains `development`, `noindex`,
and blocked from activation until native Mandarin and license review gates
pass.

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
