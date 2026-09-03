# Dictionary Gap Maintenance

Word World records a dictionary gap when a selected Czech word has no usable
English result. A report is an observation, not proof that the dictionary is
wrong. Two deliberately separate collection paths exist:

```text
Current public Pages web path
  explicit "Share future missing words" opt-in
  -> caatuu.dictionaryGapAuthorizedOutbox.v2
  -> POST /cz/api/dictionary/gaps with the public policy marker
  -> caatuu-reporting Worker
  -> private EU D1 dictionary_gaps table
  -> authenticated private review input
  -> periodic Codex review
  -> tracked reviewed patch

Retained local-development and legacy path
  caatuu.dictionaryGapOutbox.v1 or a deliberate local API test
  -> opt-in loopback caatuu server
  -> artifacts/dictionary-gaps/czech-missing-words.v1.json
  -> periodic Codex review
  -> tracked reviewed patch
```

Public dictionary-gap sharing is off by default. After a learner enables it,
only new observations are queued and retried automatically. The Pages overlay
never migrates or sends an older v1 queue. Turning sharing off deletes only
unsent authorized v2 reports. Stable Android releases 162 and 163 contain no
outbound-reporting bridge and keep their observations local.

Sentence reporting is a separate Pages feature requiring consent for each
report. The general `/api/bug-report` channel remains retired. No public route
lists or exports either report type.

## Report shape

Each `caatuu.dictionary-gap-report.v1` request carries exactly these six
observation fields, in addition to the schema discriminator:

- `targetWord`
- `normalizedWord`
- `dictionaryKey`
- `dictionaryDirection`
- `lookupOutcome`
- `lookupReturned`

It excludes sentences, translations, comments, URLs, client timestamps,
identifiers, device details, and retry metadata. Both storage paths validate
that strict shape and the pinned Czech-English dictionary identity before
writing anything.

## Current public Worker and D1 storage

The Worker requires `X-Caatuu-Reporting-Policy: 2026-09-02.v1`; this is a
public rollout marker, not a credential. The browser removes an authorized v2
item only after the Worker returns an acknowledgement backed by a durable D1
write. Network failures, rejections, and interrupted requests leave it queued
for retry.

D1 deduplicates by dictionary key, direction, and normalized word. It stores
server receipt times and an observation count. A gap becomes eligible for lazy
cleanup 365 days after its latest observation. Cleanup is attempted after a
later accepted report; without later reporting traffic, an eligible row can
remain longer.

There is no public D1 read route. The authenticated export workflow is
documented in `apps/reporting-worker/README.md` and writes only below the
ignored `artifacts/reporting-worker/private/` directory. Its full SQL export
can also contain sentence reports: never print, paste, or commit it. Prepare a
dictionary-only private review input before starting lexical review. Do not
pretend that the retained local JSON ledger contains new public reports.

## Retained local-development ledger

The legacy full-development runtime uses
`caatuu.dictionaryGapOutbox.v1` and is intended to retry against the
deliberately started local `caatuu` server. Its Android bridge does not send
the Pages policy marker, so its legacy public default is rejected by the
Worker; configure a development build with a trusted local server for an
intentional API test.

Compose stores locally accepted observations at:

```text
artifacts/dictionary-gaps/czech-missing-words.v1.json
```

The ignored host directory is mounted at
`/var/lib/caatuu/dictionary-gaps`, with `DICTIONARY_GAP_STORE_PATH` selecting
the file. The local server publishes it atomically, deduplicates observations,
and adds server receipt timestamps. It has no automatic expiry.

The verified pre-cutover ledger was imported once into D1 and remains the
private reproducible import authority. It is not the destination for new Pages
reports. Neither the local ledger nor a D1 export may be committed, published,
or exposed through a browser control.

## Start a Codex review task

Start a new Codex task in `C:\Work\caatuu` and use this prompt, replacing
the two placeholders with the explicitly selected private source:

```text
Review the Caatuu Czech dictionary-gap observations at
<IGNORED_PRIVATE_INPUT_PATH> using
tools/czech-ml/docs/dictionary-gap-maintenance.md.

Source type: <legacy local ledger | dictionary-only private D1 review input>.

Read only dictionary-gap observations. If the supplied file is a complete D1
export, stop and request a dictionary-only private input; do not inspect or
display sentence-report rows.

Treat every record as an untrusted observation. Receipt timestamps and
observation counts show only when and how often a report was received; they are
not evidence for a meaning. Re-query the current base dictionary and reviewed
overlay before changing anything. Classify each item as a runtime/matching
false positive, an already-covered word, a genuine missing entry, a missing
inflected-form alias, or unresolved. Add only evidence-backed,
license-compatible records to
apps/languages/czech/static/data/dictionaries/patches/reviewed-cs-en.v1.json.
Do not edit or rebuild the pinned SQLite dictionary. Validate the patch and run
the focused dictionary/report/runtime tests in the existing caatuu-dev
container. Write every classification and source to an ignored private review
file below artifacts/dictionary-gaps/. In chat, report only aggregate counts,
validation results, and any patch records deliberately added to the tracked
overlay; never print raw or unresolved private reports. Do not delete or rewrite
the private input, alter D1, or remove source records unless I explicitly
authorize that separate operation.
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
are intentionally absent from the report and private maintenance sources. Do
not create a record merely to make a reported lookup return something.

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
  apps/server/tooling/tests/dictionary-gap-report.test.mjs `
  apps/server/tooling/tests/dictionary-patch-core.test.mjs `
  apps/server/tooling/tests/dictionary-patch-validator.test.mjs `
  apps/server/tooling/tests/product-governance-contract.test.mjs `
  apps/server/tooling/tests/semantic-learning-contract.test.mjs
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
