# Case Cosmos: English to Czech content safety

## Scope and review status

The current v2 development pilot retains 18 nouns with seven singular cases
each (126 original sentences) and adds 30 separately authored contexts using
22 checked singular/plural form pools. It is not a general
Czech sentence generator. No model invents examples at runtime. The form-fitting
exercise creates bounded distractors by replacing only the noun in a checked
sentence; these intentionally incorrect candidates are not authored model utterances.

The historical 2026-09-06 pass inspected all 126 sentence/translation pairs and their
assigned forms, consulted the grammatical references below, and added executable
constraints. This was an AI-assisted reference check, **not independent qualified
Czech editorial approval**. The 2026-09-07 pilot received a separate AI item-level
review and correction/recheck, recorded in the
[pilot review evidence](COURSE_CONTENT_QUALITY_PILOT_REVIEWS.md). Neither pass
claims native or human approval. The pilot does not yet satisfy the full
[quality benchmark](COURSE_CONTENT_QUALITY_BENCHMARK.md) or earn an 85 score;
broader coverage, retained-bank progression, and observed delivery remain open.

## Authorities and boundaries

- [Authored bank](../apps/languages/czech/static/data/games/case-cosmos/content.json):
  the only correct-sentence source. The v2 envelope declares `curriculum`,
  unchanged `legacyNouns`, checked `paradigms`, and stable-ID `contexts`.
  Each legacy record retains `noun`, `difficulty`, and seven `cases`, each with
  `form`, `english`, and `czech`.
- [Czech policy](../apps/languages/czech/static/source/games/case-cosmos/case-cosmos-cs-policy.mjs):
  permitted legacy singular forms and paired constructions, plus exact pilot
  context tuples and form pools; it preserves the English-to-Czech boundary.
- [Content engine](../apps/languages/czech/static/source/games/case-cosmos/case-cosmos-content.mjs):
  validation, exact target spans, case definitions, contrast selection, and balancing.
- [Screen controller](../apps/languages/czech/static/source/games/case-cosmos/case-cosmos.js):
  presentation, speech, swipes, and rewards; it consumes validated questions.

The policy is a conservative acceptance list, not an exhaustive grammar. A rejected
alternative may be perfectly grammatical but not covered by this version. In
particular, the selected masculine dative/locative forms do not imply that other
standard endings are wrong. Never use this policy as a free-form grammar corrector.

## Content checks

1. Reject wrong language pairs before loading the Czech bank.
2. For legacy records, require all seven case entries and exactly the documented data fields. JSON
   property order is irrelevant. Reject repeated nouns, repeated sentences, missing
   levels, invalid difficulty, unknown nouns, and undeclared forms.
3. Require NFC-normalized, bounded plain text without markup, control characters,
   or invisible directional formatting. This slice supports one-word noun targets.
4. Find exactly one complete Unicode word, case-insensitively, and preserve its
   source offsets. `Petr` must not highlight part of `Petra`, a repeated `Petr`,
   a hyphenated name, or a token with a numeric suffix.
5. Replace that target with a placeholder **only for validation**, then require a
   listed complete Czech construction and its paired English rendering. Reject
   role swaps even when their visible noun forms are identical.
6. Enforce the bounded lexical uses of `s/se`, titles, and the kitten-bowl example.
   No general rule such as “motion means accusative” is used.
7. Freeze copied validated data and generated questions. A malformed bank displays
   a non-playable error instead of partially accepting content or guessing answers.

The accepted contexts currently demonstrate subjects, origin with `od`, one
possessor context, recipients and beneficiaries, direct objects, explicit direct
address, `mluvit o` topics, and companions with `s/se`. They do not cover all uses
of any case. The short case hints are beginner guides, not complete definitions.

The new contexts add non-person subjects, objects and recipients; `bez` and
belonging/origin genitives; governed location/destination contrasts; tools and
companions; plural roles; and natural personal address. A paradigm is a checked
form pool, not a required seven-case chart: a window needs no invented vocative.
Several contexts may use the same noun. Each context declares number through its
paradigm, exact case, accepted alternatives, objective, phase, cue and explanation.
The policy pins all those fields and rejects semantic or form drift. Such pins
are regression checks, not independent linguistic evidence.

## Three-level content additions

| Level | Objectives | New contexts |
| --- | --- | ---: |
| 1 | `cz.case.roles`, `cz.case.absence` | 9 |
| 2 | `cz.case.place`, `cz.case.means` | 11 |
| 3 | `cz.case.plural`, `cz.case.address` | 10 |

Each objective retains its authored practice/transfer labels for review. These
labels do not lock content or change gameplay. The restored controller completes
all seven cases for each original noun in the original level order, then visits
the new contexts available at that difficulty. It uses the original feedback,
speech, rewards and transitions. There is no added history or recall scheduler.
See the [selective recovery record](COURSE_CONTENT_GAMEPLAY_RECOVERY.md).

## Noun-form alternatives and sentence completion

In the legacy API every noun yields seven shuffled sentence challenges. Each holds one checked
sentence frame, English meaning, and actual case fixed until solved. Generate
one to three distinct distractor forms from that same noun's checked singular
paradigm, preferring the explicit case contrasts. Add the correct form and shuffle
the candidates so it is not predictably last. No endings, vocabulary, sentence
frames, or English translations are invented.

Replace exactly the validated target span and retain sentence-initial capitalization.
Nothing outside that span may change. The English remains the intended meaning,
not a claim that a deliberately malformed candidate is a valid translation.
Deduplicate surface forms across cases: `Petra` or `Petrovi` must never become a
false candidate when the same form is the checked solution. There is exactly one
correct candidate, derived from form equality, not an authored correctness flag.
This policy does not classify unlisted standard variants as incorrect; they are
never offered. Invalid random values and malformed rounds fail closed.

Each v2 context instead yields one sentence question drawn from its declared
form pool. Accepted alternatives are excluded from false choices: `stolu` is
accepted beside `stole` in the location context, `psu` beside dative `psovi`,
and `lžicí` beside instrumental `lžící`.
The current exercise offers one canonical true candidate, never a correct
alternative labeled false. Full seven-case paradigms are unnecessary.

Correct ×: keep the sentence, animate the next noun into the same window, and
record the decision without round completion or XP. Incorrect × or ✓: red retry
feedback and a short shake, then reopen the identical candidate. Correct ✓: show
the completed sentence, award one round/XP, then show the shared robot for at
least 850 visible milliseconds before advancing. Only completion signals campaign
success. Repeated input is locked during feedback and motion. Hidden pages and
open settings pause transitions; resets/disposal cancel stale continuations.
Reduced-motion preferences suppress transforms while retaining the same decisions.

Manual audio reads just the offered noun during practice; after completion it
can read the correct whole sentence. It never models a deliberately incorrect
sentence. The contrast preferences are instructional choices, not evidence of
the most frequent learner mistakes; calibration still needs learner testing.

## Historical 2026-09-06 changes

- Kept all 18 nouns and 126 examples; added no unchecked vocabulary.
- Used “a friend” instead of an unexpressed “my friend”, and consistent familial
  “Mom”/“Dad” translations for `maminka`/`tatínek`. These are conservative editorial
  choices, not a claim that all previous contextual translations were ungrammatical.
- Made `prosím` explicit in the four Czech commands whose English contains
  “please”, keeping the paired politeness wording aligned.
- Retained didactic animal and role-name vocatives; their naturalness in a learner
  game still deserves qualified review. Didactic usability is not proved by form checks.

## Safe extension workflow

1. Propose a small batch outside the playable bank; inspect every full Czech and
   English sentence, intended referent, case, number, and register. AI drafts alone
   are not approval. Do not blindly substitute nouns into existing sentences.
2. Verify forms and verb/preposition requirements against suitable Czech references.
   Reject ambiguous targets or contexts. Follow the fixed benchmark's separate
   review and correction/recheck requirements; record the review type accurately
   outside learner-facing JSON. Do not invent human approval.
3. Deliberately extend the acceptance policy only for the examined noun forms and
   bilingual constructions. Add positive and adversarial tests for that extension.
   Do not loosen patterns until malformed examples pass.
4. Add a v2 stable-ID context and only its checked applicable form pool; assign
   the fixed objective/level and practice or reserved-transfer phase. Preserve
   legacy IDs/text. The legacy API still requires complete seven-case noun records.
   Multiword targets and different learner-base languages remain unsupported.
5. Run the tests below; version the data, controller, and changed policy imports;
   update the course manifest, generated course views, offline URLs/cache marker,
   and Android file inclusion. Check the served app before handoff. Do not release
   a mixed old/new policy and data combination.

From the canonical checkout, use the existing container:

```powershell
docker exec -w /workspace caatuu-dev node --test apps/language-runtime/tests/case-cosmos-content.test.mjs apps/language-runtime/tests/case-cosmos-curriculum.test.mjs apps/language-runtime/tests/case-cosmos-behavior.test.mjs apps/server/tooling/tests/case-cosmos-shell.test.mjs tools/language-content/tests/planet-english-audit.test.mjs
```

The content tests check the retained pairs and 12,600 legacy sentence challenges,
including unique solvability, fixed surrounding text, identical-form safety,
immutable source sentences, and invalid mutations. Behavior tests cover retries,
animation phases, the shared robot, campaign/reward boundaries, and cancellation.
Pilot tests also check all 30 contexts across multiple random seeds, accepted
variants, semantic drift rejection, objective coverage, original seven-case
round order and reachability of every added context. Shell tests verify Android/offline
inclusion and revision alignment. Browser QA is
still needed for rendering, speech, controls, and startup readiness.

## Reference basis

References consulted on 2026-09-06; used for checking facts, not copied as curriculum
sentences. No external dictionary or prose dataset was imported into the bank.

- [CzechEncy: PÁD](https://www.czechency.org/slovnik/P%C3%81D):
  seven-case inventory, contextual grammatical relations, and form overlap.
- [ÚJČ: masculine dative/locative variants](https://prirucka.ujc.cas.cz/?id=224):
  permitted long/short endings and their contextual distribution.
- [ÚJČ: masculine vocative](https://prirucka.ujc.cas.cz/?id=225):
  direct-address forms and the limits of the beginner examples.
- [ÚJČ: female names ending in a](https://prirucka.ujc.cas.cz/?id=350) and
  [female names including Marie](https://m.prirucka.ujc.cas.cz/l/?id=351):
  relevant female-name declension classes.
- [ÚJČ SSJČ: kotě](https://ssjc.ujc.cas.cz/search.php?heslo=kot%C4%9B&hsubstr=no),
  [hrdina](https://ssjc.ujc.cas.cz/search.php?heslo=hrdina&hsubstr=no), and
  [the předseda pattern](https://prirucka.ujc.cas.cz/?id=222): lexical/pattern checks.

These references do not constitute external approval of our 126 authored utterances.

Additional pilot references checked on 2026-09-07: [ÚJČ: student](https://prirucka.ujc.cas.cz/?slovo=student),
[Masaryk University DICTIO: stůl](https://www.dictio.info/cs/translate/czj/text/st%C5%AFl/76391),
and [DICTIO: pes](https://www.dictio.info/cs/translate/czj/text/pes/64130?lang=cs).
They support the checked forms, including `stole/stolu` and `psovi/psu`; no
dictionary prose or sentence dataset was imported as curriculum.

The [DICTIO lžíce entry](https://www.dictio.info/cs/translate/czj/text/pes/55721?lang=cs)
supports both instrumental forms `lžící/lžicí`. The pilot spoon context replaced
the initial knife context after the existing child-content scan raised review
findings. No safety rule was disabled; original legacy sentences are unchanged.
