# Caatuu development-preview privacy notice

Last updated: 1 August 2026

Caatuu is currently a development preview, not a governed public beta. It is
operated by the individual maintainer publishing the project under the Waajacu
name. Privacy questions and data-rights requests can be sent to
`contact@waajacu.com`.

## Product data

Caatuu does not currently require an account and does not include advertising
or product analytics. Language progress, settings, downloaded models,
dictionaries, and similar learning data are intended to remain on the user's
device.

Caatuu feedback actions place reports in a device-local outbox. This currently
includes explicit Word World sentence reports and compact records of dictionary
words for which no usable English meaning was found. The outbox is kept in browser storage on the device,
accepts at most 128 pending items, and may also be present inside the Android
app's private WebView storage. Clearing site data or uninstalling the Android
app removes that local data.

Remote diagnostic reporting remains disabled. The current runtime forces the
outbox into local-only mode and rejects every delivery attempt without making a
report request. The public server also rejects `/api/bug-report`. Consequently,
locally queued feedback is not transmitted to or collected by the maintainer in
this development preview. Enabling delivery requires a separate implementation
and privacy review; retaining an outbox on the device does not authorize later
transmission.

Word World provides an explicit **Copy missing-word batch** action for manual
dictionary maintenance. It copies a narrow JSON projection to the system
clipboard containing only the observed Czech word, its normalized form, the
dictionary key and direction, and the lookup outcome and result count. It does
not include sentences, translations, comments, report identifiers, timestamps,
URLs, device data, or retry metadata. Copying makes no network request, does not
enable the disabled sender, and does not remove the local reports. The user
decides whether to paste that clipboard text into a separate Codex task or any
other tool.

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
