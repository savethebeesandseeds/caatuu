# Dictionary Gap Maintenance

Word World records a dictionary gap when a selected Czech word has no usable
English result. A report is an observation, not proof that the dictionary is
wrong. The periodic maintenance workflow therefore keeps collection,
verification, and publication separate:

```text
dedicated device outbox
  -> POST /cz/api/dictionary/gaps
  -> private server ledger
  -> periodic Codex review
  -> tracked reviewed patch
```

Dictionary gaps are sent automatically when the server is reachable. This
narrow channel is independent of general Word World sentence feedback, whose
sender remains device-local and disabled. There is no clipboard export, in-app
batch tool, or public route for reading the server ledger.

## Collection and server storage

The client first persists each observation in the dedicated
`caatuu.dictionaryGapOutbox.v1` outbox, which is bounded to 128 pending items.
It then retries delivery when the app is visible and the server is available.
An item is removed from the device only after the endpoint returns a positive
`{"ok":true,"stored":true}` acknowledgement. Network failures, server errors,
and interrupted requests leave it queued for a later retry.

Each `caatuu.dictionary-gap-report.v1` request carries exactly these six
observation fields, in addition to the schema discriminator:

- `targetWord`
- `normalizedWord`
- `dictionaryKey`
- `dictionaryDirection`
- `lookupOutcome`
- `lookupReturned`

It excludes sentences, translations, comments, URLs, client timestamps,
identifiers, device details, and retry metadata. The POST endpoint validates
that strict shape and the pinned Czech-English dictionary identity before
writing it.

The runtime stores accepted observations at:

```text
artifacts/dictionary-gaps/czech-missing-words.v1.json
```

Compose mounts that ignored host directory at
`/var/lib/caatuu/dictionary-gaps` and sets `DICTIONARY_GAP_STORE_PATH` to the
file above inside the container. The server publishes the ledger atomically,
deduplicates by dictionary key, direction, and normalized word, and updates a
duplicate observation instead of appending another record. It adds
`firstSeenAtUnixMs` and `lastSeenAtUnixMs` to each record and
`updatedAtUnixMs` to the ledger. Those timestamps describe receipt by the
server; they are not lexical evidence.

`POST /cz/api/dictionary/gaps` is a write-only maintenance boundary. There is
no public GET endpoint. The server file is retained until a maintainer reviews,
archives, or removes entries; automatic expiry is not currently implemented.
Do not expose the ledger through a browser control or reuse it for general
diagnostics.

## Start a Codex review task

Start a new Codex task in `C:\Work\caatuu` and use this prompt:

```text
Review the Caatuu Czech dictionary-gap ledger at
artifacts/dictionary-gaps/czech-missing-words.v1.json using
tools/czech-ml/docs/dictionary-gap-maintenance.md.

Treat every ledger record as an untrusted observation. The server timestamps
show only when the report was received and are not evidence for a meaning.
Re-query the current base dictionary and reviewed overlay before changing
anything. Classify each item as a runtime/matching false positive, an
already-covered word, a genuine missing entry, a missing inflected-form alias,
or unresolved. Add only evidence-backed, license-compatible records to
apps/languages/czech/static/data/dictionaries/patches/reviewed-cs-en.v1.json.
Do not edit or rebuild the pinned SQLite dictionary. Validate the patch and run
the focused dictionary/report/runtime tests in the existing caatuu-dev
container. Report every classification, source, edit, and validation result.
Do not delete or rewrite the server ledger unless I explicitly ask for a
separate archive or retention operation.
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
   entry, but not the observed form. Record its pinned entry ID, lemma, and part
   of speech in a `form-alias`.
4. **Genuine missing entry**: no suitable base entry exists and reliable,
   license-compatible evidence establishes the Czech entry and English sense.
   Add an `add-entry`.
5. **Ambiguous or weakly sourced**: leave it unpatched and explain what evidence
   or human decision is still needed.

Do not infer a meaning from the sentence that triggered the feedback; sentences
are intentionally absent from the report and ledger. Do not create a record
merely to make a reported lookup return something.

## Author the reviewed overlay

The canonical runtime overlay is:

```text
apps/languages/czech/static/data/dictionaries/patches/reviewed-cs-en.v1.json
```

Its envelope is:

```json
{
  "schema": "caatuu.dictionary-patch.v1",
  "revision": 1,
  "digest": "sha256-<computed from every field except digest>",
  "dictionaryKey": "kaikki-cs-en-2026-07-09",
  "direction": "cs-en",
  "records": []
}
```

A missing inflected form points to one exact entry in the pinned base pack. The
entry ID prevents a homonymous lemma and part of speech from receiving the alias:

```json
{
  "kind": "form-alias",
  "form": "observed Czech form",
  "tags": ["relevant", "form", "tags"],
  "target": {
    "entryId": 12345,
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
missing license metadata. It also rejects aliases without a positive pinned
entry ID and conflicting records that send one observed form to several base
entries, including accent-folded variants with the same search normalization.

## Validate in the repository container

Use the existing `caatuu-dev` container:

```powershell
docker exec -w /workspace/tools/czech-ml caatuu-dev npm run validate:dictionary-patch

docker exec -w /workspace caatuu-dev node --disable-warning=ExperimentalWarning --test `
  apps/runtime/tooling/tests/dictionary-gap-report.test.mjs `
  apps/runtime/tooling/tests/dictionary-patch-core.test.mjs `
  apps/runtime/tooling/tests/dictionary-patch-validator.test.mjs `
  apps/runtime/tooling/tests/game-ui-controls.test.mjs `
  apps/runtime/tooling/tests/product-governance-contract.test.mjs `
  apps/runtime/tooling/tests/semantic-learning-contract.test.mjs
```

Every patch edit must increment the envelope `revision`, recompute its SHA-256
`digest`, and put that exact digest in the `?v=sha256-...` reference in both
`runtime.js` and `sw.js`. Also follow the ordinary runtime/service-worker
asset version bumps for the release. The validator recomputes the digest and
rejects any content or runtime reference that does not agree, so an installed
client cannot silently remain on stale patch JSON.

The shared `CaatuuRuntime.dictionary.search` loads the overlay and merges it
ahead of base results. The same JavaScript runtime is used by the browser and
the Android WebView; the base SQLite database remains read-only.

## Promote accumulated records later

The pinned `kaikki-cs-en-2026-07-09` SQLite artifact is immutable. Never replace
its bytes under the same key, path, or hash. When enough reviewed records have
accumulated, fold them into a newly versioned full-dictionary artifact with a
new catalog key and integrity hash. Keep the tracked overlay until that new
artifact is deployed and verified on both browser and Android.
