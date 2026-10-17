# Memory Moon content

Memory Moon has one independent editable `content.json` for every registered
course, under `apps/languages/<course>/static/data/games/memory-moon/`.
`resources.memoryMoonCatalog` in each course manifest owns its exact path.
Every bank uses `caatuu-memory-moon-content-v1`; no question depends on another
game's catalog, loader, item identity or translation.

The initial banks contain 90 original challenges per course, with 30 at each
of the three selected difficulty badges. Each has one target-language sentence
and three authored learner-base translations, including exactly one correct
answer. Close alternatives change a declared meaning such as action, location,
quantity, polarity, sequence, condition or reason. Distractors are authored as
part of the complete question rather than retrieved from arbitrary neighbours.
Counts can grow through JSON edits without changing code or a fixed ceiling.

| Course | Independent bank | Questions (levels 1 / 2 / 3) |
| --- | --- | --- |
| English → Czech | [content.json](../apps/languages/czech/static/data/games/memory-moon/content.json) | 30 / 30 / 30 |
| English → Mandarin | [content.json](../apps/languages/mandarin-simplified/static/data/games/memory-moon/content.json) | 30 / 30 / 30 |
| English → Spanish | [content.json](../apps/languages/spanish/static/data/games/memory-moon/content.json) | 30 / 30 / 30 |
| Spanish → English | [content.json](../apps/languages/english-from-spanish/static/data/games/memory-moon/content.json) | 30 / 30 / 30 |
| English → Norwegian Bokmål | [content.json](../apps/languages/norwegian-bokmal/static/data/games/memory-moon/content.json) | 30 / 30 / 30 |
| English → Arabic | [content.json](../apps/languages/arabic-standard/static/data/games/memory-moon/content.json) | 30 / 30 / 30 |
| English → Scientific Latin | [content.json](../apps/languages/latin-scientific/static/data/games/memory-moon/content.json) | 30 / 30 / 30 |
| English → Georgian | [content.json](../apps/languages/georgian/static/data/games/memory-moon/content.json) | 30 / 30 / 30 |

## Fields and language roles

Each challenge owns a stable course-scoped `id`, item `revision`, `difficulty`,
`usefulness` and `complexity` on the existing 1–100 editorial scales, `topic`,
and `familyId`. Family IDs group related situations so repetition control
can rest a family even when individual question IDs differ.

`targetText` is the sentence shown in the language being learned.
`learnerBaseText` is its correct translation. Every choice has learner-facing
`text` and a separate `englishAuditText`; `correctChoiceId` joins to exactly one
choice. Spanish-to-English therefore has English target sentences and Spanish
choices. English-base courses use their English audit text as their visible
translation. Runtime rendering must use these declared roles and the target
language's writing direction.

Only English `embeddingText` is eligible for semantic retrieval; it equals the
challenge's `englishText`. `focus.englishConcepts` supplies explicit English
concept metadata, and each wrong choice's `contrast` records its kind and the
semantic difference. These descriptions aid inspection; they do not certify a
learner's particular grammatical weakness.

Usefulness and complexity follow the [shared progression rubric](CONTENT_PROGRESSION.md).
The selected badge filters candidates before semantic selection. A sentence's
length alone does not determine its grade: the complete option set contributes
to the recognition task.

## Review and authoring

These are original first-party, AI-authored and self-reviewed development banks
under the project license. Their status remains `machine-assisted-preview`,
with `native-review-required` and `humanApproved: false`. Structural validation
cannot establish grammatical correctness, naturalness or translation
non-equivalence. Independent native-language review remains outstanding, and
no existing course's review or publication status is promoted by these banks.

The maintained learner-content extractor registers this game for every enabled
course and scans prompts, every answer option, English audit/retrieval text,
focus concepts and contrast explanations. Both release source preflight and
compiled-product validation apply the existing content policy to these fields.

Check all three options against the target sentence, after realization into the
learner's actual base language. Keep valid paraphrases out of the wrong choices.
Avoid differences in definiteness, gender, number, time or politeness that the
target does not express. Keep the same semantic frame where practical and avoid
answer-length clues. Mandarin needs explicit temporal context where English
tense would otherwise be ambiguous; Arabic and Georgian must keep their own
script and grammatical roles. Scientific Latin includes scientific observation
and nature alongside concrete foundational language.

Edit the course-owned JSON directly. Increase the item revision when its meaning
or answer set changes, and increase `contentRevision` for a changed bank.
Preserve IDs across spelling or editorial fixes; use a new identity for a
different assessment. The JSON schema is
[memory-moon-content.v1.schema.json](../tools/language-content/schemas/memory-moon-content.v1.schema.json).

## Validation

Use the existing canonical development container:

```powershell
docker exec -w /workspace caatuu-dev node tools/language-content/validate-memory-moon.mjs --all
docker exec -w /workspace caatuu-dev node --test tools/language-content/tests/memory-moon-content.test.mjs
```

`--course cz` selects one course. The read-only validator discovers every course
from the registered catalog, verifies its declared confined content path and
language pair, checks stable identities, distinct prompts/choices, answer joins,
English-only retrieval, three-badge coverage, contrast metadata and grades. Its
inventory reports counts, topics, families and contrast types. It uses no model,
does not generate embeddings and does not alter saved learner profiles.

## Production selection and evidence

All eight courses enable the shared production host at
`/language-runtime/static/games/memory-moon.html`; each course supplies its own
declared JSON through generated course authority. Runtime code ships with the
app, and each bank belongs to that course's offline and Android delivery. The
local interaction demo remains separate and is excluded from release assets.

Each round samples six questions at exactly the selected badge. The selector
reads retained mistake and assistance evidence across the current course's
games, resolves its English meanings through Practice Compass, and embeds only
English text with the shared MiniLM runtime. Multiple weakness regions guide
weighted random draws, with exploration and a varied fallback for learners
without history or when optional semantic tooling is unavailable. Saved recent
question identities, explicit families and semantic neighbours cool down across
rounds and reloads. A smaller eligible pool relaxes repetition penalties rather
than preventing a round.

This six-question sampler is Memory Moon's explicit selection boundary. It does
not apply the other games' frontier or daily introduction quotas, and does not
claim a calibrated diagnosis of grammatical mastery. Similar meanings provide
practice hints, while the authored question supplies the assessed skill.
Usefulness provides a small selection weight; complexity remains editorial
metadata and does not impose an adaptive readiness gate within the chosen badge.

Answers are recorded only under Memory Moon's `translations` bank and
`recognize-translation` direction. Source games receive no result credit.
Ordinary target audio is a prompt modality; a corrected or revealed answer is
assisted. A completed round updates the existing activity, XP and round ledger
once. Course changes, progress resets, hidden frames and cancelled asynchronous
selection are fenced before they can write obsolete evidence.
