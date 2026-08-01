# Caatuu multilingual curriculum contract

This component is the dependency-free executable authority for the rule:

> Every target language follows one canonical curriculum authored in English.

The canonical curriculum owns unit identity, order, prerequisites, outcomes,
ordered learning stages, English semantic definitions, function-specific
evidence demands, transfer dimensions, and mastery requirements. A
target-language realization pack supplies natural language, skills, scaffolding,
structured opportunities, and reviewed content without changing those
invariants.

## Contents

- `schemas/canonical-curriculum.schema.json`: structural contract for the shared curriculum.
- `schemas/target-realization-pack.schema.json`: structural contract for target packs.
- `schemas/target-pack-review-attestation.schema.json`: digest-bound native-teacher release approval.
- `data/canonical-curriculum.v1.en.json`: the three-unit English-authored pilot.
- `data/cs-CZ.realization-pack.v1.json`: a provisional Czech realization fixture.
- `data/pilot-content-sources.v1.json`: revisioned snapshots of the two real game items.
- `data/cs-CZ.cross-game-bindings.v1.json`: Word World and Verb Nebula bindings to one skill identity.
- `src/validate-conformance.mjs`: dependency-free structural, semantic, transfer, and cross-file validator.
- `src/cross-game-binding-core.mjs`: binding, task/evidence, and shared-skill reduction core.
- `runtime/curriculum-planner-core.mjs`: browser-safe canonical unit, stage,
  repair, delayed-retrieval, and unlock planner.
- `runtime/curriculum-service.mjs`: digest-pinned browser service with immutable
  opportunity and progression APIs.
- `test/fixtures`: mutation fixtures representing forbidden curriculum divergence.
- `test/*.test.mjs`: automated conformance, binding, tamper, and evidence tests.

The Czech text is a prototype fixture, not native-teacher-approved course
content. Development conformance means the inventory is internally coherent;
it is not a claim of Czech naturalness. Production validation requires all
records to be human approved, an externally trusted target-pack digest, and a
separate teacher attestation for that exact curriculum/pack pair. No approval
attestation is shipped for the provisional Czech fixture.

## Run

```powershell
npm test
npm run validate
npm run validate:bindings
npm run sync:runtime
```

`sync:runtime` copies the four validated JSON contracts and two browser-safe
runtime modules into the Czech static tree without changing their bytes. CI
uses `npm run check:runtime` to reject a stale generated copy.

Or call the validator directly:

```powershell
node src/validate-conformance.mjs `
  --curriculum data/canonical-curriculum.v1.en.json `
  --pack data/cs-CZ.realization-pack.v1.json
```

Release CI additionally supplies protected approval material rather than
letting the target pack approve itself:

```powershell
node src/validate-conformance.mjs `
  --curriculum data/canonical-curriculum.v1.en.json `
  --pack data/cs-CZ.realization-pack.v1.json `
  --expected-pack-digest sha256:<trusted-pack-digest> `
  --approval-attestation C:\trusted-approvals\cs-CZ.v1.attestation.json `
  --expected-attestation-digest sha256:<trusted-attestation-digest> `
  --require-human-approval
```

The attestation must identify a qualified native-language educator, pin both
exact digests and versions, and approve every checklist decision. It belongs in
a CI-controlled registry, which must verify the reviewer's identity and locale
qualification before pinning the attestation digest. Accepting an arbitrary
attestation or recomputing its trusted digest from the content bundle would not
establish independent approval.

This v1 attestation approves the target realization pack. A complete
application release still needs a bundle manifest that also pins source
catalogs, cross-game bindings, rendered media, and deployed assets; that is an
explicit integration gate, not something this pack-only validator claims.

The command exits `0` for a conforming pack and `1` for violations. Output is
JSON so CI and future content tooling can consume stable error codes.

The current three-unit integration pilot contains 43 English semantic
definitions, 20 Czech target
skills, 58 provisional utterances, and 48 structured contexts. Context counts
are computed from explicit skill-to-stimulus/response opportunities. A new ID,
description, or arbitrary label cannot manufacture transfer diversity.

## Canonical versus variable

Target packs must preserve:

- curriculum ID/version and contract digest;
- complete unit coverage and exact unit order;
- canonical unit revisions;
- prerequisite graph;
- can-do outcomes and semantic scope;
- required learning-stage order and per-function evidence mode;
- required context dimensions and minimum semantic variation;
- mastery policy.

Target packs may vary:

- utterances, forms, constructions, audio, and accepted variants;
- realization complexity and number of practice items;
- hints, explanations, media, and script support;
- valid game mechanics used to collect the canonical evidence.

Canonical fields are deliberately forbidden inside unit bindings. A language
pack references them; it cannot override them.

## What the two existing games can prove

The pilot binds Word World record `ww-cp-000146` (`Dědeček čte.`) and the
revision-pinned Verb Nebula source for `číst` to
`cs.skill.sense.cist.read@1`. Their events can aggregate under that stable
identity. Exposure, hints, reveals, duplicate events, stale revisions, and
context-free recognition are prevented from manufacturing mastery.

Both current mechanics are receptive. Sentence or grid presentation can emit
encounter exposure. A successful assessed response contributes bounded,
independent, non-mastery receptive evidence: Word World's English-token
reconstruction is comprehension of a Czech prompt, while Verb Nebula's visible
bilingual grid is discrimination represented as comprehension evidence. Neither
mechanic emits retrieval evidence, so they cannot complete Unit 3. The canonical
policy also requires retrieval, target-language production, transfer, spacing,
and context diversity. That limitation is intentional and executable.

The meanings of comprehension, discrimination, retrieval, and mastery
eligibility come from the canonical English backbone. This audited Czech
registry declares which category each concrete mechanic can honestly
demonstrate, and executable stage/evidence rules reject contradictory tuples.
The mechanic-to-category mapping still lives in the target registry; moving
that mapping into a shared English-owned mechanic contract is required before
additional languages can inherit these game classifications automatically.

The source seams, service-level cross-game flow, and one developer-only Guided
interaction in each game are implemented. On loopback with the explicit
`curriculum-guided=1` query, Word World presents the exact `čte` focus token and
assesses comprehension through an English-token reconstruction. Verb Nebula
presents the exact `číst` target in a visible bilingual association grid and
assesses discrimination before allowing contrast practice. Both games persist
presentation exposure before accepting the immutable assessed first response,
persist that response before feedback, keep hint/reveal support sticky, verify
the deployed source bytes, and leave ordinary Explore history and XP untouched.
The developer probe is a durable one-shot per binding and skill: refreshes and
concurrent tabs cannot manufacture a second clean attempt. Word World claims no
context until its presentation supplies a genuine setting/time cue. Verb
Nebula derives its contrast concepts from the canonical English Unit 3 order
and binds exact Czech dictionary rows for `eat`, `drink`, and `sleep`; task
fingerprints vary the deranged card positions.

Within each canonical unit, the English `functionIds`, `frameIds`, and
`conceptIds` arrays are normative ordered sequences. Target mappings and their
first-occurrence target-skill sequence must preserve that order in the
authoring validator, browser runtime, and planner. Issued encounter tasks
reserve the session's new-skill and semantic-concept load even if a task is
abandoned, so refresh cannot reset the introduction budget. Shared concepts
count once.

The planner also schedules legitimate consolidation retrievals when a mastery
threshold exceeds the number of retrieval stages. Unit 1's three-retrieval
threshold is schedulable as initial retrieval, consolidation retrieval, and
later-session delayed retrieval. Only evidence accepted in stage order can
contribute to planner mastery. Until target packs declare explicit construction
identities, each first target-skill encounter reserves one slot from
`maxNewTargetConstructionsPerSession`; exact multi-construction accounting
remains a required contract extension before learner release.

This is an integration probe, not a learner release. The profile still labels
the pack `prototype-not-human-approved`, release remains disabled, Unit 3
remains locked, and full Unit 1 Guided coverage plus native Czech educator
approval are still required.
