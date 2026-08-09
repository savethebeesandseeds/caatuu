# Language Games and Czech Planet Plan

Status: product and implementation plan

This document defines the planned Czech language-game constellation, the
content authority required for every game, and the implementation order for
the missing planets. In the product, a language game is presented as a planet;
the terms are interchangeable here.

The immediate product decisions are:

- **Conjugation Comet remains an optional conjugation game.** A language
  enables it only when verb-form changes are an important learnable system.
- Czech has four additional game hypotheses: **Case Cosmos**, **Agreement
  Aurora**, **Clitic Orbit**, and a future **Sound and Spelling planet**. The
  first three are working titles and candidate mechanics, not authorization to
  build three complete products in parallel.
- The Sound and Spelling planet is explicitly future work. It must not delay
  the morphology and sentence-structure games.
- Every enabled game must resolve all assessed challenges from reviewed JSON.
  A game may own that JSON directly or deterministically derive a frozen game
  JSON file from explicitly named general-language JSON sources.
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
| Memory Moon | Placeholder | Recall weak material selected from all active planets |
| Case Cosmos | Candidate pilot; data feasibility first | Choose a licensed Czech construction from a situation and governor, then form its head noun |
| Agreement Aurora | Candidate pilot | Realize a dependent or predicate form licensed by an agreement construction |
| Clitic Orbit | Candidate pilot | Place Czech clitics in bounded, contextually licensed sentence structures |
| Sound and Spelling planet | Future backlog | Connect Czech sound, vowel length, diacritics, and spelling |

Memory Moon is a review surface, not another grammar authority. It should draw
stable challenge references and weak concept references from the other games;
it must not maintain independent copies of their Czech answers.

While Memory Moon remains a non-assessing placeholder, it is exempt from the
enabled-game content-manifest gate. Before it becomes an active review game,
it needs a reviewed policy/configuration JSON and a manifest for that config;
its session queue may then be derived locally from progress and exact
`gameId`, challenge ID, and revision references.

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
| Conjugation Comet | Directly authored 6–8-verb pilot pack first; only later derive from reviewed verb and lesson sources | `conjugation-comet/manifest.json` to a versioned `challenges.json` |
| Case Cosmos | Directly authored bounded pilot first; later shared reviewed paradigms, government records, lesson plan, and contexts | `case-cosmos/manifest.json` to a versioned `challenges.json` |
| Agreement Aurora | Directly authored bounded pilot first; later reviewed morphology plus allowed construction groups and contexts | `agreement-aurora/manifest.json` to a versioned `challenges.json` |
| Clitic Orbit | Direct reviewed challenge pack initially; if `constructions.json` is later compiled into different records, the manifest mode becomes `derived` | `clitic-orbit/manifest.json` to a versioned `challenges.json` |
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

### 3.6 Stable record identity

Every source entity, compiled challenge, and shared evidence concept needs an
explicit stable ID and positive revision. Array position must never be
identity.

Required common challenge fields are:

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
Agreement or Clitic lesson may become ready while most of Case Cosmos remains
unseen, provided the exact required forms are supplied or already evidenced.
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

The repaired pilot teaches one productive single-word nonpast pattern with
6–8 reviewed verbs, person and number, one prediction mechanic, one controlled
production mechanic, and one held-out transfer. Cap the initial scored bank at
roughly 24–48 records instead of materializing every possible combination.
Aspect, past, future,
conditional, imperative, register contrasts, and voice are later campaigns
that require separate evidence.

It should not absorb noun declension or general noun-phrase agreement. Those
belong to Case Cosmos and Agreement Aurora.

### 5.2 What is missing now

The current game has a useful two-stage round—meaning followed by six
person/number matches—but it lacks the structures needed to teach a system:

- stable verb and form IDs are not explicit; runtime IDs currently depend on
  array order;
- there is no content manifest or content version in saved progress;
- `pattern` mixes productive classes, endings, and individual irregular forms;
- semantic family and conjugation family are not distinct concepts;
- aspect, notes, motion class, government, and accepted variants are mostly
  invisible to the learner;
- difficulty only filters a random cumulative pool;
- the same six-cell recognition task is used for every verb;
- the meaning gate duplicates Verb Nebula even when meaning is already known;
- hints do not explain the current rule or contrast;
- progress is aggregated instead of stored per verb, feature, and skill;
- there is no production or transfer test;
- contract tests check structural completeness but not the complete
  linguistic relationship among aspect, tense, form, cue, and variant.

### 5.3 Content authority

The safe migration path is:

1. freeze the current Comet as the measured baseline;
2. select and fully audit only 6–8 current verbs in one productive family;
3. directly author a versioned pilot `challenges.json` with stable IDs,
   revisions, response policies, concepts, explanations, and review receipts;
4. add `manifest.json` declaring the pilot pack, schema paths and hashes,
   counts, bytes, coverage, rights, and review state;
5. run the pilot before normalizing all 59 legacy verbs or building a general
   grammar catalog;
6. if the mechanic passes, migrate the remaining data in reviewed batches and
   decide whether a `verbs.json` + `lesson-plan.json` compiler reduces measured
   cost;
7. promote genuinely shared verb facts only when another proven consumer
   needs the same authority.

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

The pilot fantasy is to stabilize one comet by discovering its form pattern,
predicting a missing form, and restoring a final communication signal. One
mission lasts three to five minutes and ends with a held-out verb or context.

Prototype two cheap versions of the primary interaction before choosing one:

- a compact orbit board that contrasts stem and ending; and
- a keyboard/touch-accessible form assembly interaction.

Both must show a worked example, ask one primary decision per turn, explain the
specific contrast after an error, offer a recoverable retry, and end with
controlled production. Choose on observed comprehension, transfer, access,
and replay—not visual preference alone.

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
- Supply or lock reflexive/clitic placement unless Clitic Orbit is explicitly
  the primary concept in a later composite mission.
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

1. Capture a consented baseline from the current Comet and freeze the test
   tasks used for comparison.
2. Choose one productive pattern and audit only 6–8 verbs plus held-out items.
3. Directly author and validate the pilot manifest and challenge pack.
4. Prototype the two primary interaction candidates with the pilot JSON.
5. Run accessibility and facilitated usability tests before visual polish.
6. Run the held-out learning and replay pilot if usability passes.
7. Extract only the loader, lifecycle, and evidence pieces demonstrated by the
   winning slice.
8. Decide proceed, revise, merge, or stop before auditing the other 51+ verbs.
9. If proceeding, migrate legacy records in reviewed batches, then evaluate a
   deterministic compiler and coverage report.
10. Add aspect/future, past/agreement, intent, and adaptive selection only
    through separately gated expansions.

## 6. Case Cosmos

Status: candidate new-game pilot; not approved for full production

### 6.1 Learning contract

Case Cosmos owns two related but separately evidenced capabilities: choosing a
reviewed Czech construction from a situation plus governor, and realizing the
head noun in the case licensed by that construction.

It must teach why a case is used, not merely ask learners to memorize seven
rows of endings.

### 6.2 Core game loop

```text
see a communicative situation
        ↓
identify the exact governing expression or construction
        ↓
choose the licensed construction
        ↓
in a separate turn, form the head noun
        ↓
after atomic evidence, complete a composite transfer mission
```

Example:

```text
Situation: I am going into the hotel.
Relationship: destination/interior
Construction: do + genitive
Lexeme: hotel
Answer: Jdu do hotelu.
```

The pilot play hypothesis is a short navigation mission: route a traveler or
object by choosing the Czech construction that fits the scene, then repair one
target noun form to complete the route. The situation, governor, and familiar
vocabulary stay visible. The mission must not make one wrong composite answer
look like proof of both a case-choice and declension failure.

### 6.3 Content authority

The first pilot is a directly authored pack covering only two or three
high-value contrasts, 8–12 familiar nouns, singular forms, and held-out
transfer. The repository does not yet contain a reviewed Czech paradigm and
government authority, so that data feasibility is a gate, not an assumed
dependency.

If the pilot passes, a later derived pack may use:

- a general Czech lexeme/paradigm JSON module;
- a general reviewed government JSON module for prepositions and verbs;
- a game-owned `lesson-plan.json` defining which uses and contrasts are
  pedagogically ready;
- game-owned reviewed context templates where naturalness cannot be inferred.

Its manifest-declared `challenges.json` remains the only runtime challenge
source in either mode.

Each compiled record needs:

- stable challenge, lexeme, paradigm, construction, and context references;
- target case, number, gender, and masculine animacy when relevant;
- semantic role plus the exact governing verb sense or preposition
  construction; a semantic role alone may not select the preposition;
- compatible lexeme and sense IDs for every generated phrase;
- the reviewed preposition realization, including conditioned or accepted
  allomorphs such as `v/ve`, `k/ke`, `s/se`, and `z/ze`;
- canonical Czech phrase and accepted variants;
- a complete reviewed sentence and aligned English meaning;
- distractors plus the exact misconception each distractor represents;
- explanation of both the case choice and the surface formation;
- difficulty, prerequisites, assessed concepts, provenance, and review state.

### 6.4 Learning sequence

#### Stage 1 — Roles before endings

- pilot: accusative with familiar direct-object governors;
- pilot: one or two reviewed location/destination construction contrasts;
- singular head nouns only, with non-target agreement supplied or locked;
- always present the governor or construction; never teach a shortcut such as
  “motion means accusative.”

#### Stage 2 — High-value government

- dative recipients and common dative verbs;
- instrumental accompaniment with `s`;
- locative after `v`, `na`, and `o`;
- paired prepositions whose case changes meaning, such as location versus
  direction;
- reviewed selection among `v/na`, `do/na`, and their vocalized surface forms
  instead of predicting them from an English relation label.

#### Stage 3 — Paradigm transfer

- hard and soft noun patterns across all three genders;
- masculine animate accusative;
- plural case forms;
- common stem and spelling alternations;
- syncretic forms that represent more than one case.

#### Stage 4 — Richer frames

- verb-specific government;
- multiword noun phrases;
- strong, clitic, and prepositional pronoun forms only after a shared reviewed
  pronoun/clitic realization source exists; they are not interchangeable case
  variants;
- vocative address;
- less transparent prepositional and idiomatic frames.

### 6.5 Challenge types

- situation-to-role selection;
- situation-and-governor-to-construction selection;
- reviewed preposition-and-case construction selection;
- lemma-to-case-form completion;
- correct phrase selection;
- case error diagnosis and repair;
- sentence completion;
- new-lexeme transfer within a known paradigm.

### 6.6 Learning evidence

Record separate observations for:

- choosing the correct construction from the situation and governor; and
- producing the licensed head-noun form on more than one lexeme.

A learner who memorizes `do hotelu` has evidence for that phrase, not yet for
the genitive destination construction. Transfer evidence must use a different
reviewed noun of a known pattern.

### 6.7 Implementation steps

1. Decide and document the paradigm/government source, rights, variety policy,
   and qualified Czech review owner.
2. Create a small reviewed data sample and measure review throughput before UI
   work.
3. Directly author the capped pilot manifest and challenge pack.
4. Prototype the separate construction-choice and head-form interactions.
5. Add misconception-aware distractors and explanations, with one primary
   concept per ordinary challenge.
6. Run accessibility, usability, held-out transfer, replay, and content-cost
   gates.
7. Decide proceed, revise, merge with Agreement, or stop.
8. Only after a pass, define shared paradigm/government modules and evaluate a
   deterministic compiler.
9. Add dative and instrumental uses, then plural and stem alternations through
   separately reviewed expansions.

## 7. Agreement Aurora

Status: candidate new-game pilot; requires only the exact case concepts it uses

### 7.1 Learning contract

Agreement Aurora teaches the learner to realize the dependent or predicate
form licensed by a reviewed Czech agreement construction.

Case Cosmos owns construction/case choice and the head noun. Agreement Aurora
receives the case or construction as given and owns dependent or predicate
agreement. It must not re-assess case choice accidentally.

### 7.2 Core game loop

```text
receive a controller noun and context
        ↓
read its morphosyntactic and referential features
        ↓
supply the licensed adjective, determiner, pronoun, or predicate form
        ↓
assemble or repair the complete Czech phrase
```

Examples include:

- `nový dům`, `nová kniha`, `nové město`;
- `vidím nového studenta`;
- `mluvím s novou kolegyní`;
- `muži byli unavení`, `ženy byly unavené`.

The pilot play hypothesis is to stabilize an aurora by aligning one dependent
word with a visible controller. A short mission demonstrates one contrast,
then asks the learner to select or repair one ending before a held-out familiar
noun. The pilot is limited to nominative adjective+noun gender across three
genders; it does not include case transformation, plural, animacy, predicates,
pronouns, or numerals.

### 7.3 Content authority

The first pilot is a directly authored finite pack. If it passes, later packs
may be derived from:

- reviewed noun, adjective, pronoun, determiner, numeral, and participle
  paradigms in the general Czech grammar catalog;
- stable case-use references from the Case Cosmos sources;
- a game-owned `lesson-plan.json` defining allowed feature combinations;
- reviewed phrase and sentence contexts.

The build must compile and validate finite challenge records. The browser must
not generate arbitrary combinations from paradigm tables. Cardinal numeral
constructions are a separate quantification/government subtype, not ordinary
feature-copying agreement.

Each record needs:

- `controllerExpressionRefs[]` and separate morphosyntactic and referential
  features;
- dependent identities, `agreementRuleId`, governed features, and any
  `resolutionRule`;
- for numeral records, the numeral class, governed noun form, oblique-case
  behavior, and predicate-agreement rule instead of a copied-feature fiction;
- canonical phrase or predicate;
- accepted variants and their register or discourse constraints;
- controlled distractors that each violate one declared feature;
- explanation identifying the agreement controller and mismatched feature;
- source references, prerequisites, concepts, provenance, and review state.

### 7.4 Learning sequence

#### Stage 1 — Gender in simple noun phrases

- pilot: one common hard-adjective pattern with highly familiar masculine,
  feminine, and neuter singular nouns;
- later in this stage: soft adjectives and demonstratives.

#### Stage 2 — Case and number

- carry a known case across noun-phrase dependents;
- singular versus plural;
- adjective and possessive-pronoun agreement in reviewed phrases; possessive
  adjectives such as `otcův` and `matčin` require a later model of possessor
  features;
- constrain the pilot to feature combinations whose answer is not changed by
  an animacy distinction that has not yet been taught.

#### Stage 3 — Animacy and predicate agreement

- masculine animate contrasts;
- plural agreement classes;
- past participles and predicate adjectives;
- formal singular `vy` where auxiliary number and participle agreement differ.

Formal singular `Vy jste přišel/přišla` must keep the auxiliary's plural
person/number separate from the participle's singular referential gender and
number. It is not a simple copied controller bundle.

#### Stage 4 — Pronouns and numerals

- adjective-like pronouns;
- ordinal numerals;
- selected high-value cardinal-number constructions as their own subtype;
- for five and above, teach genitive-plural government in nominative and
  accusative counted phrases, its predicate consequences, and the different
  behavior of oblique cases from reviewed records;
- advanced or exceptional agreement only after the ordinary system is stable.

This entire stage is expansion work, not part of the initial planet decision.
Quantified and coordinated subjects use reviewed government or resolution
rules; they must not be generated by copying noun features.

### 7.5 Challenge types

- synchronize one missing ending;
- select the matching dependent;
- find the word that breaks agreement;
- repair a phrase;
- transform a whole phrase to a new case or number;
- complete predicate agreement from a reviewed subject;
- transfer a known rule to a new noun.

### 7.6 Learning evidence

Evidence should identify the feature actually tested. A correct feminine
nominative adjective does not prove accusative agreement, and a memorized
phrase does not prove gender transfer.

Agreement Aurora and Conjugation Comet may both contribute evidence for Czech
past-participle agreement, but their item familiarity and primary skill signals
remain separate.

### 7.7 Implementation steps

1. Reuse only stable feature identities already proven by the Comet or Case
   pilots; do not wait for either whole planet.
2. Directly author and review the capped three-gender nominative pack.
3. Prototype selection and repair interactions with single-feature
   distractors and an exactly-one-target-error invariant.
4. Run the same accessibility, usability, held-out transfer, replay, and
   content-cost gates.
5. Decide whether the player decision feels distinct from Case Cosmos. Merge
   the mechanics into one morphology planet if learners experience both as the
   same ending exercise.
6. If proceeding, introduce case/number, animacy, and predicate agreement by
   concept prerequisite rather than planet completion.
7. Add pronoun and numeral modules only with dedicated reviewed construction
   coverage.

## 8. Clitic Orbit

Status: candidate new-game pilot; requires only the exact forms it manipulates

### 8.1 Learning contract

Clitic Orbit's initial territory is bounded Czech clitic placement and cluster
order. General topic/focus word order is a later or separate evidence family.
The game teaches canonical post-initial placement plus explicitly reviewed
contact or context-bound variants; it must not encode all Czech clitics as
occupying one invariant mechanical slot.

Long-term coverage may include:

- `se` and `si`;
- past auxiliaries `jsem`, `jsi`, `jsme`, and `jste`;
- conditional forms such as `bych` and `bys`;
- short pronouns such as `mi`, `ti`, `mu`, `mě`, `tě`, and `ho`;
- ordering inside a multi-clitic cluster;
- omitted subject pronouns;
- neutral versus contextually marked word order.

The pilot contains 12–20 directly authored sentences for one reviewed function
of `se`, immutable grouped constituents, canonical post-initial placement, and
held-out sentences. Every non-target form is already inflected and locked, so
the pilot does not depend on completing another planet.

### 8.2 Core game loop

```text
receive a discourse context and reviewed Czech components
        ↓
choose the first constituent or intended emphasis
        ↓
apply the record's licensed placement and host strategy
        ↓
order the cluster internally
        ↓
compare the neutral answer with other context-bound possibilities
```

Example contrast:

```text
Můj bratr se tam setkal s Evou.
S Evou se tam setkal můj bratr.
Tam se můj bratr setkal s Evou.
```

The context must state which answer is neutral or intended. Czech word-order
flexibility makes an unexplained single-answer scramble pedagogically unsafe.

The pilot play hypothesis is to restore a disrupted communication orbit by
placing one clitic-bearing group relative to a visible first constituent. It
uses select/move controls rather than drag-only interaction, explains the
licensed host after an error, and ends with a new reviewed sentence. It does
not ask learners to discover all grammatical Czech permutations.

### 8.3 Content authority

Clitic Orbit should use a directly authored pilot `challenges.json` containing
complete reviewed sentences, discourse context, constituent boundaries,
clitic identity and function, placement strategy, neutral order, and accepted
grouped arrangements. If a later `constructions.json` is compiled into
different runtime records, the manifest authority mode is `derived`.

It may later derive bounded challenges from reviewed Word World sentences or a
general Czech constructions module only when the manifest pins exact source
record IDs and revisions. Morphology alone cannot authorize Czech word order.

Each record needs:

- discourse context and communicative intention;
- canonical Czech sentence and aligned English meaning;
- constituent tokens or groups, not just whitespace-split words;
- clitic members and their lexical, reflexive, reciprocal, argumental,
  passive-like, auxiliary, or pronominal functions as applicable;
- internal ordering, placement strategy, prosodic or syntactic host, and
  whether canonical post-initial, contact-position, or another reviewed
  context-bound realization is being taught;
- neutral order plus accepted marked alternatives and their interpretations;
- specifically rejected orders with explanations;
- prerequisites, assessed concepts, difficulty, provenance, and review state.

The data model must also support underlying clitic identities, surface
segments, fusion rules, and zero realization. Czech combinations such as
`jsi + se → ses` and third-person past with no expressed auxiliary cannot be
represented reliably as whitespace-token permutations. A later shared
pronoun/clitic source must distinguish strong, clitic, and prepositional forms
and state focus, coordination, and preposition licensing.

### 8.4 Learning sequence

#### Stage 1 — One reflexive clitic

- one reviewed function of `se` or `si` after a simple initial constituent;
- canonical post-initial placement before introducing licensed variants;
- sentence-initial verb or adverb contrasts;
- only the subject realization fixed by the reviewed pilot context.

#### Stage 2 — Auxiliary and pronoun clitics

- present lexical verb versus past auxiliary;
- one short object or recipient pronoun;
- stable two-member clusters.

#### Stage 3 — Conditional and larger clusters

- conditional auxiliaries;
- reflexive plus dative or accusative pronouns;
- internal cluster order;
- formal address and reviewed multi-clause boundaries.

#### Stage 4 — Information structure

Status: future expansion or separate mechanic

- choose the first constituent from discourse;
- compare neutral, topicalized, and contrastive orders;
- compare canonical post-initial placement with reviewed contact or
  context-bound variants only where the construction source licenses them;
- repair sentences that are morphologically correct but pragmatically wrong
  for the stated context.

### 8.5 Challenge types

- place one clitic;
- order a clitic cluster;
- assemble grouped constituents;
- choose the neutral sentence for a context;
- identify a contextually marked alternative;
- choose null versus overt subject for one reviewed discourse intention;
- diagnose and repair a word-order error.

### 8.6 Learning evidence

Transfer requires new sentences, not repeated permutations of one memorized
sentence. Evidence should distinguish:

- second-position placement;
- internal cluster order;
- reflexive identity;
- auxiliary placement;
- pronoun omission;
- discourse-sensitive ordering.

### 8.7 Implementation steps

1. Choose one `se` function and define bounded grouped-response authoring rules.
2. Directly author and qualified-review the 12–20-sentence pilot pack.
3. Implement group-aware select/move assembly without naive whitespace
   parsing or full-sentence free-text scoring.
4. Add explanations for the intended placement without declaring every other
   Czech order ungrammatical.
5. Run accessibility, usability, held-out transfer, replay, ambiguity, and
   review-cost gates independently of whole-planet prerequisites.
6. Decide proceed, revise, or stop before modeling fusions, auxiliaries, and
   short-pronoun clusters.
7. Add conditional material only after the construction model is proven.
8. Keep general information structure deferred until its much larger discourse
   and review burden has a separate product case.

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
      manifest.json
      <content-version>/challenges.json
    case-cosmos/
      manifest.json
      <content-version>/challenges.json
    agreement-aurora/
      manifest.json
      <content-version>/challenges.json
    clitic-orbit/
      manifest.json
      <content-version>/challenges.json
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
6. Produce the Comet pilot's 6–8-verb direct JSON pack and two cheap mechanic
   prototypes.
7. Stop if the content cannot be reviewed affordably or neither mechanic has
   a clear primary learner decision.

### Milestone 0 — Minimum pilot spine and Comet vertical slice

1. Define only the manifest, pack envelope, game-specific record schema,
   stable ID/revision, response policy, source reference, and review receipt
   needed by the selected Comet slice.
2. Inventory `verb-exercise-family-core.mjs` and reuse its verified lifecycle
   behavior rather than designing a parallel settlement system.
3. Implement a developer-only, fail-closed loader and first-response event.
4. Build the three-to-five-minute pattern-discovery, controlled-production,
   and held-out-transfer mission.
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

1. Case Cosmos: two or three contrasts, 8–12 nouns, singular, separate
   construction-choice and head-form decisions.
2. Agreement Aurora: nominative adjective+noun gender across three genders.
3. Clitic Orbit: 12–20 reviewed sentences for one `se` function and canonical
   post-initial placement.
4. Apply the same accessibility, usability, transfer, replay, ambiguity, and
   content-cost gates to each.
5. Promote only a mechanic with distinct learning ownership. Merge Case and
   Agreement if learners experience them as the same ending exercise.

### Milestone 3 — Thin interleaved Czech mission

If at least two slices pass, compile a 6–10-scene shared mission source into
separate game-local packs. Interleave only ready beginner concepts; do not
serialize full planets. Validate that context reuse lowers review cost without
confounding which capability an answer tests.

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
