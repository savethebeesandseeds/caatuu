# Caatuu English from Spanish

This local development course teaches American English (`en-US`) from Spanish
(`es-ES`) at `/es-en/`. Its source language and interface are Spanish; the
English audit and retrieval authority remains unchanged.

The course contributes a manifest, English language adapter, authored content,
and resource declarations to the shared Caatuu application. It owns no copied
HTML shell, game controller, or stylesheet. Browser delivery is enabled locally;
Pages delivery remains disabled. Android includes the development course from
version 168 for hands-on evaluation, using the shared MiniLM provider and English
device speech. Draft review and provenance metadata are retained; trying this
preview does not require a professional curriculum review.

Word World joins all 250 shared English concept IDs to English target
realizations and the shared Spanish learner-base catalog. Spanish base sentences
retain the existing Spanish draft wording and provenance. Spanish token meanings
are keyed by concept, target locale, token index, and surface; English target
token glosses remain independent audit data. English target text is never used
as an implicit substitute for Spanish learner presentation.

The course enables Verb Nebula, Word World, Conjugation Comet, Grammar Gravity,
and Sounds Quasar. Verb Nebula matches 16 English verbs with their authored
Spanish meanings. The shared core preserves explicit English audit text for
picture retrieval and learning signals; Spanish meanings are never used as
English retrieval queries. Conjugation Comet uses eight finite present-tense paradigms. Grammar
Gravity classifies singular/plural nouns and teaches demonstratives and subject
agreement through complete phrase pairs; it does not assign grammatical gender
to English nouns. Sounds Quasar uses 16 words and 16 sentences with Spanish
meanings and unreviewed device speech for listening practice. Its vocabulary
source is shared with Verb Nebula under the established vocabulary path.

Campaign includes the four campaign-eligible games above; Sounds Quasar remains
standalone. Case Cosmos has no English case curriculum, Naturalization Nucleus
requires Hanzi/pinyin material, and Memory Moon has no implemented game, so none
is enabled by this addition.

Spanish interface messages come from the shared `es.v1.json` catalog. The two
grammar catalogs also own Spanish lesson instructions, cues, and feedback.
Pronunciation guides, generated sentences, LLM, chat, full dictionary, Skill
Compass, and Memory Moon are disabled. MiniLM and lexical retrieval continue to
consume only the shared English `embeddingText` field.

New target tokens, Spanish token meanings, and grammar material are
machine-assisted development drafts. Native English/Spanish review and release
license clearance remain pending; English source provenance does not approve the
new bilingual material. Device speech is listening practice, not pronunciation
assessment.

Run focused checks in the established container:

```sh
docker exec -w /workspace caatuu-dev node --test apps/languages/english-from-spanish/tests/course-content.test.mjs apps/language-runtime/tests/verb-nebula-language-roles.test.mjs tools/language-content/tests/english-policy.test.mjs
docker exec -w /workspace caatuu-dev node tools/language-content/validate.mjs --course es-en
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --check-views
```

Each Spanish base realization may carry `tokenMeanings` entries with
`targetLanguage`, `tokenIndex`, `surface`, and `text`. The locale qualifies the
target, while the index and surface together detect tokenization drift. English
`token.gloss` remains audit data; Spanish hints come only from these authored
base entries.

The generated `learnerBasePreview` declaration permits pending Spanish review
and license status in the declared development course, in both the local browser
and APK. It does not approve the content or promote it to an active course.
