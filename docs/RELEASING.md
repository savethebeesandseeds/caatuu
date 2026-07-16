# Caatuu release policy

Caatuu is pre-release software. A file being buildable or reachable on the
public server does not make it a production release.

## Channels

| Channel | Audience | Artifact requirements | Public launcher |
| --- | --- | --- | --- |
| Development | Maintainer's local devices | May be debug-signed and incomplete | Never offered |
| Invited test | Named testers working directly with the maintainer | Debuggable only when explicitly disclosed and delivered privately | Never offered |
| Private beta | Small invited group | Signed, non-debuggable, versioned, hashed, and release-gated | Not generally advertised |
| Public beta | Public testers | Same integrity gates as stable, with visible beta label and known limitations | May be offered explicitly as beta |
| Stable | General users | Signed, non-debuggable, supported production artifact | May be the default download |

The stable Android paths `/android/caatuu.json` and
`/android/caatuu.apk` are reserved for a signed, non-debuggable artifact. Debug
paths must never be used as an automatic public fallback.

## Versioning and immutable artifacts

- Use semantic versions with an explicit prerelease suffix before stable, for
  example `0.1.0-beta.1`.
- Keep Android `versionCode` strictly increasing.
- Once a version-owned artifact and manifest are published, their bytes and
  SHA-256 value are immutable. Corrections require a new version.
- Record the source commit, build environment, signer fingerprint, artifact
  hash, release time, migration effects, known limitations, and tester-facing
  changes.

The signing key must remain outside Git and have two protected backups before
the first external beta.

## Required release gates

A beta or stable release requires all of the following:

- the `AGPL-3.0-only` first-party scope remains reflected consistently in
  repository files, package metadata, the app, and the corresponding-source
  offer;
- every distributed software dependency, model, dataset, dictionary, and asset
  cleared in [`LEGAL_INVENTORY.md`](LEGAL_INVENTORY.md);
- complete third-party notices present in the browser distribution and offline
  APK/AAB;
- privacy notice and in-product report disclosure matching actual diagnostic
  behavior;
- private security-reporting channel and supported-version policy;
- release notes in [`CHANGELOG.md`](../CHANGELOG.md);
- green automated checks for the runtime, browser contracts, provenance, and
  package contents;
- successful signed-package audit; and
- physical-device smoke test of installation, setup, offline use, update, and
  data preservation.

Any failed or unknown gate blocks publication. The maintainer may still make a
development build for personal testing, but must not relabel it as beta or
stable.
