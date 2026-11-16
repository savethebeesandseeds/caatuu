# Caatuu reporting Worker

This is the small dynamic companion to the otherwise static GitHub Pages site.
It accepts only two write-only report protocols, exposes one data-free health
route, and protects raw byte-range delivery for four version-pinned setup files
that are treated as write-once:

```text
POST /api/v2/dictionary-gaps
POST /api/v2/sentence-reports
POST /cz/api/dictionary/gaps        (legacy v1)
POST /api/sentence-reports         (legacy v1)
GET  /api/reporting/health
GET  /cz/data/dictionaries/kaikki-cs-en-2026-07-09/caatuu-cs-en.sqlite
GET  /cz/data/embeddings/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite
GET  /language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/onnx/model_qint8_arm64.onnx
GET  /language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/ort/ort-wasm-simd-threaded.wasm
```

The setup files live as version-pinned assets in the GitHub Release
`caatuu-setup-assets-v1`. Their exact Worker routes fetch fixed release URLs
with `Accept-Encoding: identity` and a cache bypass, follow GitHub's asset
redirect, preserve the client's range semantics, `If-Range`, and HTTP
conditional headers, reject a compressed or size-mismatched final response, and
return `no-transform`. Suffix ranges are translated to the equivalent explicit
byte interval because GitHub's Release CDN does not accept suffix syntax. Client
query strings are accepted by the public compatibility
routes but are deliberately not copied to GitHub: the release tag and unique
asset name already identify the exact bytes. This keeps APK 163's raw resume
offsets correct without an application server or a background process. Every
other static request bypasses the Worker.

Treat `caatuu-setup-assets-v1` as write-once. Never replace an uploaded asset or
use `gh release upload --clobber`; changed bytes require a new release tag such
as `caatuu-setup-assets-v2`, updated fixed mappings, and full range/hash
validation before deployment.

The Worker is named `caatuu-reporting`. Its D1 database is configured under the
historical resource name `caatuu-reporting-production`; that name does not imply
a separate deployment tier. The database is restricted to the European Union.
The required opaque database identifier stays in `wrangler.jsonc`; it is not a
credential and should not be duplicated in prose. The public hostname must
remain proxied by Cloudflare for these path-specific Worker routes; every other
request goes to the GitHub Pages CNAME origin without invoking this Worker.

## Privacy boundary

The v2 routes require `X-Caatuu-Reporting-Policy: 2026-11-11.v2`.
The legacy routes retain their original `2026-09-02.v1` marker and schemas.
A marker is a public rollout boundary, not a credential. A mismatched marker
is rejected before reading the body. Old queues are never migrated or uploaded
by this change.

V2 reports carry an exact `courseId`, `sourceLanguage`, `targetLanguage` tuple.
Language values are canonical BCP47 locales from the manifest, retaining region
and script. Dictionary gaps additionally require the declared `providerId`,
`dictionaryKey`, and `dictionaryDirection`. The Worker checks all fields against
its generated `src/course-catalog.mjs`; payloads cannot select an arbitrary
course, provider or dictionary. Sentence reasons use `unnatural_target_language`.
NFC normalization preserves legitimate combining marks and rejects control
characters; text remains bounded by code points.

The catalog generator reads enabled Pages courses and validates dictionary
reporting declarations against active dictionary catalog entries. Regenerate it
with `npm run catalog:generate` after relevant manifest changes. Tests compare
it with the current declarations, and `predeploy` refuses stale generated data.
Pages can use `buildReportingCourseCatalog({workspaceRoot, courses?})` from
`tooling/course-catalog.mjs` to emit the same registry.

V2 uses new course-scoped authorized outboxes. It never converts or uploads
older-protocol queues, including the original `caatuu.feedbackOutbox.v1` and
`caatuu.dictionaryGapOutbox.v1` data.

- A sentence report is sent only after the user checks the per-report consent
  box. It contains the sentence, translation, reason, optional comment, entry
  ID, content mode, and corpus version. Generic diagnostics, nearby sentences,
  URLs, device details, model details, and client timestamps are rejected.
- Missing-word sharing is off by default and covers only observations created
  after the user turns it on. It contains the lookup observation and declared
  course/provider tuple. Turning it off deletes unsent authorized gap reports
  and does not touch legacy local data.

There is no public report listing or export route. Worker observability is
disabled, application code logs no submitted content, and the database stores
no IP address, account, device identifier, user agent, or referrer. Cloudflare
still processes ordinary connection metadata as the infrastructure provider.

Sentence reports become eligible for deletion after 90 days. Dictionary gaps
become eligible 365 days after their latest observation. Cleanup is lazy: an
accepted write requests it when the recorded successful cleanup is at least a
day old. If no later report arrives, eligible rows can remain longer. There is
no cron job, watchdog, health poller, or persistent connection.

## Maintainer commands

Use the existing `caatuu-dev` container:

```powershell
docker exec -w /workspace/apps/reporting-worker caatuu-dev npm ci --ignore-scripts --no-audit --no-fund
docker exec -w /workspace/apps/reporting-worker caatuu-dev npm test
docker exec -w /workspace/apps/reporting-worker caatuu-dev npx wrangler deploy --dry-run
```

The original schema is in `migrations/0001_reporting.sql`. The additive
`0002_course_reporting.sql` creates separate v2 tables without rewriting legacy
rows. Sentence idempotency is scoped to the course/language tuple and client
report ID; dictionary uniqueness also includes provider, dictionary and word.
The dictionary capacity is 4096 words per course/language/provider tuple, with
existing words still writable at capacity. The existing daily lazy retention
also cleans v2 tables using the same 90-day and 365-day windows.

Apply the additive migration before deploying the v2 Worker. The checked-in
migration and route declarations do not apply or deploy themselves. Once an
operation is authorized and authenticated, apply tracked migrations and deploy with:

```powershell
docker exec -w /workspace/apps/reporting-worker caatuu-dev npm run d1:migrate:remote
docker exec -w /workspace/apps/reporting-worker caatuu-dev npm run deploy
```

The ignored legacy ledger importer verifies its fixed record count, byte count,
and SHA-256 receipt before it writes SQL:

```powershell
docker exec -w /workspace caatuu-dev node apps/reporting-worker/tooling/generate-legacy-import.mjs
```

Its private output and receipt stay under
`artifacts/reporting-worker/private/`. Never commit or print the generated SQL.

## Backup statement

No R2 bucket or other hidden backup service exists. The initial ten records
remain reproducible from the ignored source ledger plus its verified receipt,
and D1 Time Travel supplies Cloudflare's short recovery window. A maintainer
with authenticated Wrangler access can create a private SQL export with
`npm run d1:export:remote`; that output is also ignored. A longer-lived,
independent backup destination has not been configured and must not be claimed
otherwise.
