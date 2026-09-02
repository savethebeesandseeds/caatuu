# Caatuu development-preview privacy notice

Last updated: 2 September 2026

Caatuu is currently a development preview, not a governed public beta. It is
operated by the individual maintainer publishing the project under the Waajacu
name. Privacy questions and data-rights requests can be sent to
`contact@waajacu.com`.

## Product data

Caatuu does not currently require an account and does not include advertising
or product analytics. Language progress, settings, downloaded models,
dictionaries, and similar learning data are intended to remain on the user's
device.

Caatuu does not remotely collect general diagnostics. `/api/bug-report`
remains retired. Existing reports in `caatuu.feedbackOutbox.v1` remain on the
device and are never migrated to the public reporting service.

On the public Pages website, a Word World sentence report can be sent to
`POST /api/sentence-reports` only after the user opens the report dialog,
reviews the field disclosure, and checks the consent box for that report. The
accepted `caatuu.sentence-feedback-report.v1` body contains only the sentence,
English translation, selected reason, optional comment, entry ID, content
mode, corpus version, schema, and random report ID. It excludes the URL,
account, device details, nearby sentences, client timestamp, model details,
runtime state, storage state, and general diagnostic envelope. Sentence
reports become eligible for deletion after 90 days. Because cleanup runs only
after a later accepted report, an eligible row can remain longer during a
period with no reporting traffic.

Public web dictionary-gap sharing is off by default. A learner can turn on
"Share future missing words" in Word World. That choice applies only to new
observations made afterward. Previously saved records remain on the device and
are not uploaded. Turning sharing off deletes only unsent reports in the new
authorized queue. The fixed Android releases 162 and 163 remain local-only;
Android reporting can change only in a future release.

The report protocol is `caatuu.dictionary-gap-report.v1`. In addition to that
schema discriminator, it carries exactly these six observation fields:

- `targetWord`
- `normalizedWord`
- `dictionaryKey`
- `dictionaryDirection`
- `lookupOutcome`
- `lookupReturned`

It does not carry a sentence, translation, comment, account identifier, report
identifier, client timestamp, URL, device information, or retry metadata. As
with every web request, the hosting infrastructure can still receive ordinary
connection data described below.

The narrow Cloudflare Worker validates and deduplicates accepted observations
in an EU-jurisdiction D1 database and adds server receipt timestamps. It stores
no account, IP address, device identifier, user agent, or referrer. Dictionary
gaps become eligible for deletion 365 days after their latest observation and
are removed by the same traffic-triggered cleanup. There is no public GET or
in-app export of reports; the public health route exposes only readiness and a
deployment version.

Both reporting routes require the public policy marker
`X-Caatuu-Reporting-Policy: 2026-09-02.v1`. Old clients do not send it and are
rejected before their bodies are read. This prevents the appearance of the new
route from silently uploading old local queues.

The exact pre-cutover ledger remains an ignored private local artifact and was
imported using its verified 10-record, 3,309-byte receipt. It is not in Git,
GitHub Releases, or Pages. D1 Time Travel supplies Cloudflare's short recovery
window. No R2 bucket or other independent hosted backup destination has been
configured; the project must not claim that one exists.

## Network and infrastructure data

Using the website necessarily sends ordinary connection information to the
network and hosting infrastructure needed to deliver requested pages and
downloads. This can include IP address, request time, requested URL, browser or
device headers, and security metadata. Infrastructure providers may process
that information under their own terms and retention controls.

Sending email to the project provides the sender's address and message to the
email provider and maintainer. Do not send passwords, government identifiers,
health information, financial information, or other sensitive material.

## Requests and changes

Requests for access, correction, deletion, restriction, or objection can be
sent to `contact@waajacu.com`. Where the GDPR applies, requests will be handled
without undue delay and normally within one month.

This notice must be replaced before a governed beta with a controller record,
processor list, lawful-basis and retention schedule, international-transfer
assessment, and release-specific data-flow verification. No account, analytics,
community, cloud-sync, or remote-reporting feature may be enabled merely by
editing this notice; each requires a separate implementation and privacy review.
