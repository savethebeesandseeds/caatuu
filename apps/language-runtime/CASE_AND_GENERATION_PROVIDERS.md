# Course-owned generation and grammatical cases

Word World generation is optional. An enabled course declares
generationStrategy.module as a revisioned, course-local source/...mjs?v=... URL.
The module exports wordWorldGenerationProvider with schema version 1,
matching strategy identity, target locale, English audit locale, and sentence
and translation model keys. Its seeds, stop words, prompts, fallbacks, sentence
parsing, validation and target extraction belong to that implementation.
The shared controller owns requests, cancellation, queues, presentation and
learner state. Missing modules, unsupported exports, and metadata mismatches
fail closed. A declaration alone does not supply a model implementation.
Android product policy can continue to disable generation independently.

The model settings selector follows the selected runtime model catalog's
default_model (or defaultModelKey) and otherwise its first active generation
model. Existing per-course saved settings remain under their existing keys.

Case Cosmos v3 declares caseSystem with canonical targetLocale and
sourceLocale, a cases array of {case, meaning, question}, and a contrasts
map naming other declared cases. The shared engine validates the selected
course, Unicode word forms, locale-aware matching, inventory, contextual
contrasts, curriculum and difficulty. Gameplay and badge evaluation consume
the same engine; badge evaluation enumerates the complete task inventory rather
than a sampled practice session.

New Case sentences may use target and source. The normalized host API retains
czech and english aliases for existing callers; supplying both naming pairs
is rejected. Czech's course wrapper explicitly upgrades retained v2 catalogs
and noun-array inputs using its course-owned case policy. Existing item IDs and
legacy noun/case history IDs do not change. Other courses do not acquire the game
merely by having cases: they still need declared content and a supported host.
