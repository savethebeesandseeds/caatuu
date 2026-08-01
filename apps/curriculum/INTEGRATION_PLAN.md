# Curriculum integration plan

This foundation is implemented on the isolated
`codex/curriculum-guided-mode` branch. The active application worktree remains
unchanged because it contains substantial uncommitted Word World and Verb
Nebula work. Reconcile that work deliberately before applying the final UI
wiring; do not copy, stash, or overwrite it implicitly.

Implemented here:

- canonical curriculum, Czech realization pack, and conformance validation;
- digest-pinned browser loading, offline caching, and Android asset auditing;
- exact source resolution for the reviewed Word World and Verb Nebula items;
- immutable tasks, first-response evidence, sticky hint/reveal state, and
  cross-game aggregation;
- a canonical planner that enforces unit order, stage order, repair spacing,
  delayed retrieval, and honest unlock blockers.

Still pending:

- calls from the current game UI into these seams;
- complete Unit 1 game coverage and learner-facing Guided navigation;
- native-teacher Czech approval and a protected release attestation.

## 1. First vertical slice

Integrate exactly one shared Czech skill and two source items:

| Contract | Value |
|---|---|
| Canonical unit | `unit.routine.familiar-actions.01@1` |
| Target skill | `cs.skill.sense.cist.read@1` |
| Word World content | `ww-cp-000146`: `Dědeček čte.` |
| Word World context | `cs.context.u3.read-library-current@1` |
| Verb stable sidecar ID | `cs.verb.cist.read@1` |
| Verb legacy locator | dictionary row 179 / `core-verb-179` |

The Word corpus and dictionary hashes are pinned in
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
skillSummary(targetSkillId)
progression()
nextRequest()
```

The planner issues an immutable, fingerprinted task. A game may render and score
only within the declared capability. It cannot substitute a skill, context,
content revision, learning stage, evidence kind, or mastery weight.

## 5. Word World seam

Relevant current locations:

- standard selection: `word-net.js:1395-1414`;
- selected record state: `word-net.js:1417-1455`;
- reconstruction submission: `word-net.js:1894-1923`;
- current semantic exposure emission: `word-net.js:3194-3231`.

Guided mode asks the curriculum service for the next task. Explore mode may keep
the current random and selected-word selectors.

For `ww-cp-000146`:

- sentence viewing emits exposure only;
- first-try, no-hint English reconstruction may emit bounded retrieval evidence;
- timed reveal emits exposure/support state and zero mastery;
- the current mechanic emits no Czech production or transfer evidence.

## 6. Verb Nebula seam

Relevant current locations:

- pair extraction: `verb-nebula-core.mjs:29-56`;
- round dealing: `verb-nebula-core.mjs:160-190`;
- reveal: `app.js:1788-1806`;
- response/evidence handling: `app.js:1810-1870`, `1900`, and `1920`.

Guided mode resolves `cs.verb.cist.read` to the pinned legacy row, then builds a
planner-approved contrast set. It must not select the entire eligible catalog.

- preview emits exposure;
- a first clean match may emit retrieval evidence;
- a hint or reveal makes the attempt supported;
- the binding has no context, so it cannot increase distinct-context mastery;
- the grid emits no production, interaction, or transfer evidence.

## 7. Evidence and repair rules

- Event identity is immutable and idempotent; reuse with changed payload is
  corruption.
- Every event is bound to the exact task fingerprint, registry, unit, skill,
  content revision, activity, mechanic, and optional context.
- Only the first clean response in an opportunity can qualify independently.
- A corrected response in the same opportunity is practice, not retrieval.
- Same-session repair must respect the canonical two-to-four intervening-task
  window; later-session clean retrieval may resolve the failure.
- Exposure, reveal, hint use, XP, and game completion never imply mastery.
- Full Unit 3 mastery remains false until production, transfer, spacing, context,
  retrieval, and failure-resolution requirements are all satisfied.

## 8. Integration sequence

1. **Complete:** copy the assets, browser-safe cores, and tests without changing
   game behavior.
2. **Complete:** add release pins to `course-profile.js` and validate all assets
   at startup.
3. **Complete:** resolve both real source items and prove snapshot/hash equality.
4. Wire one Word World task and its exposure/retrieval events into the current
   game UI.
5. Wire one Verb Nebula task and its exposure/retrieval/reveal events into the
   current game UI.
6. **Complete at the service boundary:** demonstrate one skill summary with
   contributions from both activity IDs and
   explicit mastery shortfalls.
7. **Complete at the planner boundary:** add repair scheduling and prove
   too-early retries do not resolve failure.
8. Add a genuine Czech-production task before enabling unit mastery or unlock.
9. Obtain native-teacher approval for every content record used in Guided mode,
   issue the exact digest-bound attestation, and prove that release validation
   rejects stale or mismatched attestations.

## 9. Do not do during this slice

- Do not bulk-convert the 760 Word World or 150 Verb Nebula items.
- Do not reinterpret legacy XP, rounds, or accuracy as learning mastery.
- Do not replace current IDs without a frozen source crosswalk.
- Do not use English gloss equality as target-skill identity.
- Do not count a renamed/cosmetic context as transfer.
- Do not mark provisional Czech content as human approved.
- Do not alter Memory Moon or animation work.
