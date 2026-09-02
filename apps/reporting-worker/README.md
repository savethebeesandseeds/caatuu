# Caatuu reporting Worker

This is the small dynamic companion to the otherwise static GitHub Pages site.
It does not serve the app, Android files, models, or dictionaries. It accepts
only two write-only report protocols and exposes one data-free health route:

```text
POST /cz/api/dictionary/gaps
POST /api/sentence-reports
GET  /api/reporting/health
```

The Worker is named `caatuu-reporting`. Its D1 database is
`caatuu-reporting-production` (`577f1f9b-2c60-41ed-9025-a51a6da2b470`) and is
restricted to the European Union. The public hostname must remain proxied by
Cloudflare for these path-specific Worker routes; every other request goes to
the GitHub Pages CNAME origin without invoking this Worker.

## Privacy boundary

Both POST routes require the public rollout marker
`X-Caatuu-Reporting-Policy: 2026-09-02.v1`. It is not a credential. Requests
without it are rejected before their bodies are read, so older clients cannot
silently drain their pre-consent local queues when the route becomes live.

The browser uses new authorized outboxes. It never migrates or sends
`caatuu.feedbackOutbox.v1` or `caatuu.dictionaryGapOutbox.v1`.

- A sentence report is sent only after the user checks the per-report consent
  box. It contains the sentence, translation, reason, optional comment, entry
  ID, content mode, and corpus version. Generic diagnostics, nearby sentences,
  URLs, device details, model details, and client timestamps are rejected.
- Missing-word sharing is off by default and covers only observations created
  after the user turns it on. It contains only the existing narrow dictionary
  gap fields. Turning it off deletes unsent authorized v2 gap reports and does
  not touch legacy local data.

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

The initial schema is in `migrations/0001_reporting.sql`. Once authenticated,
apply tracked migrations and deploy with:

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
