# Caatuu development-preview privacy notice

Last updated: 1 September 2026

Caatuu is currently a development preview, not a governed public beta. It is
operated by the individual maintainer publishing the project under the Waajacu
name. Privacy questions and data-rights requests can be sent to
`contact@waajacu.com`.

## Product data

Caatuu does not currently require an account and does not include advertising
or product analytics. Language progress, settings, downloaded models,
dictionaries, and similar learning data are intended to remain on the user's
device.

Caatuu keeps explicit Word World sentence reports in a device-local outbox. The
general feedback sender remains forced offline, the server rejects
`/api/bug-report`, and those reports are not transmitted to or collected by the
maintainer. Enabling general diagnostic delivery still requires a separate
implementation and privacy review; retaining a report on the device does not
authorize its later transmission.

Dictionary-gap observations are local-only in the Pages-hosted web product.
The fixed Android release 162 has no dictionary-gap delivery bridge and keeps
its observations in a dedicated device outbox. Older full-development builds
use a legacy default URL under `https://caatuu.waajacu.com` and may continue to
attempt delivery. After the Pages cutover, GitHub Pages has no handler for
`POST /cz/api/dictionary/gaps`: such attempts fail, nothing is accepted or
stored, and pending observations remain on the device. Deliberate local API
tests require an explicit trusted-development-server override. Clearing site
data or uninstalling the Android app removes pending local observations.

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

The current server validates and deduplicates accepted observations in a
private ledger and adds server receipt timestamps. There is no public GET or
in-app export. Before DNS is changed to Pages, the exact frozen ledger must be
copied to a maintainer-controlled private backup and its integrity receipt must
be verified. It must not be included in Git, the public preservation release,
or Pages. After the Pages cutover no public route accepts new records. The
private copy exists only to identify dictionary coverage work for a later
reviewed patch and must not be repurposed for user tracking or general
diagnostics.

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
