# Dictionary Gap Maintenance

Word World records a dictionary gap when a selected Czech word has no usable
English result. A report is an observation, not proof that the dictionary is
wrong. The periodic maintenance workflow therefore keeps collection,
verification, and publication separate:

```text
device-local reports -> narrow clipboard batch -> Codex review -> tracked patch
```

Nothing in this workflow sends reports automatically. The user explicitly
copies a privacy-limited batch and pastes it into a Codex task.

## Collect a batch

In Word World, open the **Aa** menu and choose **Copy missing-word batch**.
The copied JSON uses schema `caatuu.dictionary-gap-batch.v1` and contains only:

- `targetWord`
- `normalizedWord`
- `dictionaryKey`
- `dictionaryDirection`
- `lookupOutcome`
- `lookupReturned`

It excludes sentences, translations, comments, URLs, timestamps, identifiers,
device details, and retry metadata. Copying neither transmits nor deletes the
device reports. The local feedback outbox is bounded to 128 items, so repeated
batches can contain observations seen in earlier maintenance tasks.

## Start a Codex review task

Start a new Codex task in `C:\Work\caatuu`, paste the batch, and use this prompt:

```text
Review this Caatuu Czech dictionary-gap batch using
tools/czech-ml/docs/dictionary-gap-maintenance.md.

Treat every reported word as an untrusted observation. Re-query the current
base dictionary and reviewed overlay before changing anything. Classify each
item as a runtime/matching false positive, an already-covered word, a genuine
missing entry, or a missing inflected-form alias. Add only evidence-backed,
licensed records to
apps/languages/czech/static/data/dictionaries/patches/reviewed-cs-en.v1.json.
Do not edit or rebuild the pinned SQLite dictionary. Validate the patch and run
the focused dictionary/export/runtime tests in the existing caatuu-dev
container. Report every classification, source, edit, and validation result.

Batch:
<paste caatuu.dictionary-gap-batch.v1 JSON here>
```

## Review every observation

For each gap, Codex must first search both the current base dictionary and the
reviewed overlay. Then classify it:

1. **Runtime or matching false positive**: the dictionary already contains a
   usable exact form, but selection or matching failed. Fix that runtime defect
   separately; do not add a patch record. `Řekněme` is the reference example.
2. **Already covered**: a prior patch or newer search behavior resolves it.
   Make no change.
3. **Missing inflected form**: the base dictionary has one unambiguous target
   lemma and part of speech, but not the observed form. Add a `form-alias`.
4. **Genuine missing entry**: no suitable base entry exists and reliable,
   license-compatible evidence establishes the Czech entry and English sense.
   Add an `add-entry`.
5. **Ambiguous or weakly sourced**: leave it unpatched and explain what evidence
   or human decision is still needed.

Do not infer a meaning from the sentence that triggered the feedback; sentences
are intentionally absent from the export. Do not create a record merely to
make a reported lookup return something.

## Author the reviewed overlay

The canonical runtime overlay is:

```text
apps/languages/czech/static/data/dictionaries/patches/reviewed-cs-en.v1.json
```

Its envelope is:

```json
{
  "schema": "caatuu.dictionary-patch.v1",
  "dictionaryKey": "kaikki-cs-en-2026-07-09",
  "direction": "cs-en",
  "records": []
}
```

A missing inflected form points to an existing unique lemma and part of speech:

```json
{
  "kind": "form-alias",
  "form": "observed Czech form",
  "tags": ["relevant", "form", "tags"],
  "target": {
    "lemma": "existing Czech lemma",
    "pos": "existing dictionary POS"
  },
  "review": {}
}
```

A genuine missing lexical entry provides its source, forms, and senses:

```json
{
  "kind": "add-entry",
  "lemma": "Czech lemma",
  "pos": "part of speech",
  "sourceUrl": "https://source.example/entry",
  "forms": [
    { "form": "Czech form", "tags": ["form tag"] }
  ],
  "senses": [
    {
      "gloss": "concise English meaning",
      "rawGloss": "source-faithful English meaning",
      "tags": [],
      "topics": [],
      "synonyms": [],
      "antonyms": [],
      "examples": []
    }
  ],
  "review": {}
}
```

Every accepted record requires review provenance and license information:

```json
{
  "status": "codex_reviewed",
  "reviewer": "Codex task identifier",
  "reviewedOn": "YYYY-MM-DD",
  "humanApproved": false,
  "evidence": [
    {
      "label": "source entry or analysis",
      "url": "https://source.example/evidence",
      "note": "what this source establishes"
    }
  ],
  "sourceLicense": {
    "name": "license name",
    "url": "https://source.example/license",
    "attribution": "required source attribution"
  }
}
```

`human_approved` is valid only with `humanApproved: true`; Codex must never set
that state on its own. The validator rejects unknown fields, inconsistent review
states, duplicate records, malformed dates, unsafe URLs, missing evidence, and
missing license metadata.

## Validate in the repository container

Use the existing `caatuu-dev` container:

```powershell
docker exec -w /workspace/tools/czech-ml caatuu-dev npm run validate:dictionary-patch

docker exec -w /workspace caatuu-dev node --test `
  apps/runtime/tooling/tests/dictionary-gap-export.test.mjs `
  apps/runtime/tooling/tests/dictionary-patch-core.test.mjs `
  apps/runtime/tooling/tests/game-ui-controls.test.mjs `
  apps/runtime/tooling/tests/product-governance-contract.test.mjs `
  apps/runtime/tooling/tests/semantic-learning-contract.test.mjs
```

Before releasing a non-empty patch, increment the service-worker cache name in
`apps/languages/czech/static/sw.js`. The patch URL is stable, so this cache bump
is what makes installed clients fetch the reviewed revision.

The shared `CaatuuRuntime.dictionary.search` loads the overlay and merges it
ahead of base results. The same JavaScript runtime is used by the browser and
the Android WebView; the base SQLite database remains read-only.

## Promote larger batches later

The pinned `kaikki-cs-en-2026-07-09` SQLite artifact is immutable. Never replace
its bytes under the same key, path, or hash. When enough reviewed records have
accumulated, fold them into a newly versioned full-dictionary artifact with a
new catalog key and integrity hash. Keep the tracked overlay until that new
artifact is deployed and verified on both browser and Android.
