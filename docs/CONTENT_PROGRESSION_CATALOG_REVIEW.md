# Content progression catalog review

Review date: 11 September 2026. This is an AI editorial grading pass and
structural verification, not native-speaker approval or an empirical estimate
of learning difficulty. Existing language review, pronunciation review,
licensing, and release declarations remain unchanged.

## Scope and authority

Every learning record in the five registered courses now carries integer
`usefulness` and `complexity`, each from **1 through 100**. These replace the
former five-point `urgency` and `subdifficulty` fields. The retained
`difficulty` badges remain 1, 2, and 3. Static usefulness is a judgment about
content; per-learner review urgency belongs to the learning profile and is not
stored as an editorial catalog score.

The course manifests identify each game's resources. Word World's existing
`wordWorldContentPath` resolver identifies its authoring source, and the Czech
runtime manifest's declared authoring file must agree. The maintained source
ownership is documented in the [catalog guide](GAME_CONTENT_CATALOGS.md).
Campaign derives its material from other games and has no independent bank.

| Course | Word World records | Other annotated records | Total |
| --- | ---: | ---: | ---: |
| Czech | 833 | 2,327 | 3,160 |
| Mandarin | 607 | 2,134 | 2,741 |
| Spanish | 486 | 2,873 | 3,359 |
| English from Spanish | 487 | 2,470 | 2,957 |
| Norwegian Bokmål | 605 | 3,309 | 3,914 |
| Total | 3,018 | 13,113 | 16,131 |

These are metadata-bearing records across **26 independent course/game pairs
and 29 authoritative JSON banks**, not 16,131 distinct sentences. Grammar
Gravity has separate phrase and noun banks in four courses.

The inventory covers every Word World sentence; every Nebula dictionary row;
Comet verbs and assessed forms; Case Cosmos legacy nouns, nested case contexts,
paradigms and independent contexts; Grammar Gravity challenges, form containers,
individual examples and nouns; listening words and sentences; and
Naturalization character challenges.

The 712 retained Czech dictionary-only rows keep their previously absent badge.
Every playable Verb Nebula pair retains an authored badge. String answer pools,
accepted alternative strings, token glosses, pronunciation units, review
objects, licenses, objectives, UI labels, asset metadata, archives and dependency
JSON are not independent learning records and receive no arbitrary new score.

## Anchored editorial scales

The numbers are ordered judgments, not percentages, measured probabilities, or
equal-sized units. Nearby values should be treated as similar; a difference of
one point does not establish a meaningful pedagogical difference. The full
allowed range need not be populated.

| Approximate band | Usefulness | Complexity within the retained badge |
| --- | --- | --- |
| 1–20 | Narrow specialist or optional cross-language context | Fixed responses and short reusable formulas |
| 21–40 | Technical, academic or narrowly situational material | Concrete recognition, ordinary clauses and productive forms |
| 41–60 | Enrichment, detailed hobbies, narratives and broader concepts | Abstract meanings, alternatives, irregular forms and combined operations |
| 61–80 | Everyday participation, practical objects, routines and services | Several interacting grammatical or contextual demands |
| 81–100 | Highly reusable communication, basic needs, access and repair | Marked or embedded constructions and demanding combinations |

The semantic rubric distinguishes personal care, transport and services,
household objects, meals, classroom/workplace language, personal technology,
familiar animals, more specialized nature vocabulary, social abstractions,
crafts, and scientific or administrative processes. Immediate communication
repair and access to help have separate anchors. Routine inflections are
resolved against the shared English audit meaning; learner-base translations
are never silently treated as English.

Complexity is assessed separately. Features include regular versus irregular
conjugation, plural and formal forms, reflexives, agreement and gender
exceptions, case roles and alternatives, clause relationships, purpose and
embedded questions, and independently authored listening contrasts. Target
features include Czech clitics and invitations, Mandarin particles, attributive
relations and disposal structures, Spanish clitics and subjunctive/counterfactual
forms, English compound verbs, and Bokmål clause order and correlative
comparisons. A small length contribution refines workload only after these
features; length alone never determines a grade. Character recognition uses
authored sound/meaning cues, not invented stroke counts.

The retained badge supplies a small adjustment for assumed background; a
marked construction still contributes its own demand. Neither old numeric
field is an input to the regrading function. There is no multiplication of
five-point grades, random ranking, record-order rank, ID hash, or prerequisite
graph. Grammar-family identifiers are used only to identify their actual
teaching operation.

## Before and after

The final catalog contains **50 distinct usefulness scores (14–99)** and
**68 distinct complexity scores (7–89)**.

| New score band | Usefulness records | Complexity records |
| --- | ---: | ---: |
| 1–10 | 0 | 158 |
| 11–20 | 5 | 1,491 |
| 21–30 | 0 | 7,635 |
| 31–40 | 727 | 4,031 |
| 41–50 | 1,136 | 1,580 |
| 51–60 | 3,123 | 1,032 |
| 61–70 | 3,364 | 172 |
| 71–80 | 4,506 | 24 |
| 81–90 | 2,365 | 8 |
| 91–100 | 905 | 0 |

The following comparison records the pre-migration distribution and the actual
refinement within each former bucket. Overlapping new ranges are expected:
the content was reassessed, not placed into five non-overlapping new bands.

| Old urgency | Records before | New usefulness range | Distinct new values |
| --- | ---: | --- | ---: |
| 1 | 11 | 14–73 | 4 |
| 2 | 1,092 | 33–91 | 33 |
| 3 | 8,465 | 33–93 | 40 |
| 4 | 4,729 | 33–98 | 42 |
| 5 | 1,834 | 54–99 | 28 |

| Old subdifficulty | Records before | New complexity range | Distinct new values |
| --- | ---: | --- | ---: |
| 1 | 3,951 | 7–54 | 34 |
| 2 | 5,948 | 7–65 | 39 |
| 3 | 4,054 | 17–75 | 49 |
| 4 | 1,878 | 19–79 | 52 |
| 5 | 300 | 22–89 | 48 |

For example, Czech `Prosím.` and `Potřebuji pomoc.` both had urgency 5; they
now have usefulness 94 and 97, with complexity 7 and 17. The old
subdifficulty-4 plural forms of `mít` now distinguish the first-person plural
at 32 from the other plural forms at 35. The corresponding irregular `být`
forms are 66 and 69. The short Czech invitation `Řekněme si ahoj.` has
complexity 57, while the Spanish counterfactual `ww-pair260908-120` has
complexity 84. This reflects task differences rather than a numerical
rescaling.

## Beginner access and linked sources

The [beginner review](CONTENT_PROGRESSION_BEGINNER_REVIEW.md) documents the
retained starter utterances and concrete score examples. The previous pass
added 51 Word World utterances, 70 linked listening sentences, and four minimal
Bokmål agreement examples. This 1–100 revision changes no wording, stable ID,
token, badge, license, pronunciation or review claim.

The earlier targeted badge corrections remain: five Czech Word World basic
utterances and five English-from-Spanish listening greetings/name questions
were moved to badge 1. No badge changes were made in this revision.

A listening record whose existing source ID, target, and English audit meaning
match a source receives the source's usefulness. Complexity also agrees when
the badges match and the listening item is not an independent contrast.
**3,202 exact source-linked listening records** passed this alignment check.
Independent sound contrasts and other mismatched or independently authored
views retain their own task demand. These are existing provenance links used
in authoring, not a runtime prerequisite graph.

## Verification and maintenance

Run within the established `caatuu-dev` container and canonical checkout:

```powershell
docker exec -w /workspace caatuu-dev node tools/language-content/quality/content-progression-catalogs.mjs
docker exec -w /workspace caatuu-dev node --test tools/language-content/quality/content-progression-catalogs.test.mjs
docker exec -w /workspace caatuu-dev node tools/language-content/quality/content-progression-review.mjs --align-listening
```

The final inventory passed for all 29 banks and 16,131 records. Eight synthetic
tests passed: nested coverage, bounds including 1 and 100, rejection of old
field keys, badge handling, string answer-pool preservation, exclusion of
non-learning objects, independent task demand, migration preservation and
idempotency, old-grade/identifier independence, and source alignment. They
test logic and integrity rather than pinning teaching text or live counts.

The migration asserted deep equality of every retained field while replacing
only the four old/new progression keys. Final source grades exactly matched the
reviewed dry preview. A second application left every source file's bytes
unchanged. Valid existing usefulness/complexity values are preserved by default;
invalid existing new values fail rather than being silently reinterpreted.
`--regrade` is an explicit editorial reassessment, not part of routine builds.

The tool is read-only unless `--apply` is given. Every write checks canonical
`main`, all local and remote branch names, and unchanged source bytes. It runs
only at `/workspace` in the established container. A bounded retry for a
transient Docker Desktop `EINVAL` file-open failure rechecks those guards and
the original bytes before attempting another write.

The JSON scores become editorial authority after migration. Routine projectors
preserve them and do not rerun the rubric. Runtime/schema integration and
generated-view verification are coordinated separately. This pass makes no
APK, publication, deployment, native-approval or validated retention claim.
