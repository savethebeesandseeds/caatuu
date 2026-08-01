# Curriculum integration plan

The curriculum foundation and first developer Guided vertical slice are
implemented on the isolated `codex/curriculum-guided-mode` branch, rebased on
the current application mainline. The learner-facing release path remains
closed.

Implemented here:

- canonical curriculum, Czech realization pack, and conformance validation;
- digest-pinned browser loading, offline caching, and Android asset auditing;
- exact source resolution for the reviewed Word World and Verb Nebula items;
- immutable tasks, first-response evidence, sticky hint/reveal state, and
  cross-game aggregation;
- a canonical planner that enforces unit order, stage order, repair spacing,
  delayed retrieval, and honest unlock blockers;
- one exact, source-pinned developer Guided task in Word World and Verb Nebula;
- prompt presentation before exposure and assessed-task activation, evidence
  persistence before feedback or solution display, and isolation from Explore
  history/XP;
- byte-level integrity checks for the deployed Word World pack and Verb Nebula
  dictionary, including BOM mutation rejection;
- one-shot, cross-tab-safe developer claims that prevent refresh, hint, reveal,
  or concurrent-tab evidence laundering;
- canonical-scope Verb contrasts: the English Unit 3 concept order selects
  `eat`, `drink`, and `sleep`, while the Czech source catalog pins their exact
  reviewed dictionary realizations.

Still pending:

- complete Unit 1 game coverage and planner-driven learner Guided navigation;
- a genuine target-language production mechanic and the later evidence stages;
- native Czech educator approval and a protected release attestation;
- learner testing before any release or later-unit expansion.

## 1. First vertical slice

Integrate exactly one shared Czech skill and two source items:

| Contract | Value |
|---|---|
| Canonical unit | `unit.routine.familiar-actions.01@1` |
| Target skill | `cs.skill.sense.cist.read@1` |
| Word World content | `ww-cp-000146`: `Dědeček čte.`; focus token `čte`, index 1 |
| Word World context | none; the current UI does not present a setting or time-profile cue |
| Verb stable sidecar ID | `cs.verb.cist.read@1` |
| Verb legacy locator | dictionary row 179 / `core-verb-179` |

The Word corpus and dictionary byte hashes are pinned in
`data/pilot-content-sources.v1.json`. Resolve the legacy Verb locator only
inside that exact dictionary snapshot. A reorder or changed hash requires an
explicit source crosswalk update.

## 2. Runtime assets

Add generated runtime copies under:

```text
apps/languages/czech/static/data/curriculum/
  canonical-curriculum.v1.en.json
  cs-CZ.realization-pack.v1.json
  pilot-content-sources.v1.json
  cs-CZ.cross-game-bindings.v1.json
```

Add browser-safe builds of the conformance, binding, task, and evidence cores.
Load them after `runtime.js` and `semantic-learning.js`, and add every file to
the service-worker manifest.

## 3. Course-profile release lock

Extend the immutable course profile with references and externally trusted
digests, not copied curriculum content:

```js
curriculum: {
  id: "caatuu.shared-beginner",
  version: "1.0.0",
  specLocale: "en",
  canonicalManifestPath: "data/curriculum/canonical-curriculum.v1.en.json",
  realizationPackPath: "data/curriculum/cs-CZ.realization-pack.v1.json",
  sourceCatalogPath: "data/curriculum/pilot-content-sources.v1.json",
  bindingRegistryPath: "data/curriculum/cs-CZ.cross-game-bindings.v1.json",
  canonicalContractDigest: "sha256:...",
  targetPackDigest: "sha256:...",
  teacherReview: {
    checklistVersion: "caatuu-target-language-teacher-review-v1",
    attestationId: "attestation.cs-cz.<release>",
    attestedTargetPackDigest: "sha256:...",
    trustedAttestationDigest: "sha256:..."
  }
}
```

Startup must fail closed if conformance, revision pins, source digests, or
binding validation fail. Release CI must obtain the matching teacher
attestation from a protected approval registry and run the validator with
`--approval-attestation`, `--expected-pack-digest`, and
`--expected-attestation-digest`, and `--require-human-approval`. Registry
operators must verify reviewer identity, locale qualification, and revocation
status before pinning that digest. Do not treat an attestation copied beside the
pack, or a digest recomputed from it during the build, as its own trust root: a
JSON file cannot approve or repin itself.

Before a complete application release, add one reviewed release-bundle manifest
covering the source catalog, binding registry, rendered media, and exact
deployed assets. The pack attestation alone deliberately does not claim that
broader coverage.

## 4. Runtime API boundary

Expose one promise-based curriculum service:

```text
ready()
resolveBinding(activityId, stableContentId)
issueTask(bindingId, capabilityId, { targetSkillId })
beginOpportunity(activityId, stableContentId, { capabilityId, targetSkillId })
recordEvidence(task, outcome)
recordExposure(bindingId, { targetSkillId })
claimDeveloperPilot(bindingId, { targetSkillId, capabilityId, requirePresented })
skillSummary(targetSkillId)
progression()
nextRequest()
```

The planner issues an immutable, fingerprinted task. A game may render and score
only within the declared capability. It cannot substitute a skill, context,
content revision, learning stage, evidence kind, or mastery weight.

## 5. Word World seam

The developer slice is gated to loopback plus `curriculum-guided=1`. It resolves
the exact binding and `focusTarget`; it never calls a random or selected-word
fallback. Full learner Guided navigation will later consume planner requests.
Explore retains the existing random and selected-word selectors.

For `ww-cp-000146`:

- sentence viewing emits exposure only;
- first-try, no-hint English reconstruction may emit bounded independent
  comprehension evidence, explicitly ineligible for mastery;
- timed reveal records sticky solution-support state and zero mastery;
- the Czech sentence is painted before exposure is recorded and before the
  comprehension task is activated;
- the English reconstruction is built only after the task fingerprint exists;
- the curriculum focus remains visually distinct from a dictionary selection;
- the complete normalized source snapshot and exact NFC focus surface must
  match the rendered record before the task can start;
- an incorrect reconstruction marks solution support before the immutable
  first-response event is persisted and before the answer is rendered;
- the developer task writes no normal history, usage, XP, or semantic metrics;
- the binding is context-free because the current presentation supplies no
  honest setting or time-profile cue;
- the English answer bank tests understanding of the Czech sentence; it does
  not elicit Czech retrieval;
- the current mechanic emits no Czech retrieval, production, or transfer
  evidence.

## 6. Verb Nebula seam

Guided mode resolves `cs.verb.cist.read` plus exact Czech realizations of the
first three other concepts in the canonical English Unit 3 order (`eat`,
`drink`, `sleep`). It builds a deterministic four-pair set from those reviewed
references only. It does not use nearby dictionary rows, English-gloss identity,
the saved Explore queue, pair count, difficulty selector, or random deal.

- preview emits encounter exposure;
- a first clean match may emit bounded independent discrimination evidence,
  represented as comprehension evidence and explicitly ineligible for mastery;
- the canonical target must be answered before distractor feedback can create
  an answer-by-elimination path;
- a hint or reveal makes the attempt supported;
- source bytes are hashed before strict UTF-8 decode and locator validation;
- Czech and English card positions are deterministically varied from the
  immutable assessed-task fingerprint and remain positionally deranged;
- the developer task writes no normal XP, performance, or semantic metrics;
- the binding has no context, so it cannot increase distinct-context mastery;
- because both sides remain visible, the grid discriminates associations rather
  than eliciting recall;
- the grid emits no retrieval, production, interaction, or transfer evidence.

## 7. Evidence and repair rules

- Event identity is immutable and idempotent; reuse with changed payload is
  corruption.
- A durable per-binding developer claim is written before either task. Web
  Locks serialize cross-tab claims and ledger writes; a prior or interrupted
  claim blocks re-entry and any orphaned task is closed conservatively without
  qualifying for mastery.
- Every event is bound to the exact task fingerprint, registry, unit, skill,
  content revision, activity, mechanic, and optional context.
- Only the first clean response in an opportunity can qualify independently.
- A corrected response in the same opportunity is practice, not independent
  evidence.
- Same-session repair must respect the canonical two-to-four intervening-task
  window; a later-session clean assessment in the same learning stage may
  resolve the failure.
- Exposure, reveal, hint use, XP, and game completion never imply mastery.
- Full Unit 3 mastery remains false until production, transfer, spacing, context,
  retrieval, and failure-resolution requirements are all satisfied.

## 8. Integration sequence

1. **Complete:** copy the assets, browser-safe cores, and tests without changing
   game behavior.
2. **Complete:** add release pins to `course-profile.js` and validate all assets
   at startup.
3. **Complete:** resolve both real source items and prove snapshot/hash equality.
4. **Complete for the developer slice:** wire one Word World task and its
   exposure/comprehension events into the current game UI.
5. **Complete for the developer slice:** wire one Verb Nebula task and its
   exposure/discrimination/reveal events into the current game UI.
6. **Complete at the service boundary:** demonstrate assessed attempts from
   both activities while leaving mastery-contributing activity IDs empty and
   reporting explicit mastery shortfalls.
7. **Complete at the planner boundary:** add repair scheduling and prove
   too-early retries do not resolve failure.
8. Add a genuine Czech-production task before enabling unit mastery or unlock.
9. Obtain native-teacher approval for every content record used in Guided mode,
   issue the exact digest-bound attestation, and prove that release validation
   rejects stale or mismatched attestations.
10. Expand the same verified interaction contract across Unit 1, run a learner
    pilot, then validate the English backbone with a second target language
    before expanding Units 2–3.

## 9. Do not do during this slice

- Do not bulk-convert the 760 Word World or 150 Verb Nebula items.
- Do not reinterpret legacy XP, rounds, or accuracy as learning mastery.
- Do not replace current IDs without a frozen source crosswalk.
- Do not use English gloss equality as target-skill identity.
- Do not count a renamed/cosmetic context as transfer.
- Do not mark provisional Czech content as human approved.
- Do not alter Memory Moon or animation work.
