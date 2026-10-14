# Shared game dynamics

Practice pacing belongs to the shared application. Courses supply content and
capabilities; game renderers report their existing learning events. They do not
implement their own coin, gem, or celebration rules.

## Practice sets

The shared learning profile groups practice through a rolling effort budget
within the selected course. Effort carries across game switches and sessions;
each course keeps its own budget. The target is 24 effort units, with
any surplus carried toward the next set. These provisional pacing estimates
have not been calibrated to minutes, mastery, or equivalent learning achievement
between languages. Sets do not author a topic lesson or change the adaptive
sampler's selection of challenges.

One practice set awards one coin. Every 16 new completed sets in the same course
complete a practice cycle and award one gem. Earlier coins and gems are retained
at their earned amounts, independently of the new cycle counter.
XP keeps its existing game-specific learning meaning and accumulates quietly;
the presenter shows the accumulated XP with the set's rewards. Previously earned
coins are preserved once as the historical round balance. Previous rounds do
not generate retroactive gems or celebrations.

The single policy table in
[`learning-profile.js`](../apps/language-runtime/static/source/learning-profile.js)
accounts for different game boundaries: sentence reconstruction, case questions,
matching boards, conjugation forms, listening batches, grammar decisions, and
domino puzzles. Its current contributions apply to every course that supports
the relevant game:

| Game | Effort contribution |
| --- | --- |
| Word World | 3 per submitted sentence reconstruction, correct or incorrect. |
| Case Cosmos | 2 per settled noun challenge. Intermediate correct rejections stay staged until acceptance, a mistake, or a safe transition. |
| Naturalization Nucleus | 5 per solved domino board. |
| Verb Nebula | Matched pairs plus up to 2 incorrect attempts, capped at 12 per settled board. |
| Sound Quasar | Correct answers plus up to 2 incorrect attempts, capped at 5 per settled five-item listening batch. |
| Conjugation Comet | The greater of successful-form XP and up to 2 submission attempts, capped at 6 per settled helix. |
| Grammar Gravity | 1 per recorded phrase decision or noun landing, including incorrect answers and timeouts. Catalog-completion bonus XP adds no effort. |

For example, eight reconstruction submissions contribute `8 × 3 = 24`, and
twelve Case Cosmos challenges contribute `12 × 2 = 24`. Four correct six-form
conjugation helices also complete a set. Mixed practice works the same way:
two reconstructions (6), one solved domino board (5), two clean six-pair
matching boards (12), and one case challenge (2) total 25, awarding a set and
leaving `1/24` for the next. Five clean listening batches also total 25.

Mistakes count toward participation, with retry contributions capped per
settled board. Listening and conjugation currently weight successful work more
heavily: an entirely incorrect listening batch contributes at most 2 units,
compared with 5 for a clean batch; one failed conjugation submission contributes
1 unit, compared with 6 for a correct six-form helix. These are limitations of
the initial pacing policy, not an equal measure of effort independent of
accuracy. Assisted practice remains separate from independent assessment
evidence.

Board-based games stage their recorded attempts until completion or a subsequent
safe challenge transition. Attempted partial boards can therefore contribute
when the learner moves on. Loading content and XP-only study do not advance
effort: settlement requires recorded attempts or successes. Restored unfinished
work alone cannot settle on startup; the game must record new live participation.
Existing XP from study keeps its own meaning and can join the next reward
bundle. All XP accumulated since the last reward is shown when a set completes,
including the full XP from a challenge whose surplus effort carries forward.

## Cycles, difficulty stages, and badge recommendations

The progression terminology is **challenge → practice set →
practice cycle → difficulty stage**. A stage groups multiple cycles and connects
to a recommendation for the next difficulty badge.

Badge behavior is advisory: recommend the next badge only when
both the required practice and supported readiness evidence are present. The
learner chooses whether to equip it. Completing a stage must not automatically
change challenge difficulty or default speech pace. Existing manual difficulty
selection remains available.

| Parameter | Shared policy |
| --- | --- |
| Effort units per set | 24 |
| Sets per cycle | 16 |
| Minimum Explorer cycles before considering Traveler | 200 |
| Minimum further Traveler cycles before considering Navigator | 200 |
| Corpus workload budget | 6 clean passes through the current difficulty band |
| Larger corpus targets | Round up to the next 25 cycles |

At 24 units per set and 16 sets per cycle, one cycle represents 384 effort units.
With the current Word World weight, that is 128 reconstruction submissions.
A 200-cycle stage represents 3,200 sets and 76,800 effort units. Navigator can
therefore be recommended after at least 400 cycles across Explorer and Traveler,
with each stage earned at its own captured difficulty. Navigator keeps ongoing
practice cycles without inventing a fourth authored difficulty.

For each course and difficulty, the shared target is
`max(200, 25 × ceil(6 × clean-pass effort / (384 × 25)))`.
The 200-cycle minimum is a deliberate pacing choice. Six estimated passes through
the present Explorer and Traveler inventories require roughly 16–103 cycles;
the minimum therefore budgets more replay than six passes in these packs. All
current courses use 200 cycles per stage. A larger authored corpus can raise the
target automatically. The estimate does not assert that the learner actually
covered every item six times or completed six spaced passes: adaptive selection
can repeat some items and omit others. Supported spaced, independent learning
evidence remains a separate condition for a recommendation.

[`sync-practice-progression.mjs`](../apps/server/tooling/sync-practice-progression.mjs)
derives a small shared workload table using the content evaluator's production
playability adapters. It counts unique tasks, not raw authoring rows, alternate
assessment directions, tiles, or permutations. A clean pass uses the same effort
weights and board caps as rewards: conjugation forms share a parent helix and
its six-unit cap; domino characters share boards that award five units per
board. Unsupported or incomplete inventories fail generation rather than
substituting authored counts. The standard all-course setup refresh regenerates
and checks this table, so content growth does not require editing each course or
game. The public stage budget exposes the policy version, corpus workload,
six-pass budget, minimum, and rounding step. Unknown test or extension courses
use the conservative minimum until they have a generated inventory.

[`badge-recommendation.mjs`](../apps/language-runtime/static/source/badge-recommendation.mjs)
defines the versioned recommendation heuristic. A completed stage also needs
12 distinct current-band parent items with a retained latest independent correct
response in the last 30 days. At least six must also have spaced independent
successes and independent success on at least two days. Directions and forms of
one parent item cannot inflate breadth. A qualifying practiced game/bank path
must offer a validated playable task at the next authored difficulty.
Assisted answers, exposure counts, effort totals, and a global game accuracy
number cannot substitute for that evidence. The existing
[`learner-state.mjs`](../apps/language-runtime/static/source/learner-state.mjs)
readiness value remains an uncalibrated practice-selection heuristic and is not
used as a promotion threshold. The recommendation itself is also explicitly an
uncalibrated invitation, rather than a mastery estimate. Missing or insufficient
evidence must leave the recommendation unavailable without withholding earned
practice rewards. The next authored difficulty must have playable content for
the supported game paths. Dismissing an invitation must preserve the learner's
choice and avoid repeating the prompt at every challenge transition.
Recommendation wording must describe an invitation to try the next difficulty,
not certification of mastery.

Changing advisory stage targets preserves existing effort, completed sets and
cycles, earned currency, pending receipts, and the learner's equipped badge.
It changes when a future recommendation can be offered; it does not demote an
already chosen badge or reinterpret historical rewards.

The shared runtime captures the difficulty of new work when it occurs, including
staged board decisions. Course-wide sets and currency cycles carry across manual
difficulty switches; badge-stage units accrue only at their captured difficulty.
Existing untagged work remains eligible for monetary carryover and cannot
establish difficulty-stage progress retroactively.

[`badge-progression.mjs`](../apps/language-runtime/static/source/badge-progression.mjs)
shows stage progress and recommendations in Backpack. A ready invitation also
adds a small link to Backpack in the practice meter. Equipping rechecks current
evidence and identity. Dismissal is saved per course and reset generation;
the learner can explicitly review it again. Asynchronous results are fenced by
generation, selected difficulty, authoritative stage availability, and page
lifecycle. Accepted content changes invalidate readiness in this tab and
content journal storage events invalidate it across tabs.

## Transitions and presentation

[`game-dynamics.mjs`](../apps/language-runtime/static/source/game-dynamics.mjs)
owns the practice meter, queued reward presentation, skipping, focus handling,
reduced motion, and cancellation. It is installed once by the shared bootstrap.
The workspace propagates reward pauses through the existing game visibility
contract. The active training panel becomes inert during presentation; navigation
remains usable. Preparing the next challenge can continue behind the overlay.

The normal celebration lasts 2.2 seconds, with staged reward entrances, subtle
sparkles, and small tokens flying toward their header counters. Reduced motion
uses a 1.2-second static presentation without flights or sparkles. A short ascending
sound cue accompanies the bundle, with small coin and milestone-gem accents.
[`reward-sound.mjs`](../apps/language-runtime/static/source/reward-sound.mjs)
uses the shared music/effects volume and mute settings, including master mute;
voice controls remain independent. Audio unlocks only after a trusted pointer
or keyboard gesture. Skipping or hiding the page cancels the cue; returning to
the page does not replay it. Visual timing pauses while the page is hidden.

The shared learning recorder emits `caatuu:practice-boundary` after completed
work. The shared robot loading control emits `caatuu:challenge-transition` with
`show`, `hold`, `hide`, and `destroy` phases. Its `waitUntil(promise)` contract
lets the presenter hold visible transitions without changes to individual games.
Existing loading controls behave as before when no dynamics owner is installed.

Opening or reloading a challenge never supplies effort. A loader may settle
staged work only when this runtime has recorded live participation. Queued,
already earned rewards are presented at a subsequent practice boundary rather
than automatically during application startup.

## Persistence and compatibility

Practice events live in a separate, versioned course journal. Schema 2 preserves
explicit earned currency balances and migrates the fully reduced 12/5 policy
before using 24/16 for later work. Pending receipt IDs and amounts, deduplication
receipts, XP, staged work, and partial units remain intact; `11/12` becomes
`11/24`. Old untagged stage counters start at zero. A durable policy fence carries
the migrated checkpoint and exact receipts, so late legacy work follows 24/16
even if the primary migration write failed. Future or malformed backups are
preserved byte-for-byte and block reward mutations and recommendations.
An interrupted primary/backup checkpoint can repair safely. Older cached clients
fail closed on newer schema data and retain answer journals until refreshed;
the new reducer can recover their immutable late work without inventing a
difficulty attribution.

The journals reference the
same immutable event IDs as the score recorder. Older cached clients may compact
scores but cannot discard the new reward journal. Checkpoints retain replay
receipts before deleting journals; acknowledgements use the existing progress
lock so two tabs cannot present the same reward. The course reset generation
fences out old events and pending presentations. Save failures and unreadable or
future data remain visible through the existing progress-save status.

`CaatuuLearning.practiceSet()` exposes course pacing and its next reward;
its `cycle` field describes new monetary sets, and `progression` describes the
selected difficulty stage plus all three stage counters.
`snapshot().rewards` exposes the journey coin and gem balances.
`completePracticeBoundary(gameId)` settles live staged work, and
`claimPracticeSetReward(id)` acknowledges presentation once.

## Validation

Run focused checks in the existing canonical development container:

```powershell
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/practice-set-persistence.test.mjs apps/language-runtime/tests/practice-set-integration.test.mjs apps/language-runtime/tests/badge-recommendation.test.mjs apps/language-runtime/tests/badge-progression.test.mjs apps/language-runtime/tests/game-dynamics.test.mjs apps/language-runtime/tests/challenge-transition-gates.test.mjs apps/server/tooling/tests/learning-profile.test.mjs
```

New shared assets are registered and hashed for all browser courses through
one validated command:

```powershell
docker exec -w /workspace caatuu-dev node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses --register-shared-runtime
```

The shared imported service-worker revision refreshes every course's runtime
without editing each course worker. Changes to course content,
Android publication, and the adaptive sampling policy are separate operations.
