# Content progression

Every registered course keeps its three difficulty badges and two authored
integer scores from **1 through 100**:

- `usefulness`: how valuable the material is for practical communication. Higher
  values prioritize reusable needs, participation, comprehension repair and help.
- `complexity`: the linguistic and task demand within the retained badge. Higher
  values indicate more interacting demands, including forms, clauses and context.

These are anchored editorial judgments, not percentages or measured difficulty
for a particular learner. Nearby values should be treated as similar. Static
usefulness is separate from the learner's changing need to review an item.
The [catalog review](CONTENT_PROGRESSION_CATALOG_REVIEW.md) documents the full
regrading and its limitations; the [beginner review](CONTENT_PROGRESSION_BEGINNER_REVIEW.md)
documents short starter phrases. Existing native-review and licensing states
remain authoritative.

## Learning evidence

A completed encounter is recorded separately from its result and support:

| Evidence | What the app can infer |
| --- | --- |
| Exposure | The learner completed a presentation or review; recall is unknown. |
| Assisted | Hints, an answer reveal or correction supported the response. |
| Independent | The first assessed response used only the exercise's normal prompt. |
| Spaced independent success | An independent success returned after the required elapsed review interval on another UTC day. |

Independent recognition, listening choice and token reconstruction are evidence
for those specific tasks. They do not establish unaided speech, free writing,
transfer to a new context or permanent mastery. Completing a board, rendering a
distractor, preparing a queue, replaying audio or accumulating XP does not by
itself prove recall. An incorrect first response remains a mistake when the
learner subsequently corrects it; that correction can receive assisted credit.

There is no three-encounter gate, universal success count or permanent mastered
state. Repetitions in the same sitting provide practice without earning spaced
successes or lengthening the review interval.

## Review and gradual introductions

The selected badge is a hard ceiling. There are no authored record-to-record
prerequisites and no dependency graph. The shared selector mixes due review,
rested practice and small introductions. Games preserve that priority when
choosing the next task; they may shuffle its visible answer arrangement.

Introductions start near the lowest complexity available. Within a badge and
rough ten-point complexity band, more useful material comes first. Delayed
independent evidence gradually expands the challenge range. A separate,
slower participation signal keeps supported study explorable after repeated
practice on separate days, without granting recall credit. One difficult item
cannot hold an entire batch hostage.

Current conservative defaults are explicit product heuristics:

- The first independent success schedules a review after 24 hours. A subsequent
  qualifying spaced success grows its interval by 1.8, capped at 30 days.
  Both actual elapsed time and a different UTC day are required. The full
  interval must follow the latest relevant encounter, including a recent
  correction or rehearsal. An early independent review restarts the current
  interval without growing it. Missing a session does not erase earlier history.
- A fresh mistaken or assisted encounter schedules a short review after ten
  minutes. Corrections and duplicate callbacks for that encounter cannot keep
  pushing its deadline forward. Recently visited items yield to other practice.
- Ordinary practice rests for about five minutes where other candidates exist.
  The selector rotates review, practice and new material; its nominal mix is
  two review slots, two practice slots and one introduction slot, with fallbacks
  when a category is empty. Tiny banks remain playable.
- The initial daily introduction budget is six, or the number of distinct
  records required to build a playable game. Established delayed evidence can
  increase it modestly. A large unresolved practice backlog reduces it to about
  a third, with at least one introduction possible.
- The initial challenge window spans 18 complexity points. The queue's internal
  readiness signal uses spaced successes, independent practice days and the
  current interval together, opening at most 24 points beyond a practiced item.
  It is neither a recall probability nor a learner-facing mastery percentage.
- `practiceDays` counts fresh completed encounters at least 24 hours apart on
  different UTC days. After the first three such days, each further day can
  widen supported exploration by four points, capped at 24. After eight practice
  days or sufficient delayed independent evidence, at most one daily introduction
  may try the nearest higher complexity band, including across a sparse catalog
  gap. It consumes the existing budget and does not require exhausting hundreds
  of easier items first. These thresholds govern exploration, not a claim that
  learning is complete.

The daily budget considers the whole practice bank even when a caller filters
its candidates. A necessary distinct-answer pool may exceed the ordinary budget
or challenge window; it never exceeds the chosen badge. An explicit Word World
word request can start practice around that chosen word. Queue construction is
read-only and never fabricates completed encounters.

## Game boundaries

History is separate for every course, game and practice bank. Listening words
and listening sentences do not credit each other. Grammar noun recognition,
phrase sequencing, meaning and form exercises use separate banks. Case Cosmos
tracks each concrete context, including stable derived IDs for older contexts.
Conjugation Comet combines conservative evidence from a verb's assessed forms
when choosing a complete paradigm board.

Word World and Naturalization Nucleus retain shared presentation history while
keeping assessment directions separate. Recognizing a meaning cannot certify
assembling its target-language sentence; matching Hanzi to pinyin cannot certify
the reverse direction. Word World tracks `reconstruct-target` and
`reconstruct-source`, and Nucleus tracks `recognize-hanzi-pinyin` and
`recognize-pinyin-hanzi`. Shared exposure can establish prior presentation and
spaced participation, but cannot supply another direction's independent evidence.
The last shared presentation time also constrains delayed credit: seeing the
same content recently in the opposite direction cannot count as a long delay.

Word World applies the selector to modern and legacy course providers. Semantic
ranking cannot override its practice priority. Dictionary assistance stays
attached to the presentation even if the card is later hidden. Switching from a
visible/revealed sentence to reconstruction remains assisted. Timed translation
reveals and explicit Next produce exposure evidence; merely loading a sentence
does not. Generative sentences have no authored catalog identity and do not
create evidence for unrelated records.

Normal task prompts are not automatically hints. For example, the question and
translation in a case exercise do not disclose the inflected answer; an earlier
rejected attempt does provide assistance. Hosts classify optional clues and
retries according to what their particular task reveals.

## Persistence and compatibility

The profile API is `contentHistory(gameId, bankId)`, `contentGeneration()` and
`recordExposure(gameId, { bankId, itemId, encounterId, correct, evidence, generation, previousExposureAt })`.
`correct` is true, false or null; `evidence` is `exposure`, `assisted` or
`independent`, defaulting to exposure. Each presentation receives an encounter
ID. Corrections, duplicate callbacks and reload recovery reuse its identity.
`previousExposureAt` optionally supplies the shared presentation timestamp from
before the current encounter; it can restrict spacing but never add recall credit.

The course-scoped `learning.content.v2` checkpoint and pending journal preserve
exposure, assistance, attempts, independent results, elapsed practice days,
spaced successes, lapses and review deadlines. Older v1 history is read as an
exposure-only overlay and is never rewritten by the new compactor. Old clients
cannot erase the v2 journal. Existing XP and aggregate attempts never become
independent evidence.

Cross-tab locks, primary/backup copies, journal receipts and save retries protect
against partial writes and concurrent callbacks. Compact per-encounter receipts
remain available after reload to prevent late duplicate credit. Checkpoint schema
3 stores a lossless compact representation under the existing v2 key and reads
both previous plain checkpoints and compact ones. The public history API and
journal format remain unchanged. An exact-byte decode cache observes fresh
storage, reset and journal state on every read, including other-tab changes.

A synthetic history of 1,000 item/mode identities with 30 encounters each uses
about 1.5 Mi characters for its compact checkpoint and backup together; 100
encounters each use about 4.3 Mi characters. Other same-origin data also consumes
the browser's quota, so this is not an unlimited-storage guarantee. Receipt
storage grows with history; quota failures retain pending work in memory and surface the
existing save-status error instead of falsely reporting successful persistence.
Each presentation captures the reset generation, so stale rounds in another tab
cannot recreate cleared progress. Unknown future or damaged data is preserved.

Current authoring requires both renamed fields on every learning record,
including independently assessed nested examples/forms. Cached runtime content
may omit them (neutral 50 defaults) or carry the old five-point fields. Only that
compatibility boundary maps old values to 1, 25, 50, 75 and 100. An explicitly
invalid new field is always rejected. The source regrading uses semantic and
task features, never that compatibility mapping. Generated views follow each
course's single Word World authoring JSON.

Each browser course's offline cache revision is advanced with this runtime
change. An already open app keeps its loaded code until the learner uses the
existing Update control or reloads; installing an update does not interrupt an
active game.

## Evidence and calibration

The design follows the distinction between immediate performance and later
retention. Research supports continued retrieval after initial success and
relearning across spaced sessions; it does not validate Caatuu's exact numeric
budgets, interval multiplier or exploration thresholds. See
[Karpicke and Roediger's repeated-retrieval experiment](https://pubmed.ncbi.nlm.nih.gov/18276894/)
and the study of
[initial learning and successive relearning](https://pubmed.ncbi.nlm.nih.gov/27027887/).

These defaults should be calibrated against later independent performance,
help use, delayed return and whether beginners can continue comfortably.
Editorial complexity is a starting judgment, not a substitute for that evidence.

## Validation

Run in the canonical checkout's established development container:

After changing the Czech Word World corpus, regenerate the static dictionary
supplement before website publication. Its provenance hash covers metadata as
well as wording:

```powershell
docker exec -w /workspace caatuu-dev python3 apps/launcher/tooling/build-static-word-world-dictionary.py
```

Then validate content, behavior and generated assets:

```powershell
docker exec -w /workspace caatuu-dev node tools/language-content/quality/content-progression-catalogs.mjs
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/content-progression.test.mjs apps/language-runtime/tests/content-exposure-persistence.test.mjs apps/language-runtime/tests/content-progression-games.test.mjs apps/language-runtime/tests/word-world-progression.test.mjs apps/language-runtime/tests/word-world-exposure-lifecycle.test.mjs tools/language-content/quality/content-progression-catalogs.test.mjs
docker exec -w /workspace caatuu-dev node tools/language-content/build-word-world-content.mjs --all --check
docker exec -w /workspace caatuu-dev node tools/language-packs/validate.mjs --check-views
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --check
```

Tests protect scheduling, grading bounds and propagation, answer integrity,
direction/mode isolation, elapsed-time behavior, correction deduplication,
reloads, old-client coexistence, storage failures and reset races. Synthetic
fixtures exercise logic; current phrases and catalog counts are not test pins.
