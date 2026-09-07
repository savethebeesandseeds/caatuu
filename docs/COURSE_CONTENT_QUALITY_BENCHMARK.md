# Course content quality benchmark v1

Frozen 2026-09-07 before goal implementation. Source baseline:
`350d168d8d2c6e4ece9150ca33f0c7f9ec69a50c`. The companion
[plan](COURSE_CONTENT_QUALITY_PLAN.md) owns scope and acceptance gates. This
benchmark makes those gates operational; it does not replace or relax them.
Corrections to a faulty evaluation case must be recorded with reasons and kept
in the history. Expansion is permitted; reducing objectives to obtain a pass is
not. Scores below remain the initial estimates until separate reassessment.

## Fixed scoring anchors

| Dimension | Maximum | Required floor | Evidence at the floor | Evidence above the floor |
| --- | ---: | ---: | --- | --- |
| Correctness and naturalness | 40 | 35 | Separate item-level review of all changed material, stratified retained-bank review, all discovered defects resolved and rechecked | Broader independent review, accepted variants and high-risk distinctions verified consistently across the bank |
| Breadth and variation | 25 | 20 | Every objective below has at least three distinct lexical practice contexts and a reserved unfamiliar transfer example; instructional contrasts are varied | Several domains and constructions per objective, systematic risk coverage and useful alternatives beyond the minimum |
| Progression and pedagogy | 25 | 20 | All three levels change taught objectives; actual hosts show cues/explanations, withhold transfer until practice success, and provide separated review | Verified cross-session recall and transfer across several objective families without predictable templates or answer leakage |
| Verification and review evidence | 10 | 8 | Traceable separate AI editorial review, correction/recheck record, focused runtime checks and observed browser/Android asset delivery; audible listening review where relevant | Wider independent evidence across retained material and observed configurations; native/human review only if actually performed |

A pair needs an unrounded total of at least 85 AND every component floor. Merely
meeting the four floors gives 83, so a reviewer must justify additional points.
Any known incorrect answer, misleading hint, incorrect explanation, ambiguous
distractor or broken delivery blocks acceptance regardless of the total.
Inventory size, schema validity and author self-assessment never award points.

### Recorded correction: Verb Nebula interaction

On 2026-09-07 the user explicitly rejected sentences and phrase exercises in
Verb Nebula, including optional sentence help. Its cards, spoken prompts and
post-answer content must remain verbs and translations. Earlier sentence-based
practice/transfer implementation and related passing tests are superseded, not
accepted evidence. The original objective map and fixed scoring weights/floors
remain recorded below. A valid verb-only assessment of those objectives must
still be established; unused sentence metadata cannot satisfy an evaluation
case or increase a score. No 85 claim is justified by this correction alone.

## Objective map: all 20 independent pairs

Each cell contains two objectives in increasing order of demand. The stable
objective ID is `<course>.<family>.<suffix>`; suffixes precede the colon below.
An objective includes its full stated contrast, not just recognition of its
name. Existing useful coverage is retained in addition to these requirements.

| Pair / initial score | Level 1 objectives | Level 2 objectives | Level 3 objectives |
| --- | --- | --- | --- |
| cz.verbs / 75 | actions: daily actions with objects; communication: requests and personal needs | direction: movement and bringing/taking with context; reflexive: reflexive and non-reflexive senses | aspect: ongoing/repeated versus bounded completion; decisions: planning, work and abstract senses |
| zh.verbs / 70 | actions: daily actions and objects; communication: needs, ability and requests | direction: 来/去 and bringing/taking relative to viewpoint; complements: useful verb-object and result expressions | aspect: completed/ongoing/experienced events in context; decisions: planning/work/polysemous senses |
| es.verbs / 70 | actions: daily actions with objects; communication: needs and requests | direction: ir/venir and llevar/traer viewpoint; reflexive: reflexive uses and sense changes | sense: ser/estar, saber/conocer and context-dependent choices; decisions: planning, work and abstract uses |
| es-en.verbs / 60 | actions: concrete daily actions; communication: personal needs and requests | direction: bring/take, borrow/lend and travel; transactions: buying, paying, choosing and routines | phrasal: contextual phrasal-verb senses; decisions: planning, work and abstract decisions |
| cz.words / 80 | identity: people, objects and descriptions; needs: greetings, needs and simple requests | routines: time, movement and daily events; transactions: shopping, directions and services | relations: connected events, causes and conditions; precision: function words, idioms and alternate natural formulations |
| zh.words / 75 | identity: people, objects, measure words and descriptions; needs: greetings, requests and negation | routines: time/place and ongoing/completed events; transactions: directions, shopping and services | relations: connected events, conditions and comparisons; precision: contextual particles, result phrases and idioms |
| es.words / 70 | identity: people, objects and agreement; needs: greetings, requests and negation | routines: time/place and daily events; transactions: directions, shopping and services | relations: connected events, causes and conditions; precision: contextual function words, idioms and natural Spain usage |
| es-en.words / 80 | identity: people, objects and agreement; needs: greetings, requests and negation | routines: time/place and daily events; transactions: directions, shopping and services | relations: connected events, causes and conditions; precision: contextual function words, phrasal expressions and natural US usage |
| cz.conjugation / 75 | regular: present person/number across productive classes; irregular: common irregular present forms | reflexive: reflexive agreement in context; aspect: imperfective present versus perfective future | past: past agreement and auxiliaries; future: compound future and bounded-event contrasts |
| es.conjugation / 70 | regular: present -ar/-er/-ir and six-person agreement; irregular: common irregular and stem-changing presents | reflexive: reflexive persons and placement; perfect: haber plus participle in clear temporal context | past: preterite versus imperfect with explicit contexts; future: future and conditional person patterns |
| es-en.conjugation / 65 | present: present subject agreement including be/have; negatives: do-support and negative agreement | progressive: be plus -ing with time cues; past: regular/irregular past with did-support | perfect: have plus participle and temporal contrast; future: will, planned events and conditional forms |
| cz.case / 70 | roles: subject, direct object and recipient beyond people; absence: belonging, origin and absence/genitive | place: static location versus destination with governed prepositions; means: instrument/companion and tool contrasts | plural: common plural forms by role and animacy; address: natural direct address and syncretic forms in context |
| cz.grammar / 65 | gender: noun gender/animacy and hard-adjective agreement; demonstratives: ten/ta/to and noun agreement | possessives: possessive forms and varied nouns; soft: invariant soft-adjective agreement without fabricated forms | plural: number and masculine animacy agreement; quantity: useful numeral/quantity and agreement contrasts |
| es.grammar / 75 | gender: regular noun gender and singular article/adjective agreement; number: singular/plural nouns and agreement | exceptions: el problema/la mano and other misleading endings; invariant: gender-invariant adjectives and plural spelling | demonstratives: demonstrative/possessive number and gender; combinations: mixed determiner/adjective/noun contrasts in varied contexts |
| es-en.grammar / 75 | number: regular nouns and this/these, that/those; present: is/are and has/have agreement | irregular: irregular noun plurals and determiners; questions: do/does and negative agreement | past: was/were and past negative agreement; quantity: count/noncount and some/any/much/many contexts |
| zh.nucleus / 65 | syllables: initials/finals and common character readings; tones: four citation tones in lexical contrasts | neutral: neutral-tone words and contextual reading units; sandhi: 一/不 and third-tone sequences distinguished from citation forms | polyphones: common contextual polyphones; compounds: unfamiliar compounds using learned readings and tone distinctions |
| cz.sounds / 50 | length: vowel length in meaningful lexical contrasts; segments: common consonants and voiced/voiceless contrasts | inflections: audible endings in short utterances; stress: initial stress and multiword rhythm | connected: connected speech and word boundaries; intent: questions/negation/key details in longer everyday utterances |
| zh.sounds / 55 | tones: citation-tone lexical contrasts; segments: initials/finals in meaningful words | neutral: neutral tone and common multi-character words; sandhi: contextual 一/不 and third-tone sequences | connected: word boundaries and linked utterances; intent: questions/negation/numbers and key details |
| es.sounds / 50 | vowels: clear vowel and syllable distinctions; consonants: useful consonant contrasts in Spain Spanish | stress: lexical stress and accent contrasts; endings: person/number endings in utterances | connected: linking and word boundaries; intent: questions/negation/time and key details |
| es-en.sounds / 55 | vowels: US English vowel contrasts; consonants: consonants and final sounds | stress: lexical stress in common words; endings: plural/third-person/past endings | connected: contractions, weak forms and word boundaries; intent: questions/negation/time and key details |

Campaign is the arithmetic mean of its eligible constituent games (Verb Nebula,
Word World, Conjugation Comet, Case Cosmos, Grammar Gravity where enabled).
Keep unrounded means in the final evidence; no independent content score is
awarded to Campaign. Naturalization Nucleus and Sounds are not constituents.

## Evaluation cases fixed before authoring

For EVERY objective above, run these cases with item IDs retained in the review
record. The author assigns examples before the separate reviewer sees results.

1. Three practice contexts use different lexical anchors. A fourth transfer
   context uses an unfamiliar combination of the taught feature and vocabulary;
   the whole transfer example is absent from introductory prompts and choices.
2. A fresh learner at level 1 cannot draw level 2/3 instruction or locked
   transfer. Raising the level introduces the stated objectives while retaining
   purposeful earlier review. A mistake schedules bounded, separated practice.
3. Correct recall on at least two distinct practice items on separated rounds
   unlocks that objective's transfer. Repeated success on one item, immediate
   retries, stale revisions and corrupted saved state cannot unlock it alone.
4. The target, learner-base prompt, hint, answer, accepted variants and
   explanation express the same intended meaning. English audit text stays
   English even when the learner base is Spanish. No answer is given away by a
   displayed cue or a uniquely unrelated choice.
5. Browser and Android asset paths load those same IDs, levels and contexts;
   offline manifests include changed modules/catalogs and invalidate old bytes.

Fixed high-risk probes, in addition to all-objective cases:

| Family | Probe and expected distinction |
| --- | --- |
| Verbs | Borrow from a lender versus lend to a borrower; bring toward the reference point versus take away; distinguish Czech reflexive/aspect and Spanish ser/estar without collapsing alternative valid meanings. Mandarin 看/看见 and 听/听见 need context, not interchangeable isolated glosses. |
| Word World | An idiom's contextual word hints cannot assert its literal whole meaning: Spanish de nada/por favor, English play an instrument/front desk, Mandarin 的/在. Recombine learned nouns/actions in a new service or travel setting. Retain English-only retrieval input and exact token/concept joins. |
| Conjugation | Czech píšu now versus napíšu as a completed future event; Spanish ayer completed event versus habitual past; English he doesn't work / did she go? / she has gone. The cue must disambiguate tense/aspect rather than accept an unrelated tense. |
| Case | Čtu knihu; kniha je na stole versus pokládám knihu na stůl; bez deštníku; píšu tužkou. Motion alone must not be taught as a universal accusative rule. Identical surfaces are never false choices; inanimate nouns do not require artificial vocatives. |
| Grammar | Czech noví studenti/nové domy/nové knihy/nová auta and invariant jarní; Spanish el problema/la mano, feliz/felices; English children/people, much water/many books and does + base form. A shared ending must not create multiple supposedly distinct correct answers. |
| Nucleus | Separate citation 一 yī and 不 bù from contextual 一个/不是; contextual 行 in 银行 versus 行走, and 重 in 重复 versus 重量. Reading units must compose correctly; unreviewed pronunciation remains labeled. |
| Sounds | Listen to at least two practice items and one transfer per objective, complete contrast sets, and both short and longer speech on identified voices/locales. Record actual intelligibility/pronunciation findings, not just successful speech API calls. Check displayed choices without audio for answer leakage. |

## Review and baseline defects

Every batch records author, separate reviewer, exact IDs, findings, corrections,
rechecks and remaining uncertainties. AI review stays labeled AI. Retained-bank
sampling covers every difficulty, objective and known risk; a systematic defect
expands the audit to the whole affected class. No historical review is presented
as a new review. Audio requires actual audible evidence on the reviewed runtime.

Baseline defects: English verbs all level 1 (16 pairs); all Sounds banks only
16 words and 16 sentences with unreviewed device speech; Sounds and standalone
noun selection ignore authored levels; verb normalization loses teaching
metadata; Czech Case forces complete seven-case paradigms; Czech Grammar only
singular hard-adjective families; conjugation coverage is sparse or ungraded;
modern Word World mostly one sentence per concept with literal function-word
hints; Mandarin Nucleus lacks contextual reading instruction. See the plan for
full starting counts. These remain open until evidence resolves them.

## Common additive teaching metadata

Use existing schemas where possible. The common item vocabulary is
`difficulty` (1..3), `objectiveId`, `phase` (`practice` or `transfer`), `context`
and `explanation` (learner-base text). A declared curriculum contains versioned
objective IDs, labels and difficulty. Declaring it activates complete metadata
validation; legacy banks continue loading. Domain-specific bilingual examples
may carry target/learner-base/English-audit roles. Transfer must be separately
identified and consumed by the host, not just an unused second sentence.

Listening contrast groups have at least four distinct practice choices plus
reserved transfer targets. Record separate editorial review in an evidence
file; production `review` fields cannot claim a pass before that review occurs.
Runtime history is bounded, course/game scoped and content-revision aware.
