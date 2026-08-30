# Language Games and Czech Planet Plan

Status: product and implementation plan

This document defines the planned Czech language-game constellation, the
content authority required for every game, and the implementation order for
the missing planets. In the product, a language game is presented as a planet;
the terms are interchangeable here.

The immediate product decisions are:

- **Conjugation Comet remains an optional conjugation game.** A language
  enables it only when verb-form changes are an important learnable system.
- Czech has two implemented additional game hypotheses: **Case Cosmos** and
  **Agreement Aurora**. A **Sound and Spelling planet** remains future work.
  Clitic placement is useful content but is not a separate planet.
- The Sound and Spelling planet is explicitly future work. It must not delay
  the morphology and sentence-structure games.
- Every enabled game must resolve all assessed challenges from reviewed JSON.
  A game may own that JSON directly or deterministically derive a frozen game
  JSON file from explicitly named general-language JSON sources.
- **Campaign Mode is a play route, not another content planet.** It may move a
  learner among enabled games, but every challenge and answer remains owned by
  the selected planet and its reviewed JSON.
- Runtime code, HTML, an unrecorded model response, and undocumented arrays are
  not challenge-content authorities.

## Pre-investment decision

This plan authorizes a sequence of small, time-boxed prototypes. It does **not**
authorize full content production, shared-platform expansion, bespoke planet
art, or four completed games.

Only one new-game vertical slice should be active at a time. Each slice must
prove four things before expansion:

1. its primary learner decision is distinct and understandable;
2. held-out first responses provide useful evidence of learning transfer;
3. learners can and want to complete another short mission;
4. authoring, qualified Czech review, and engineering cost are sustainable.

A failed slice may be revised once. A second failure triggers an explicit
merge, redesign, defer, or stop decision. The planet list is a hypothesis
portfolio, not a promise to ship every item.

This plan follows the ownership boundaries in
[the language application contract](LANGUAGE_APP_CONTRACT.md): reusable
mechanics may be shared, while natural utterances, accepted variants,
morphology, explanations, and reviewed game data remain language-owned.

## 1. What a Caatuu language game is

A complete planet is not just a screen or a set of shuffled cards. It has seven
parts:

1. **Learning contract** — the capability the learner is expected to acquire.
2. **Reviewed content authority** — the exact JSON records from which prompts,
   answers, explanations, and allowed alternatives are built.
3. **Game mechanic** — the reusable interaction that turns those records into
   practice.
4. **Progression contract** — prerequisites, difficulty, sequencing, and the
   rules for selecting the next useful challenge.
5. **Evidence contract** — what a first response proves, how hints and reveals
   reduce that evidence, and how mastery transfers to a new context.
6. **Teaching contract** — what is demonstrated before assessment, how an
   error leads to a targeted hint, retry, explanation, and near transfer.
7. **Play contract** — the fantasy, immediate player objective, short-session
   arc, visible completion, recovery after failure, controlled variation,
   replay reason, and accessibility-equivalent interaction.

### 1.1 Initial Czech pilot audience

Until research establishes a different audience, the pilot assumption is a
literate English-mediated learner of contemporary Czech around A0–A2, using a
phone or desktop for a three-to-five-minute mission. The first pilots teach
contemporary Standard Czech and explicitly approved neutral spoken variants;
they are not a complete CEFR course, pronunciation tutor, or survey of every
Czech variety.

Changing the audience to young children, heritage speakers, speakers of
another Slavic language, or advanced learners requires a new pilot charter.
The source language, age assumptions, prior grammatical terminology, session
length, and accessibility needs materially change prompts and evidence.

### 1.2 Minimum play and teaching loop

Every prototype must specify:

```text
fantasy and immediate player objective
        ↓
worked example or guided discovery
        ↓
one primary assessed decision
        ↓
targeted feedback and recoverable retry
        ↓
near transfer in a new item or context
        ↓
visible mission completion and replay choice
```

Do not build reward economies, streaks, elaborate animation, or unique planet
infrastructure before the plain interaction is understandable and voluntarily
replayable. Time pressure, lives, and animation may not alter the linguistic
answer or turn guessing speed into mastery evidence.

The same mechanic may serve several languages only when its inputs and outputs
can be stated without assuming Czech. A language that lacks the relevant
system omits that planet rather than supplying artificial content.

Examples:

- Czech and Spanish can enable Conjugation Comet with different feature sets.
- Japanese can use a conjugation mechanic for tense, polarity, politeness, and
  verb class even though verbs do not mark grammatical person.
- Mandarin Chinese should omit Conjugation Comet. Its aspect particles and
  time constructions need a different language-specific learning contract.

## 2. Current and planned Czech constellation

| Planet | Status | Primary learning contract |
| --- | --- | --- |
| Word World | Active | Understand vocabulary and Czech sentences in meaningful visual context |
| Verb Nebula | Active | Recognize Czech verb lemmas and their meanings |
| Conjugation Comet | Active, backbone incomplete | Understand and produce Czech verb forms and the rules connecting them |
| Campaign Mode (route) | Initial mixed-play implementation | Complete one successful round, travel with the robots, and continue on another enabled planet |
| Memory Moon | Placeholder | Recall weak material selected from all active planets |
| Case Cosmos | Development slice handed off for interface refinement | Recognize why a Czech noun changes and compare its seven case forms |
| Agreement Aurora | Content and gameplay slice implemented; interface refinement and review pending | Make related Czech words change together |
| Sound and Spelling planet | Future backlog | Connect Czech sound, vowel length, diacritics, and spelling |
| Battle of the Robots | Future main game | Use training and experience from the other planets to face the robot battles |

Memory Moon is a review surface, not another grammar authority. It should draw
stable challenge references and weak concept references from the other games;
it must not maintain independent copies of their Czech answers.

While Memory Moon remains a non-assessing placeholder, it is exempt from the
enabled-game content-manifest gate. Before it becomes an active review game,
it needs a reviewed policy/configuration JSON and a manifest for that config;
its session queue may then be derived locally from progress and exact
`gameId`, challenge ID, and revision references.

### Campaign Mode — mixed travel between planets

Campaign Mode is shell-owned orchestration, not a new language-content planet.
It has no challenge JSON, answer key, copied Czech content, content manifest,
or independent evidence authority. The active source game continues to own the
challenge, answer, revision, feedback, and learning record through its existing
reviewed JSON.

The initial route includes Word World, Verb Nebula, Conjugation Comet when the
language enables it, Case Cosmos, and Agreement Aurora. It excludes Memory Moon
while that surface remains a non-assessing placeholder. Entering Campaign Mode
selects a ready implemented planet from a shuffled route. After a genuinely
successful round—not a reveal, incomplete attempt, or incorrect submission—the
shell shows only an existing robot loading image and opens another planet. The
same robot-only transition appears before the first Campaign planet. When more
than one planet is playable, the next one must not immediately repeat the one
just completed; a one-game course keeps sampling that game. Campaign Mode's
own icon and title remain the visible route identity while the underlying
planet changes.

This random first version is variety, not curriculum guidance. It must not
claim that a learner is ready, that a concept is mastered, or that a particular
route is pedagogically optimal. Later, replace the shuffled route with a
reviewed progression policy that selects both the next owning planet **and the
exact challenge within it** using prerequisites, difficulty, recent first-
response evidence, hint and reveal history, transfer needs, and delayed review.
The route should record why it made each selection. That future policy belongs
with the progression scheduler in section 4.5; it must consume stable challenge
references instead of creating another copy of game content.

### Future main-game note — Battle of the Robots

Battle of the Robots is intended to become Caatuu's main game. The other
planets train language skills and award the experience that prepares the
learner to face it. This is a direction to remember, not a current design:
combat, progression, content, JSON, and implementation are all deferred until
the training planets and their learning evidence are ready.

## 3. Non-negotiable content authority

Previous game work has failed when the source of challenge content was left
implicit. The following rules are therefore product requirements, not optional
implementation preferences.

### 3.1 One manifest for every enabled language game

Every enabled Czech game must have:

```text
apps/languages/czech/static/data/games/<game-id>/manifest.json
```

This is the target contract. Existing enabled games that predate it remain
explicit migration debt; they must not be described as compliant, and their
temporary legacy status is not precedent for enabling another planet.

The manifest is the one place a reviewer can use to answer:

- Which file supplies the runtime challenges?
- Is that file directly authored or derived?
- Which exact source files and generator produced it?
- Which schema validates each record?
- How many records are present, and what do they cover?
- What review status do those records have?
- Which exact bytes are shipped offline?

The current Word World manifest is the nearest existing model. The language
game manifest should standardize that pattern for every planet without being
confused with `apps/games/<game-id>/game.json`, which governs independently
delivered engine games.

A planned manifest shape is shown below. It deliberately illustrates the
eventual derived mode because that is the more demanding provenance case. A
direct pilot instead declares `mode: "direct"`; its runtime pack is the
reviewed authority, and it has no semantic generator.

```json
{
  "schemaVersion": "caatuu-language-game-content-manifest-v1",
  "manifestSchema": {
    "id": "caatuu-language-game-content-manifest-v1",
    "repositoryPath": "tools/czech-ml/schemas/language-game-content-manifest-v1.schema.json",
    "sha256": "<sha256>"
  },
  "gameId": "case-cosmos",
  "courseId": "cz",
  "targetLanguageId": "cs",
  "contentVersion": "case-cosmos-cs-v1",
  "runtimeFile": "case-cosmos-cs-v1/challenges.json",
  "packSchema": {
    "id": "caatuu-language-game-pack-v1",
    "repositoryPath": "tools/czech-ml/schemas/language-game-pack-v1.schema.json",
    "sha256": "<sha256>"
  },
  "recordSchema": {
    "id": "caatuu-case-cosmos-challenge-v1",
    "repositoryPath": "tools/czech-ml/data/games/case-cosmos/pilot-v1/schema/challenge.schema.json",
    "sha256": "<sha256>"
  },
  "recordCount": 0,
  "contentBytes": 0,
  "contentSha256": "<sha256-of-exact-runtime-file>",
  "authoring": {
    "mode": "derived",
    "sources": [
      {
        "id": "cs-pilot-lexemes-v1",
        "repositoryPath": "tools/czech-ml/data/czech-grammar/pilot-v1/lexemes.json",
        "sha256": "<sha256>",
        "role": "czech-lexemes-and-paradigms"
      },
      {
        "id": "case-cosmos-pilot-plan-v1",
        "repositoryPath": "tools/czech-ml/data/games/case-cosmos/pilot-v1/lesson-plan.json",
        "sha256": "<sha256>",
        "role": "reviewed-game-intent"
      }
    ],
    "generator": {
      "repositoryPath": "tools/czech-ml/scripts/build-case-cosmos.mjs",
      "sha256": "<sha256>"
    }
  },
  "review": {
    "releaseState": "candidate",
    "approvals": []
  },
  "rights": {
    "status": "review",
    "licenseExpression": null
  },
  "coverage": {
    "difficulty": {},
    "concepts": {},
    "challengeTypes": {}
  }
}
```

The zero counts, empty approvals, and placeholder hashes above illustrate the
schema only. An enabled manifest must contain real validated values and may
not ship with placeholders or unresolved rights.

The runtime file has a common envelope even though its records use a
game-specific schema:

```json
{
  "schemaVersion": "caatuu-language-game-pack-v1",
  "gameId": "case-cosmos",
  "courseId": "cz",
  "targetLanguageId": "cs",
  "contentVersion": "case-cosmos-cs-v1",
  "records": []
}
```

Runtime files must be same-origin, immutable for their version, and contained
inside the owning game's data directory; a changed digest therefore requires
a changed versioned URL. Every `repositoryPath` is a repository-relative,
build-time reference resolved inside the canonical checkout. The browser does
not fetch files under `tools/`. Build validation checks the full schemas,
provenance, reviews, and references. Runtime loading performs the smaller but
essential envelope, byte count, record count, version, and SHA-256 checks.

### 3.2 Two permitted authoring modes

Each game chooses exactly one mode.

#### Directly authored

The manifest's runtime file is itself the reviewed, authoritative game JSON.
Formatting or validation may normalize bytes, but no semantic compiler creates
different challenge records. This is appropriate for the first small pilot and
when naturalness, discourse, or accepted answers cannot safely be generated
from a general paradigm.

Examples:

- reviewed clitic-order constructions;
- listening minimal pairs;
- a deliberately sequenced conjugation lesson.

#### Deterministically derived

The game names every general-language JSON input, every game-owned planning
input, the generator, and the frozen runtime output. Derivation happens in the
repository container before release. The browser reads only the compiled
runtime JSON declared by the manifest.

Examples:

- combining a reviewed noun paradigm with a reviewed case-use template;
- combining an adjective paradigm with a reviewed noun phrase;
- expanding one reviewed verb paradigm into person-and-number recognition
  challenges.

Derived does **not** mean:

- searching an arbitrary dictionary at runtime;
- constructing a Cartesian product in the browser and assuming it is natural;
- accepting any form returned by a model;
- reading content from an undocumented legacy path;
- silently falling back to examples embedded in JavaScript.

If a derived source or its hash changes, the generator must rebuild the runtime
file, update its manifest, and rerun linguistic and coverage validation.

All first planet pilots should begin as small directly authored runtime packs.
Promote facts into a general Czech source and add a semantic compiler only
after two proven consumers need the same authority or measured authoring cost
justifies it. Versioned schemas exist so unproven future features do not need
to be designed into pilot v1.

### 3.3 Per-planet source map

Every planet therefore has an explicit local JSON boundary even when the
linguistic facts are shared:

| Planet | Authoring authority | Game-local runtime boundary |
| --- | --- | --- |
| Word World | Existing reviewed authoring and deterministic build pipeline; migration must add the common envelope and provenance contract | Migrated `word-world/manifest.json` and versioned `records.json` |
| Verb Nebula | Existing `core-vocabulary.json` is migration input, not a sufficient runtime contract | Compile a finite stable-ID challenge pack and name it from `verb-nebula/manifest.json` |
| Conjugation Comet | Directly authored verb records; add structure only when a proved game mechanic needs it | `conjugation-comet/verbs.json`, used directly by the game |
| Case Cosmos | Directly authored bounded development sample; later shared reviewed paradigms, government records, lesson plan, and contexts only if evidence justifies them | `case-cosmos/challenges.json`, used directly by the game |
| Agreement Aurora | Directly authored bounded development sample; add shared morphology only after demonstrated reuse | `agreement-aurora/challenges.json`, used directly by the game |
| Sound and Spelling | Future reviewed challenge records, rule data, and verified audio manifest | Future game manifest to a versioned `challenges.json` and pinned audio assets |
| Memory Moon | A game-owned review policy plus runtime references to exact challenges from the other manifests | Its own configuration JSON and reference queue; never copied Czech answers |

The general JSON modules authorize reusable Czech facts. The game-owned lesson
plan or construction source authorizes what the planet may teach, in which
context, and at what difficulty. Both are required for a derived game; a
general paradigm file alone is not a challenge bank.

### 3.4 Czech variety authority

Before authoring a pilot, pin a language-level `variety-policy-v1.json`. The
initial policy should target contemporary Standard Czech with explicitly
approved neutral spoken variants. It must distinguish codified standard,
neutral or bookish standard variants, Common Czech, regional forms, medium,
and interpersonal register rather than flattening all variation into
`spoken`.

Each non-canonical realization needs separate fields such as:

```json
{
  "text": "<surface>",
  "normStatus": "standard",
  "variety": "standard-czech",
  "region": "general",
  "medium": "spoken",
  "register": "neutral",
  "acceptanceMode": "accepted-with-label"
}
```

Speaker intuition does not establish the teaching norm by itself. The policy,
qualified review, and stated learner audience decide whether a variant is
canonical, accepted with a label, feedback-only, or outside the current
course.

### 3.5 Language-game catalog

When the first new planet is implemented, add a language-owned catalog at:

```text
apps/languages/czech/static/data/games/catalog.json
```

It should list every enabled Czech planet and the relative path to its content
manifest. Tests must enforce parity among this catalog, the course-profile
capabilities, offline assets, browser navigation, and Android packaging.

This catalog is not the standalone game catalog at `apps/games/catalog.json`.
The two have different owners and release boundaries.

### 3.6 Identity only where a game needs it

Do not require authored IDs, revisions, manifests, or concept references merely
because a file may grow later. A small directly authored pack should remain
readable and editable as ordinary language content. Conjugation Comet therefore
uses its verb and form content directly; array position is only a temporary UI
key during a round, not an authored identity.

Stable identity becomes necessary only when a concrete feature must refer to a
record across releases—for example durable per-item progress, cross-game
references, or correction receipts. Introduce it with that feature and migrate
the affected content deliberately. The following larger challenge envelope is
therefore a possible contract for games that prove they need those capabilities,
not a required wrapper for every planet:

Possible stateful challenge fields are:

```json
{
  "schemaVersion": "<game-specific-schema>",
  "id": "<stable-challenge-id>",
  "revision": 1,
  "difficulty": 1,
  "challengeType": "<reviewed-mechanic>",
  "mode": "assess",
  "primaryConceptRef": {
    "id": "<stable-concept-id>",
    "revision": 1
  },
  "scaffoldedConceptRefs": [],
  "prerequisiteConceptRefs": [],
  "curriculumRefs": [],
  "sourceRefs": [],
  "responsePolicy": {
    "mode": "closedSelection",
    "normalizationPolicyId": "cs-selection-v1"
  },
  "review": {
    "releaseState": "candidate",
    "approvalRefs": []
  }
}
```

Each game owns the remainder of its record schema. A universal envelope must
not flatten Czech case roles, clitic context, audio provenance, or verb
features into vague strings.

When `sourceRefs` is non-empty, each entry is structured rather than a bare
path or note:

```json
{
  "sourceId": "cs-pilot-lexemes-v1",
  "recordId": "lexeme.hotel",
  "recordRevision": 1,
  "role": "head-noun-form-authority"
}
```

`sourceId` must resolve to an exact manifest-declared source ID and hash;
`recordId` and `recordRevision` must resolve inside that source. A direct pack
is itself the challenge authority, so it may have no derivation references,
but its review receipt, authorship, bibliography where used, and rights still
must be explicit. A derived record must resolve every source fact used by its
generator.

`difficulty` is game-specific. A CEFR label is optional and must appear only
through a pinned Czech curriculum or Reference Level Description mapping in
`curriculumRefs`; CEFR's broad can-do levels are not an authority for assigning
an isolated ending or lexeme to A1 merely by intuition.

### 3.7 Bounded response and accepted-answer policies

Assessed answers and distractors must be inspectable in the reviewed record or
must be reproducibly derivable from reviewed records under a tested rule.

- A language model may propose candidate content, but candidates are not
  runtime learning content.
- A generator may create distractors only from constraints defined by the
  game schema. For a bounded response space, the record must enumerate every
  accepted option identity or realization in that space, and validation must
  prove set separation. Human review, not the validator, attests that those
  sets are linguistically valid.
- A hint or explanation may not claim a rule that the record does not encode.
- A solution reveal produces exposure, not independent mastery evidence.
- A mechanic may display one canonical answer, but it must not reject another
  registered realization merely to force artificial uniqueness.

Every challenge selects one response mode:

- `closedSelection` — a finite set of option IDs with a complete accepted set;
- `slotProduction` — only a frozen target span is scored;
- `sentenceAssembly` — a finite set of reviewed grouped arrangements is
  scored;
- `openProduction` — formative feedback only and zero mastery weight until a
  separately validated evaluator exists.

The top-level challenge `mode` is separately one of `teach`, `guided`,
`assess`, or `transfer`. Only an independent first response in `assess` or
`transfer` mode may contribute assessment evidence.

An ordinary challenge assesses one primary concept. Vocabulary, spelling,
government, agreement, or word order that is not the target must be supplied,
locked, glossed, or already known and listed under `scaffoldedConceptRefs`.
Composite boss missions are allowed only after atomic evidence exists, and
their errors must not be attributed to one rule without diagnostic follow-up.

Records that accept text also name `assessmentFocus`, `scoredSpanIds`,
`incidentalErrorPolicy`, `normalizationPolicy`, and `acceptedRealizations`.
Normalize Unicode, harmless whitespace, and stated capitalization or
punctuation rules. Never strip Czech diacritics globally. A spelling-only
mistake may receive targeted or partial feedback without becoming negative
evidence for morphology when spelling was not the primary concept.

### 3.8 Review, release, and rights policy

One boolean called `humanApproved` is not an adequate quality gate. Review
receipts must identify the exact source or pack hash, rubric version, review
scope, reviewer role, date, disposition, and held findings.

Required distinctions are:

- **candidate** — authoring or disposable prototype only; never enabled;
- **internal preview** — may be Codex- or automatically reviewed, but is
  explicitly labelled and may not support public mastery claims;
- **linguistically approved** — checked by a qualified Czech-language reviewer
  for forms, constructions, meanings, variants, and naturalness;
- **pedagogically approved** — checked by the Czech content owner or educator
  for objective, cue, explanation, sequencing, and misconception quality;
- **production eligible** — all release-required scopes and rights are clear.

Review 100% of pilot prompts, scored answers, accepted variants, distractors,
and explanations. After a deterministic generator is proven, low-risk
paradigm expansions may use exhaustive source/rule review, automated
invariants, and risk-based output sampling. Discourse-sensitive clitic
sentences and assessed audio continue to require record-level qualified
review.

The pilot charter names the linguistic reviewer, pedagogical content owner,
release decision owner, and disagreement-adjudication path. One person may
hold more than one role only when their qualifications and the reduced
separation of review are recorded; no content silently self-approves.

Track minutes per accepted record, rejection and disagreement rates, and
revisions per accepted record. If review cost exceeds the pilot's precommitted
budget, simplify the content representation or mechanic before scaling.

Provenance is not permission. Every source needs an ownership or license
decision, attribution requirements, and a release status consistent with
[the legal inventory](LEGAL_INVENTORY.md). Unresolved rights block production
even when the linguistic content is correct.

### 3.9 Revision and migration policy

Reordering or presentation-only copy edits preserve a stable ID. A change to a
scored answer, meaning, context, response policy, primary concept, or rule
requires a challenge revision. A changed linguistic proposition requires a
concept statement revision as well.

Saved rounds and historical evidence must never be silently reinterpreted.
Each migration either:

- maps an old ID and revision to an equivalent new one through a reviewed
  crosswalk;
- retains old evidence only as item familiarity, not current rule evidence; or
- explicitly retires the evidence with a documented reason.

### 3.10 Feature vocabulary and external mappings

Do not let each game invent strings for case, number, person, aspect, mood,
voice, animacy, or verb form. Define a versioned Caatuu feature vocabulary and
map it to Universal Dependencies or another documented standard where the
semantics are genuinely equivalent.

Czech and game-specific concepts that a token-level standard does not express
fully—such as contextual time reference, future strategy, aspect relation,
motion determinacy, clitic function, discourse intention, or a construction's
zero realization—remain explicit Caatuu extensions with reviewed definitions.
The mapping is an interoperability aid, not permission to flatten a Czech
construction into token features.

### 3.11 Fail closed

If a manifest, schema, hash, source reference, or challenge invariant fails,
the affected game must show an unavailable state. It must not substitute
hard-coded demo challenges or generated answers.

## 4. Shared language-game backbone

The new games and Conjugation Comet should use one small backbone for content
loading, challenge identity, evidence, and progression. This does not require
one giant generic game implementation.

Split this work into two levels:

- **Pilot spine:** one game-local manifest and strict pack schema, stable IDs
  and revisions, exact reviewed JSON, a small loader, first-response events,
  bounded response evaluation, and fail-closed behavior.
- **Scale spine:** cross-game catalog, shared Czech ontology, adaptive
  scheduling, generated offline lists, Android parity, sharded packs, and
  generalized UI components.

Only the pilot spine precedes a mechanic test. Build scale infrastructure
after a vertical slice passes its product and learning gates.

### 4.1 Content loader

The shared loader should:

1. load the game manifest;
2. load only the declared runtime file;
3. validate manifest version, game ID, course ID, target-language ID, content
   version, pack envelope, byte count, record count, and digest;
4. expose stable records without mutating them;
5. report a bounded unavailable state when loading fails;
6. provide the content version to persisted round and evidence records.

PWA asset generation and Android static-package checks should take their
game-data paths from the same manifests or a generated asset list. A newly
added source must not work in an ordinary browser while being accidentally
absent from PWA offline use or Android packaging.

`courseId: "cz"` names the existing Caatuu course and storage/evidence
namespace. `targetLanguageId: "cs"` names Czech using the course profile's
target-language ID. The loader compares each field to the corresponding
course-profile field; the two identifiers are not interchangeable.

### 4.2 Challenge lifecycle

Every game should share these lifecycle concepts:

```text
load reviewed record
        ↓
compose deterministic round
        ↓
capture first response
        ↓
settle evidence exactly once
        ↓
show feedback, hint, or explanation
        ↓
schedule review or progression
```

Persisted state should record the content version, challenge ID and revision,
option identities, hint state, and settlement ID. A stale saved round must not
be restored against different content.

Before creating a new lifecycle library, inventory and reuse the immutable
content references, deterministic settlement IDs, stale-round rejection,
hint/reveal state, and DOM-independent view model already present in
`verb-exercise-family-core.mjs`. Extract only behavior proven neutral across
two mechanics; do not create a second settlement system.

### 4.3 Evidence observations before mastery claims

The aggregate `CaatuuLearning` totals remain useful for XP, rounds, and broad
statistics. They are not sufficient for grammar progression.

Grammar games should also use the existing semantic-learning evidence ledger
with stable concept IDs, for example:

```text
cz.verb.psat.indicative.nonpast.1sg
cz.verb.psat.aspect.imperfective
cz.case.accusative.direct-object
cz.case.locative.v-location
cz.agreement.adjective.feminine.accusative.singular
cz.clitic.second-position.se
```

Evidence rules:

- settle only the first response to a challenge;
- record incorrect as well as correct independent attempts;
- reduce assessment weight when a specific hint was used;
- give a revealed solution zero mastery weight;
- distinguish recognition, controlled production, and transfer;
- require evidence across more than one lexeme or sentence before declaring a
  general rule mastered;
- allow two games to contribute to the same linguistic concept when they
  genuinely test the same capability;
- keep exact-item familiarity separate from rule transfer.

During pilots, call these records observations rather than calibrated mastery.
Split content into teaching, practice, immediate-transfer, and delayed-transfer
sets. Held-out lexemes or contexts cannot appear in teaching or ordinary
practice. Record first-response correctness, response time, hint and reveal
use, retry count, abandonment, and whether transfer is immediate or delayed.

No UI or scheduler may claim that a rule is mastered until thresholds and
retention intervals have been calibrated against held-out performance.

### 4.4 Shared concept authority and capacity

Cross-game concepts require their own reviewed, versioned `concepts.json`.
Each entry fixes the concept ID, statement revision, canonical statement text,
kind, locale, prerequisites, and the evidence capabilities it represents.
Game records reference an ID and revision; they do not invent slightly
different statement text for the same ID.

Preserve `cz.*` as the existing course/evidence namespace unless an explicit
migration proves otherwise. It is intentionally different from target language
ID `cs`.

The current semantic ledger is bounded to 4,096 statement keys and 16 signals
per attempt. Define a per-game concept budget and CI coverage check before
creating per-lexeme × feature concepts. Exact-item familiarity stays in a
bounded item namespace or game state unless it is deliberately promoted to a
shared concept.

A versioned readiness-policy JSON may eventually define independent-attempt,
transfer, delayed-confirmation, hint, reveal, and unlock rules. During the
pilot, keep progression authored and simple; add adaptation only after the
observations can calibrate that policy.

### 4.5 Progression scheduler

Difficulty levels remain the broad learner setting, but challenge selection
should additionally consider:

- explicit prerequisites;
- unintroduced versus introduced concepts;
- recent failures;
- time since last successful evidence;
- recognition versus production balance;
- repeated exact item versus a transfer item;
- content coverage and available reviewed contrasts.

Random shuffling may vary a ready challenge. It must not be the curriculum.

Prerequisites are concept-level, never whole-planet completion. A short
Agreement or embedded clitic-placement lesson may become ready while most of
Case Cosmos remains unseen, provided the exact required forms are supplied or
already evidenced.
Use a hybrid sequence: briefly block examples to expose a pattern, then
interleave confusable constructions to train discrimination and transfer.

### 4.6 Common interaction components

Reusable components may include:

- selectable cards and token banks;
- prompt, progress, hint, reveal, and explanation areas;
- audio playback controls;
- reduced-motion and keyboard behavior;
- first-response settlement;
- loading, empty, stale-content, and unavailable states.

Every interaction also requires:

- no drag-only or timed assessed action;
- keyboard, switch, touch, and linear screen-reader controls;
- text and icon feedback in addition to color;
- a reduced-motion equivalent for every animated state;
- adjustable board size rather than assuming six items fit every learner;
- Czech diacritic input assistance for typed production;
- plain-language cues with optional grammatical terminology.

The actual prompts, answer rules, features, distractors, and explanations stay
inside each language game's reviewed contract.

### 4.7 Offline and package delivery are separate contracts

Do not route ordinary grammar JSON through `setup-assets.json`; that file
governs downloaded visual and large artifacts.

- **PWA:** generate the enabled game-asset list from content manifests, derive
  the cache revision from its digest, and decide explicitly whether one
  optional game's failure blocks installation or only that game.
- **Android:** keep ordinary game JSON in the existing static-asset sync and
  assert manifest, pack, route, and path parity inside the APK. Android blocks
  service-worker requests, so PWA cache behavior is not its delivery path.
- **Both:** every changed pack digest must produce a changed immutable URL.
  Record `contentBytes`; introduce immutable `packs[]` only after a measured
  byte threshold is exceeded. Audio and other large optional expansions must
  not enter the core precache by default.

### 4.8 Application integration contract

The language game catalog remains a content registry, not a dynamic UI
registry. This avoids an asynchronous navigation rewrite during the pilot.
Parity tests keep the explicit declarations aligned.

The lowest-risk presentation for each proven new planet is a standalone page
like Conjugation Comet. Its implementation checklist includes:

- `<game-id>.html`;
- `source/games/<game-id>/{core.mjs,app.js,app.css}`;
- course route and capability;
- planet presentation metadata and landing card;
- PWA asset registration;
- navigation, accessibility, browser, and Android contract tests.

Word World's embedded iframe remains a legacy presentation choice, not the
template for new planets.

### 4.9 Content correction loop

Every enabled planet should expose the existing feedback path with game ID,
content version, challenge ID and revision, response policy, and a bounded
learner report category. A correction follows the revision policy and produces
a review receipt; it must not edit shipped content invisibly.

## 5. Conjugation Comet backbone and expansion

### 5.1 Learning contract

Conjugation Comet's long-term territory is how Czech verb forms and verb
complexes express person, number, tense, aspect, mood, agreement, polarity,
variety, and communicative intent. That territory is a map, not v1 scope.

The repaired development pilot presents one productive single-word nonpast
pattern through six provisionally audited verbs, person and number, and one
consistent side-by-side matching mechanic. Five verbs build familiarity; a
sixth unfamiliar verb provides a near-transfer recognition check without
changing the rules of play. This does not demonstrate independent conjugation
or productive recall. Cap the initial scored bank at roughly 24–48 records
instead of materializing every possible combination. Aspect, past, future,
conditional, imperative, register contrasts, and voice are later campaigns
that require separate evidence.

It should not absorb noun declension or general noun-phrase agreement. Those
belong to Case Cosmos and Agreement Aurora.

### 5.2 What is missing now

The current game has a useful two-stage round—meaning followed by six
person/number matches—and now reads one intentionally small authored shape:
`language`, then `verbs`, with `verb`, `meaning`, optional `hint`, and a `forms`
array containing `label`, `form`, `cue`, and optional `accepted` alternatives.
The file contains no authored IDs or speculative grammar taxonomy.

```json
{
  "language": "cs",
  "verbs": [
    {
      "verb": "mít",
      "meaning": "have",
      "hint": "Imperfective. High-frequency. Pattern: -ám.",
      "forms": [
        { "label": "S1", "form": "mám", "cue": "I have" },
        { "label": "S2", "form": "máš", "cue": "you have" }
      ]
    }
  ]
}
```

The example is shortened; the current Czech records contain all six person and
number forms. Other languages may use the labels and number of forms natural to
their own conjugation system. A language without conjugation simply does not
enable this planet.

The first development pilot now derives five regular imperfective `-at` verbs
from those records and places `znát` last as an unfamiliar recognition check.
Every verb uses the same flow: meaning readiness when needed, then the existing
six-form side-by-side matching board. Errors explain the relevant person,
number, and form ending; P2 also names formal singular `vy`; and each completed
round gives a short summary of the shared `-ám` surface family. The final verb
changes the content, not the interaction, and its result remains recognition
evidence rather than proof of productive rule transfer.

The development slice now has a firm status boundary:

- **Implemented:** the simple direct JSON boundary, meaning readiness, the
  six-verb matching sequence, specific error feedback, the person/number key,
  and the post-round family summary;
- **Required before release or efficacy claims:** independent qualified Czech
  review of the six selected records and every learner-facing grammatical
  claim, followed by accessibility and facilitated usability testing;
- **Deferred:** typed production, delayed transfer, durable reuse of Verb
  Nebula evidence, other present-tense families, and later tense, aspect, mood,
  reflexive, agreement, and register campaigns.

These pending review and research gates block declaring Conjugation Comet
complete or expanding it, but they do not block planning the next planet.

The remaining backbone is evidence and expansion, not more speculative data:

- the six pilot verbs still need independent qualified Czech review beyond the
  development audit, and the other 53 records remain unaudited in depth;
- meaning readiness is remembered only within the current page session rather
  than reusing durable Verb Nebula evidence;
- the mission needs a consented baseline plus facilitated comprehension,
  accessibility, and replay testing;
- the current matching evidence is local and does not yet establish productive
  recall or delayed transfer;
- other present-tense families and later aspect, future, past, mood, reflexive,
  and register campaigns remain separately gated work.

### 5.3 Content authority

The safe improvement path is:

1. keep the current simple `verbs.json` as both authoring source and runtime
   boundary;
2. select and linguistically audit 6–8 verbs that expose one useful Czech
   pattern or contrast without changing the shape;
3. run that small reviewed set in a deliberate order through the same matching
   board, with the unfamiliar verb last;
4. teach inside the matching loop through specific error feedback, a concise
   post-round pattern summary, and the person/number key;
5. measure comprehension, confusion, completion, and replay before adding a
   second mechanic;
6. add a new field or companion file only when a demonstrated mechanic cannot
   be authored clearly with the current content, and keep that addition as
   small and human-readable as possible;
7. promote facts into a shared language source only after another real consumer
   needs them.

An eventual normalized verb source should distinguish at least:

- stable lexeme ID, revision, lemma, senses, and semantic family;
- sense-level `aspectValue` plus reviewed `aspectRelations` with target sense
  references and relation types; do not assume every verb has one partner;
- conjugation class, paradigm pattern, principal parts, and stem alternations;
- lexically required clitic or marker type and `se`/`si` behavior;
- motion determinacy, motion-partner references, and future strategy,
  separately from aspect;
- person, number, form series or morphological construction, morphological
  tense, contextual time reference, mood, gender where applicable, polarity,
  and voice;
- canonical surface plus variants classified by the variety policy;
- valency frames and reviewed contextual examples;
- difficulty, curriculum references, prerequisites, rights, provenance, and
  review state.

Single-word forms and multiword verb constructions are different data types.
Past, analytic future, and conditional records need underlying segments,
possible zero realization, each segment's feature contribution, licensed
surface order, and any reviewed fusion. This supports contrasts such as a
third-person past with no auxiliary, `budu psát`, and fused `jsi + se` without
pretending that each is one scalar form string.

Morphological tense and time reference must remain separate. For example, a
perfective present-form paradigm such as `napíšu` ordinarily refers to future
time, while an imperfective future is assembled analytically. Collapsing both
facts into a single `future` label would make the content unable to explain or
test the Czech system correctly. Aspect relations attach to a reviewed sense,
not merely a lemma, and the `po-` future of the reviewed determinate motion
class must never be inferred as ordinary perfectivization.

### 5.4 Pilot play contract

The pilot fantasy is to stabilize a family of comets by matching each Czech
form to the person-and-number cue it expresses. One run moves through five
related verbs and finishes with an unfamiliar sixth verb, using the same board
throughout.

The primary interaction is intentionally singular: select one Czech form and
one English cue, receive immediate specific feedback, retry if needed, and
continue until all six pairs are complete. Meaning readiness may precede the
board for a new verb, but it is not a new conjugation mechanic. After each
board, show the shared surface endings and continue to the next verb. Do not add
prediction, assembly, or typing until observation shows that matching alone
cannot meet the next learning objective.

### 5.5 Long-term learning orbits

#### Orbit 1 — Meaning readiness

- Check the infinitive meaning only when the verb is new or weak.
- Reuse Verb Nebula evidence instead of making every round repeat the gate.
- Teach the lemma together with lexically required clitics or markers such as
  `se` or `si`, without implying that every occurrence has the same function.

#### Orbit 2 — Pattern discovery

- Compare a small group that shares a productive pattern.
- Highlight the stable stem, changing ending, and reviewed stem alternation.
- Ask the learner to predict one form after seeing two related forms.

#### Orbit 3 — Person and number

- Retain the six-form recognition board only for reviewed single-word finite
  indicative series. It is not the mechanic for past, analytic future, or
  conditional constructions.
- Explain syncretism when one surface realizes multiple feature bundles.
- Teach formal singular `vy`, not only English “you all.”

#### Orbit 4 — Controlled production

- Complete an ending or build the Czech form from a stem and feature cue.
- Accept registered neutral, spoken, or formal variants without presenting all
  variants as stylistically identical.
- Use Czech situational cues rather than relying only on English pronouns.

#### Orbit 5 — Aspect and future

- Contrast imperfective present, analytic imperfective future, and simple
  perfective future.
- Teach aspect partners in meaningfully bounded situations.
- Include a reviewed closed sequence of determinate motion verbs and their
  `po-` futures; do not generalize from only `jít` and `jet` or infer the class.

#### Orbit 6 — Past and agreement

- Assemble the `-l` participle, the correct 1st/2nd-person auxiliary or reviewed
  third-person zero realization, and their licensed order.
- Introduce speaker or subject gender only when context makes it knowable.
- Share genuine predicate-agreement concept evidence with Agreement Aurora.

#### Orbit 7 — Intent and register

- Add imperative, conditional, negation, polite requests, and formal address.
- Teach how aspect changes the ordinary interpretation of positive and
  negative commands.

#### Orbit 8 — Sentence transfer

- Place a well-practiced form into a reviewed Czech utterance.
- Supply or lock reflexive/clitic placement unless placement is explicitly the
  primary concept in a later composite mission.
- Finish with an unseen sentence using a known rule and a familiar lexeme.

#### Deferred orbit — Voice and passive constructions

- Add voice, passive-participle, auxiliary, agreement, and construction fields
  in a later schema version after a reviewed pilot proves their mechanic.
- Defer assessed campaigns for periphrastic passive forms such as `je chválen`
  and reflexive or passive-like forms such as `staví se` until the active verb,
  agreement, and clitic foundations are reviewed.
- Keep those construction families distinct. Shared surface material such as
  `se` does not make them one rule.

### 5.6 Challenge types

Planned challenge types are:

- meaning readiness;
- form-to-feature recognition;
- feature-to-form selection;
- ending completion;
- principal-part prediction;
- aspect contrast;
- auxiliary and participle assembly;
- accepted-variant classification;
- contextual sentence completion;
- controlled typed production;
- transfer to a new reviewed context.

### 5.7 Implementation steps

1. **Pending research:** capture a consented baseline and freeze the comparison
   tasks.
2. **Implemented development slice:** derive the `-ám` family and use five
   teaching verbs plus one unfamiliar final verb. Independent qualified review
   remains required before learner research.
3. **Implemented:** keep the current simple `verbs.json` as the pilot's authoring
   and runtime source; do not add authored IDs, a manifest, or a compiled pack.
4. **Implemented for evaluation:** use one keyboard- and touch-accessible
   side-by-side matching board for every selected verb, with specific error
   feedback and a compact post-round family explanation.
5. Run accessibility and facilitated usability tests before visual polish.
6. Run the held-out learning and replay pilot if usability passes.
7. Extract only the loader, lifecycle, and evidence pieces demonstrated by the
   winning slice.
8. Decide proceed, revise, merge, or stop before expanding the pilot to the
   rest of the already migrated 59-verb collection.
9. If proceeding, audit the remaining records in reviewed batches. Consider a
   compiler or companion file only if a demonstrated mechanic makes one
   necessary and the result remains easy to author and inspect.
10. Add aspect/future, past/agreement, intent, and adaptive selection only
    through separately gated expansions.

## 6. Case Cosmos

Status: content and learning loop implemented; interface refinement is a
separate workstream; qualified Czech review and learner testing remain pending

### 6.1 Learning contract

Case Cosmos teaches one central idea: **a Czech noun changes to show the job it
has in an utterance**. The complete planet must cover all seven Czech cases.
The current beginner slice keeps one noun fixed for a whole board so the
learner can see its seven forms together.

The case names are the permanent identities. Their English meanings and
questions are reusable beginner guides, not complete grammatical definitions.
Examples instantiate this system; they never redefine it.

#### Permanent Case Cosmos base

The shared beginner base expresses every case in the same three-part form:

```text
case name → general meaning → simple guiding question
```

| Permanent case | General beginner meaning | Simple guiding question |
|---|---|---|
| Nominative — 1st case | naming or subject | Who or what is the subject? |
| Genitive — 2nd case | belonging, origin, or absence | Whose? From or without whom or what? |
| Dative — 3rd case | receiver or beneficiary | Who or what receives or benefits? |
| Accusative — 4th case | direct target | Who or what is the target? |
| Vocative — 5th case | direct address | Who or what is addressed? |
| Locative — 6th case | place or topic after a preposition | Where, or about whom or what? |
| Instrumental — 7th case | companion or means | With whom, or using what? |

The application declares this table once. The JSON does not repeat it. The
same surface form may represent more than one case, so the complete Czech
utterance remains part of every example. The grammatical reference for the
inventory is [CzechEncy: PÁD](https://www.czechency.org/slovnik/P%C3%81D).

### 6.2 Core game loop

```text
see a communicative situation
        ↓
match it to a complete Czech utterance
        ↓
receive immediate meaning-based feedback
        ↓
after the board, compare the case base with the matched Czech sentences
        ↓
optionally reveal the formal case name
```

Example:

```text
Situation: I am giving Petr a book.
Complete Czech sentence: Dávám Petrovi knihu.
Plain observation: Petr receives the book, so Petr changes to Petrovi.
Optional grammar name after the board: dative
```

The intended lesson unit is a consistent side-to-side board with ordinary
situations and complete Czech utterances. Every board is dedicated to one noun
and contains one example of each case. Eighteen noun boards reuse the same seven
general questions, making the changing forms of one noun visible before the
learner moves to another noun. The active Caatuu difficulty determines how
many of those noun patterns are available. After each board, show the seven
case names and beginner meanings beside that noun's seven forms. This teaches
recognition of the noun's job and exposes a declension pattern; it does not yet
prove that the learner can choose a construction or produce an inflected form
independently.

The general guiding question belongs to the case and stays reusable across its
examples. It must not collapse into an action from one sentence, such as “Who
is reading?”, or include the example noun. The noun, name, action, and answer
belong only in the situation and Czech utterance. A prompt such as “Calling
Petr” is invalid because it mixes the reusable case guide with the specific
content that should instantiate it.

### 6.3 Content authority

The directly authored `challenges.json` is a top-level JSON list. Each item is
one noun record containing `noun`, `difficulty`, and `cases`. `difficulty` is
an integer from 1 to 3 using Caatuu's Explorer, Traveler, and Navigator levels.
`cases` contains the seven case names in their standard order. Every case
contains only the changing `form`, the `english` situation, and the complete
`czech` sentence. The current development bank has eighteen noun records and
126 case examples in total.

This is the complete current runtime shape:

```json
[
  {
    "noun": "Petr",
    "difficulty": 1,
    "cases": {
      "Nominative": {
        "form": "Petr",
        "english": "Petr is reading.",
        "czech": "Petr čte."
      }
    }
  }
]
```

The application owns the fixed Case Cosmos base—case meanings, guiding
questions, lesson instructions, summaries, and interface feedback—once. The
JSON owns the noun, its exact seven forms, and the English/Czech content that
changes. It also owns the noun's game-specific difficulty because that value
changes which noun boards the learner receives. It contains no authored IDs,
prompt metadata, review fields, source links, lesson wrapper, rounds, or
summaries. Additional noun details may be added beside `noun`, `difficulty`,
and `cases` only when a demonstrated learning or selection need requires them.
Grammatical sources, review status, and release gates
remain in this plan and the review process rather than being mixed into the
runtime content.

Difficulty is cumulative and describes this game's progression, not CEFR:

- **1 — Explorer:** twelve frequent, comparatively transparent noun patterns;
- **2 — Traveler:** adds four noun patterns with more form overlap or stem
  change, for sixteen available boards in total;
- **3 — Navigator:** adds two less transparent patterns, making all eighteen
  boards available.

The runtime includes every record whose `difficulty` is less than or equal to
the learner's active Caatuu difficulty. It keeps records ordered by difficulty
and refreshes the noun sequence when the shared difficulty changes. These
assignments organize the development bank; they do not claim that a learner
has reached a CEFR level or mastered a case.

The direct `challenges.json` remains the only runtime content source. Do not
add a manifest, compiler, authored IDs, or shared paradigm infrastructure until
a demonstrated learning feature requires it. The current records and examples
still require independent qualified Czech review before production use.

### 6.4 Learning sequence

- **Current:** recognize the noun's job and compare all seven singular forms on
  one-noun matching boards.
- **Next:** deepen common dative, instrumental, locative, and contrasting
  preposition uses with reviewed complete utterances.
- **Later:** add hard and soft patterns across genders, masculine animacy,
  plural forms, stem changes, and unfamiliar-noun transfer.
- **Advanced:** add verb-specific case requirements, multiword noun phrases,
  pronouns, and less transparent expressions.

Every expansion must retain all seven cases in the planet map even when one
small campaign focuses on only one contrast.

### 6.5 Interaction roadmap

- current side-to-side situation and Czech-sentence matching;
- later selection of the phrase that explains why the noun changes;
- noun-form completion inside a complete utterance;
- case-error repair and unfamiliar-noun transfer.

### 6.6 Learning evidence

The implemented UI records recognition matches only, and the current shared
learning profile stores aggregate game totals. It does not yet prove that a
learner can explain a case choice, produce a noun form, or transfer a pattern.
Future evidence must record the case, the exact learner decision, and success
with a different reviewed noun.

### 6.7 Handoff

The development slice now has:

- one simple directly authored JSON list;
- eighteen nouns and 126 case examples;
- twelve Explorer, four additional Traveler, and two additional Navigator
  noun records;
- one side-to-side interaction for every noun; and
- all seven cases on every board.

Interface refinement is now a separate workstream. It may improve presentation
and accessibility without changing the permanent case base, the noun-centered
loop, or the JSON contract unless this plan is updated first.

Before expanding the learning design, complete qualified Czech review,
accessibility and facilitated usability testing, case-level evidence design,
and one held-out unfamiliar-noun transfer check. Only then decide whether to
expand Case Cosmos or merge overlapping work with Agreement Aurora.

## 7. Agreement Aurora

Status: singular-gender content and gameplay slice implemented; interface
refinement, qualified Czech review, and learner testing pending

### 7.1 Learning contract

Agreement Aurora teaches one central idea: **words connected to a Czech noun
change so they match it**. The first slice keeps the noun in its ordinary
naming form and changes one hard adjective across masculine, feminine, and
neuter singular phrases.

Case Cosmos changes the noun because of its job in an utterance. Agreement
Aurora changes another word to match the noun. The first slice does not ask the
learner to choose a case, number, or animacy class.

### 7.2 Core game loop

```text
see one adjective with three English noun phrases
        ↓
match each English phrase to its complete Czech phrase
        ↓
receive immediate meaning-based feedback
        ↓
compare the masculine, feminine, and neuter adjective forms
        ↓
continue with a new adjective on the same board
```

One possible first board demonstrates:

- `nový dům` — new house;
- `nová kniha` — new book; and
- `nové město` — new city.

Every page holds one adjective fixed and uses one side-to-side matching
interaction. The three noun phrases reveal the `-ý`, `-á`, and `-é` contrast
without adding a separate gender quiz or ending-construction subgame.

### 7.3 Content authority

The directly authored `challenges.json` is the only runtime content source. It
is a top-level list. Each record contains one `adjective`, its game-specific
`difficulty`, and exactly three `forms` in masculine, feminine, and neuter
order. Every gender contains its adjective `form` and an `examples` list. Each
example contains only `english` and `czech`.

```json
[
  {
    "adjective": "nový",
    "difficulty": 1,
    "forms": {
      "masculine": {
        "form": "nový",
        "examples": [
          { "english": "new house", "czech": "nový dům" },
          { "english": "new phone", "czech": "nový telefon" },
          { "english": "new student", "czech": "nový student" }
        ]
      },
      "feminine": {
        "form": "nová",
        "examples": [
          { "english": "new book", "czech": "nová kniha" },
          { "english": "new school", "czech": "nová škola" },
          { "english": "new question", "czech": "nová otázka" }
        ]
      },
      "neuter": {
        "form": "nové",
        "examples": [
          { "english": "new city", "czech": "nové město" },
          { "english": "new car", "czech": "nové auto" },
          { "english": "new window", "czech": "nové okno" }
        ]
      }
    }
  }
]
```

The application owns the permanent gender order, lesson text, feedback, and
matching behavior. The JSON owns every adjective, exact form, complete phrase,
English meaning, and difficulty. For each board, the browser selects one
authored example for each of the three forms. It validates and displays those
records; it does not generate arbitrary noun–adjective combinations or keep
challenge phrases in HTML or JavaScript.

The development bank contains eighteen adjectives and 162 phrase pairs:

- **Explorer:** six adjectives;
- **Traveler:** adds six, for twelve available boards; and
- **Navigator:** adds six, for all eighteen boards.

Do not add a manifest, compiler, authored IDs, or a general morphology catalog
until a demonstrated learning feature or a second reviewed consumer requires
one.

### 7.4 Learning sequence

- **Current:** hard-adjective gender in familiar masculine, feminine, and
  neuter singular naming phrases.
- **Next:** held-out noun transfer, then reviewed soft-adjective and
  demonstrative contrasts.
- **Later:** case and number across complete noun phrases, followed by animacy
  and predicate agreement.
- **Advanced:** pronouns, possessive forms, participles, and numeral
  constructions only through separately reviewed expansions.

Do not treat formal `vy`, quantified subjects, coordinated subjects, or
cardinal numerals as simple feature-copying. They require their own reviewed
records and rules.

### 7.5 Interaction roadmap

- current English-to-Czech phrase matching;
- later selection of the adjective that matches a visible noun;
- one-error phrase repair;
- whole-phrase case or number transformation; and
- unfamiliar-noun transfer.

### 7.6 Learning evidence

The implemented UI records recognition matches and aggregate game totals. A
correct match proves familiarity with that phrase, not independent gender
selection, adjective production, or transfer. Later evidence must identify the
tested gender and use a different reviewed noun before claiming transfer.

### 7.7 Handoff

The initial development slice now has:

- one standalone planet and launcher entry;
- one directly authored JSON list with eighteen adjectives, three examples per
  gender form, and 162 phrase pairs;
- six Explorer, six additional Traveler, and six additional Navigator
  records;
- one side-to-side interaction for every adjective;
- a completed-board comparison of the three adjective forms; and
- offline, shared-navigation, keyboard, mobile, and reduced-motion contracts.

Before expanding the learning design, complete qualified Czech review,
facilitated usability and accessibility testing, and one unfamiliar-noun
transfer experiment. Then decide whether the player decision is sufficiently
different from Case Cosmos to remain its own planet.

At the present development scope, Agreement Aurora is ready to hand off for
interface refinement. No additional grammar planet is approved next. The
existing planets should be reviewed and consolidated before another one is
created.

## 8. Clitic placement inside existing learning

Status: **not a separate planet**

Czech learners still need to encounter the placement of short unstressed words
such as `se`, `si`, past auxiliaries, conditional forms, and short pronouns.
That need does not justify a standalone Clitic Orbit game. The material should
instead appear where it naturally belongs:

- learn verbs such as `učit se` with their required `se` in Verb Nebula or
  Conjugation Comet;
- keep the placement fixed and visible in early complete sentences;
- use reviewed contextual sentence practice in Word World or a later shared
  mission when placement itself becomes the learning point; and
- introduce larger clitic groups only when the surrounding tense, pronoun, or
  sentence construction is already being taught.

Do not create a `clitic-orbit` route, planet asset, manifest, challenge pack, or
separate progression track. If an existing game later assesses placement, its
own JSON must contain complete reviewed Czech sentences and accepted contextual
orders. It must not generate Czech word order by naively shuffling individual
words or claim that every alternative order is ungrammatical.

Word World now implements the first embedded content step with 32 Level 2
sentences: eight common verbs with `se`, four natural sentence openings per
verb, and `se` itself available as an exploration target. Selecting `se` can
therefore continue into another authored sentence from the same bounded content
bank. The batch is Codex-reviewed development content, not independently or
human approved; qualified Czech review remains a production gate.

## 9. Sound and Spelling planet

Status: **future backlog; no current implementation commitment**

The name is intentionally not final. This game must not enter the active Czech
catalog or course capabilities until its audio and content authorities are
defined and a reviewed pilot exists.

Sound perception, pronunciation production, and orthographic choice may prove
to be separate mechanics. Do not force them into one planet merely because the
working title combines them.

### 9.1 Future learning contract

Connect Czech perception, pronunciation, vowel length, diacritics, and spelling
without reducing the experience to abstract orthography quizzes.

Potential scope:

- short and long vowels;
- `i/í` and `y/ý` as a spelling and morphology problem, not an auditory vowel
  contrast in contemporary standard Czech;
- `ě` and consonant effects;
- háček and čárka contrasts;
- initial stress of the phonological word or stress group, including
  stress-bearing prepositions and unstressed clitics;
- voicing assimilation and final devoicing;
- consonant clusters;
- identifying grammatical endings by sound;
- short dictation and spelling repair.

### 9.2 Future content authority

The future manifest must pin:

- an orthography and phonology rule JSON source;
- reviewed word, minimal-pair, and utterance records;
- exact audio asset IDs, hashes, speaker or synthesis provenance, license, and
  review status;
- the relationship among written form, phonemic target, accepted
  pronunciation, and assessed distinction;
- a versioned compiled challenge file.

Text-to-speech may be a delivery aid, but an unreviewed generated waveform
must not silently become the pronunciation authority for an assessed item.

### 9.3 Potential challenge types

- hear and choose;
- choose vowel length;
- restore missing diacritics;
- minimal-pair discrimination;
- syllable and stress marking;
- short dictation;
- repair spelling from a reviewed audio prompt.

### 9.4 Preconditions if the backlog is reconsidered

1. Decide the final product name and learner scope.
2. Define recording or synthesis provenance and review policy.
3. Define the audio-aware manifest and record schemas.
4. Build a small vowel-length and diacritic pilot.
5. Validate on representative browser and Android audio paths.
6. Only then decide whether to prototype it and whether sound and spelling
   remain one planet.

## 10. Cross-game prerequisites

The games should reinforce one another without copying content or forcing a
learner to finish one planet before touching another.

```text
Word World / Verb Nebula evidence
                 │
                 ▼
       known vocabulary and meanings
                 │
       ┌─────────┼──────────┐
       ▼         ▼          ▼
     Comet      Case     Agreement / Clitic
       │         │          ▲
       └── exact concept prerequisites only ──┘

All enabled games ───────────────► Memory Moon reference queue
```

Examples of legitimate reuse:

- Verb Nebula meaning evidence can skip Comet's meaning gate.
- One Case Cosmos challenge can establish the exact case concept used by one
  Agreement challenge; Case Cosmos completion is not required.
- One Comet construction can establish the exact past auxiliary and participle
  used by one Clitic challenge; Comet completion is not required.
- Word World records may provide reviewed sentence contexts when a game
  manifest pins their exact IDs and revisions.
- Memory Moon stores references to weak concepts and source challenges, not
  copied answers.

Prototype the mechanics separately so their player decisions can be evaluated.
If more than one passes, combine thin beginner slices into an interleaved A1
mission rather than completing one grammar taxonomy at a time. A small shared
mission source of 6–10 reviewed scenes or micro-stories may provide contexts to
multiple game compilers; every game still emits and pins its own exact runtime
records. This reuse is allowed only when the context ID, revision, meaning,
rights, and review are shared deliberately.

## 11. Repository layout to establish

The target separates canonical authoring/review evidence, browser runtime data,
and application code. This is an illustrative shape; create only the pilot
paths required by the current gate.

```text
tools/czech-ml/
  schemas/
    language-game-content-manifest-v1.schema.json
    language-game-pack-v1.schema.json
  data/
    czech-grammar/
      variety-policy-v1.json
      pilot-v1/
        lexemes.json
        government.json
        pronoun-clitic-realizations.json   # only when required
    games/
      <game-id>/
        <authoring-version>/
          lesson-plan.json
          schema/challenge.schema.json
          reports/coverage.json
          review/<review-receipts>.json

apps/languages/czech/static/data/
  games/
    catalog.json
    word-world/
      manifest.json
      <content-version>/records.json
    verb-nebula/
      manifest.json
      <content-version>/challenges.json
    conjugation-comet/
      verbs.json
    case-cosmos/
      challenges.json
    agreement-aurora/
      challenges.json
  language/
    concepts.json
    readiness-policy.json          # only after calibration

apps/languages/czech/static/
  <game-id>.html
  source/games/<game-id>/
    core.mjs
    app.js
    app.css
```

Authoring schemas, validators, generators, reports, and candidate review
workspaces belong under `tools/czech-ml/`. Browser-ready reviewed JSON belongs
under the language app's `static/data` boundary. Generated reports and source
candidates must not become runtime content merely because they are nearby.

For a direct pilot, the versioned runtime `challenges.json` is also the
reviewed authoritative record set. For a derived release, the manifest pins
all canonical inputs under `tools/czech-ml/`, the generator, and the separate
runtime output. Shared grammar data belongs under `static/data/language/` only
when a live browser consumer actually needs it; do not ship a duplicate general
grammar catalog solely because a build tool used it.

The exact number of shared grammar modules should follow real reuse. Do not
move Comet data into a general catalog until another reviewed consumer needs
the same facts.

## 12. Investment-gated delivery plan

### Known repository transition debt

This debt is real but does not block a disposable, developer-only pilot. It
must be resolved before the shared catalog or a new planet is publicly
enabled:

- Word World runtime data now lives under `static/data/games/word-world/`, but
  its builder and deterministic test still resolve retired
  `static/data/word-world/` paths.
- The Word World manifest and pack predate the proposed common game ID,
  course/target-language IDs, schema paths, record revision, provenance, and
  pack-envelope fields; permissive runtime normalization must be audited
  against the fail-closed rule.
- Verb Nebula currently derives some identities from array position. It needs
  a finite stable-ID challenge pack plus an explicit localStorage and semantic
  evidence crosswalk or retirement decision.
- Memory Moon remains exempt while it is a non-assessing placeholder.

### Milestone -1 — Product and data feasibility

1. Freeze a pilot charter naming the learner audience, Czech variety, primary
   decision, session length, device assumptions, out-of-scope features,
   responsible Czech reviewer/content owner, and consented observation method.
2. Precommit maximum engineering time, content count and bytes, qualified
   review cost, participant count, success thresholds, and stop rules.
3. Record a baseline from the current Conjugation Comet using frozen tasks.
4. Decide rights and licensing for proposed Czech grammar sources.
5. Create a tiny reviewed lexeme/paradigm and government sample, measure
   review throughput and disagreement, and compile or hand-check one disposable
   Case record set. This tests the largest missing data dependency before UI
   investment.
6. Produce the Comet pilot's six-verb direct JSON set and the matching-only
   sequence.
7. Stop if the content cannot be reviewed affordably or the matching loop does
   not give learners a clear primary decision.

### Milestone 0 — Minimum pilot spine and Comet vertical slice

1. Keep the existing simple `verbs.json` as the authoring and runtime boundary;
   add no manifest, pack envelope, or authored IDs for this pilot.
2. Audit the six selected verbs, their cues, accepted forms, hints, and the
   claims made by matching feedback.
3. Keep the loader fail-closed and record matching attempts without inventing a
   second exercise lifecycle.
4. Build the short matching-only sequence: five related verbs followed by one
   unfamiliar verb on the identical board.
5. Run the accessibility and facilitated usability gate before art polish.
6. If that passes, run the opt-in learning/replay pilot.
7. Decide proceed, revise once, merge, replace, or stop.

### Milestone 1 — Harden only a proven slice

Begin only after the Comet slice passes its precommitted gates.

1. Finalize the reusable portions of the manifest, pack, response, concept,
   and review contracts from evidence gathered in the slice.
2. Migrate Word World's path, manifest, pack envelope, revisions, and loading
   invariants.
3. Compile Verb Nebula's finite stable-ID pack and implement its explicit
   progress/evidence migration decision.
4. Add the reviewed `concepts.json`, concept capacity budgets, and simple
   authored readiness policy.
5. Add the content catalog while keeping explicit UI navigation declarations.
6. Generate PWA asset/cache inputs, add Android static-path parity, and run
   browser, service-worker, and APK contract tests.
7. Enable the repaired Comet slice only after production review and rights
   gates pass.

### Milestone 2 — Competing new-planet slices

Prototype one at a time; do not wait for whole-planet completion elsewhere.

1. **Case Cosmos development slice implemented:** one direct list of eighteen
   difficulty-ranked noun records, seven case forms and sentence pairs per
   noun, cumulative Explorer/Traveler/Navigator selection, and one
   matching-only interaction;
   qualified review, concept evidence, held-out transfer, and learner testing
   remain gated.
2. **Agreement Aurora development slice implemented:** one direct list of
   eighteen difficulty-ranked adjectives, three examples for every gender
   form, 162 masculine/feminine/neuter phrase pairs, cumulative
   Explorer/Traveler/Navigator selection, and one matching-only interaction;
   qualified review, transfer, and learner testing remain gated.
3. Do not create Clitic Orbit as a separate planet. Keep required `se` with its
   verb and teach contextual placement inside existing sentence or verb work.
4. Apply the same accessibility, usability, transfer, replay, ambiguity, and
   content-cost gates to each.
5. Promote only a mechanic with distinct learning ownership. Merge Case and
   Agreement if learners experience them as the same ending exercise.

### Milestone 3 — Thin interleaved Czech mission

If at least two slices pass, compile a 6–10-scene shared mission source into
separate game-local packs. Interleave only ready beginner concepts; do not
serialize full planets. Validate that context reuse lowers review cost without
confounding which capability an answer tests.

The initial random Campaign Mode route is not this milestone. Campaign Mode may
later host the guided mission, but only after the reviewed scheduler can choose
the next planet and exact ready challenge from evidence.

### Milestone 4 — Scale content and derivation selectively

Only measured demand or authoring cost justifies this milestone.

1. Promote genuinely shared facts into versioned Czech source modules.
2. Add deterministic compilers where they reduce measured cost and preserve
   naturalness.
3. Expand one approved planet in reviewed batches, with coverage and byte
   budgets.
4. Calibrate adaptive scheduling and delayed evidence before making mastery
   claims.
5. Re-evaluate the portfolio after every batch rather than funding all future
   orbits automatically.

### Future backlog — Sound and Spelling

No schema, audio acquisition, content production, or implementation work is
scheduled. Reconsider it only through the preconditions in section 9.

## 13. Pilot evaluation and decision gates

The numbers below are provisional defaults, not claims of statistical proof.
The owner may change them before Milestone -1 ends, but the final thresholds
must be frozen before seeing pilot results.

### 13.1 Facilitated usability and accessibility gate

Test the disposable slice with roughly 5–8 representative learners and the
actual phone/desktop access modes. Proceed only when:

- at least 80% can complete one mission without facilitator intervention;
- the primary learner decision can be explained in plain language;
- there are no critical keyboard, switch, screen-reader, touch, small-screen,
  reduced-motion, or Czech-input blockers;
- no known valid response is scored as fully wrong;
- error feedback identifies the target contrast and supports a recoverable
  retry.

If the gate fails, revise once and retest. A second failure forces a redesign,
merge, defer, or stop decision.

### 13.2 Learning, replay, and content-economics signal

If usability passes, run an opt-in signal pilot of roughly 15–30 learners. It
is too small for a broad efficacy claim, but it can reject an obviously weak
investment. Compare against the frozen current-game or pretest baseline and
measure:

- first-response accuracy on held-out lexemes or contexts;
- immediate and delayed transfer, never repeated challenge memorization;
- response time, hints, reveals, retries, and abandonment;
- voluntary next-mission starts and stated replay intent;
- challenged or ambiguous records and false-rejection reports;
- engineering hours, reviewer minutes per accepted record, rejection rate,
  disagreements, and revisions.

The default product signal is at least 60% voluntarily starting another
mission or reporting that they would replay. The minimum transfer improvement,
delay, maximum review cost, and maximum engineering cost must be derived from
the baseline and frozen in the pilot charter. Missing a frozen gate is not
permission to reinterpret the metric afterward.

### 13.3 Allowed decisions

Every pilot or expansion ends in one recorded decision:

- **proceed** — harden only the proven slice;
- **revise once** — address a bounded, testable failure;
- **merge** — combine overlapping mechanics or content ownership;
- **replace** — retain the learning objective but discard the interaction;
- **defer** — preserve the research without active investment;
- **stop** — retire the hypothesis and its speculative infrastructure.

## 14. Definition of done for any enabled planet

A language planet is ready to enable only when all of the following are true:

- its audience, learning, teaching, play, evidence, and out-of-scope contracts
  are written;
- its pilot passed the frozen usability, accessibility, transfer, replay, and
  content-economics gates;
- its manifest names the exact same-origin runtime JSON, schema files and
  hashes, course and target-language IDs, content version, bytes, count, and
  content digest;
- its runtime pack repeats and matches the game, course, language, version, and
  record envelope;
- every derived record traces to exact reviewed JSON inputs and a deterministic
  pinned generator, while a direct pack is itself the reviewed authority;
- stable IDs and revisions survive reordering and unrelated content additions;
- response spaces, normalization, scored spans, incidental-error handling,
  accepted realizations, and distractors are bounded and reviewed;
- production-required linguistic, pedagogical, variety, rights, and release
  approvals exist for the exact shipped hash;
- coverage reports expose missing concepts, levels, forms, and transfers;
- shared concept IDs resolve to the reviewed concept registry and stay within
  storage/signal budgets;
- first responses settle evidence exactly once;
- hints, reveals, and exposure cannot inflate mastery;
- progression uses prerequisites and evidence rather than random order alone;
- runtime failure is bounded and does not invent fallback content;
- keyboard, switch, touch, screen-reader, reduced-motion, Czech input, and
  mobile layouts work without drag-only or timed assessment;
- route, capability, presentation, content catalog, PWA asset/cache, and
  Android static-path parity is tested;
- learner feedback binds to exact content identity and corrections follow the
  revision policy;
- the complete implementation and its content validators run in the canonical
  Caatuu container workflow.

This definition intentionally makes a small, fully sourced and validated pilot
more valuable than a large bank whose challenge authority or learner value is
unclear.

## 15. Reference basis

The content schemas and qualified-review rubrics should be checked against
authoritative descriptions and research. These references constrain the
model; they do not replace record-level review.

### 15.1 Czech curriculum, variety, and grammar

- the official
  [Czech A1/A2 reference description](https://cestina-pro-cizince.cz/trvaly-pobyt/a1/wp-content/uploads/sites/2/2020/03/referencni_popis_08122016.pdf)
  for language-specific curriculum references rather than guessed CEFR tags;
- CzechEncy on
  [Standard Czech](https://www.czechency.org/slovnik/SPISOVN%C3%81%20%C4%8CE%C5%A0TINA)
  and [Common Czech](https://www.czechency.org/slovnik/OBECN%C3%81%20%C4%8CE%C5%A0TINA);

- CzechEncy on [future constructions](https://www.czechency.org/slovnik/FUTURUM)
  and [aspect](https://www.czechency.org/slovnik/VID);
- CzechEncy on [participles](https://www.czechency.org/slovnik/PARTICIPIUM),
  [auxiliaries](https://www.czechency.org/slovnik/AUXILI%C3%81R?bib=true), and
  [passive constructions](https://www.czechency.org/slovnik/PASIVUM);
- CzechEncy on [cardinal numerals](https://www.czechency.org/slovnik/Z%C3%81KLADN%C3%8D%20%C4%8C%C3%8DSLOVKA)
  and the Czech Language Institute on
  [predicate agreement with numerical subjects](https://prirucka.ujc.cas.cz/?id=602);
- CzechEncy on [agreement](https://www.czechency.org/slovnik/SHODA),
  [case](https://www.czechency.org/slovnik/P%C3%81D),
  [valency](https://www.czechency.org/slovnik/VALENCE), and
  [semantic roles](https://www.czechency.org/slovnik/S%C3%89MANTICK%C3%81%20ROLE);
- CzechEncy on [clitics](https://www.czechency.org/slovnik/KLITIKON) and
  [personal pronouns](https://www.czechency.org/slovnik/OSOBN%C3%8D%20Z%C3%81JMENO),
  plus [Czech word order](https://www.czechency.org/slovnik/SLOVOSLED);
- the Czech Language Institute on
  [preposition vocalization](https://prirucka.ujc.cas.cz/?id=770);
- CzechEncy on
  [Czech prosodic word structure](https://www.czechency.org/slovnik/P%C5%98%C3%8DZVUK)
  and the Czech Language Institute on the
  [sound-writing relationship of `i/í` and `y/ý`](https://prirucka.ujc.cas.cz/?id=148).

### 15.2 Cross-language representation and curriculum

- [Universal Dependencies features](https://universaldependencies.org/u/feat/all.html)
  provide reusable morphological labels and document Czech-specific examples,
  but do not replace Caatuu construction and pedagogy fields;
- the Council of Europe explains that
  [CEFR levels are can-do proficiency descriptors](https://www.coe.int/en/web/common-european-framework-reference%20languages/level-descriptions)
  and that language-specific Reference Level Descriptions provide detailed
  content specifications.

### 15.3 Learning-design evidence

- a meta-analysis of 122 experiments found that retrieval practice can support
  transfer, while also showing that transfer is weaker for some task changes:
  [Pan and Rickard (2018)](https://pubmed.ncbi.nlm.nih.gov/29733621/);
- experimental work shows that blocked and interleaved sequences serve
  different comparison needs, supporting the planned pattern-discovery then
  contrast/interleaving sequence:
  [Carvalho and Goldstone (2015)](https://pubmed.ncbi.nlm.nih.gov/24984923/) and
  [Birnbaum et al. (2013)](https://pubmed.ncbi.nlm.nih.gov/23138567/).

Every assessed prompt, accepted alternative, and explanation still needs the
manifest, rights, and review chain defined above. Product and learning gates
remain necessary because general research cannot validate Caatuu's specific
mechanic or audience in advance.
