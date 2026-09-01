# Changelog

All tester-facing changes will be recorded here. Caatuu has not yet declared a
governed beta or stable release.

## Unreleased

### Mandarin learning preview

- Expanded the child-safe Mandarin course to 250 Word World entries, 180 Verb
  Nebula entries, and 120 Naturalization Nucleus entries across three
  difficulty levels.
- Added pinyin guides, tone coloring, bidirectional Word World challenges, and
  the Naturalization Nucleus Hanzi-to-pinyin matching game.
- Retired the 12 legacy language-mascot images and their obsolete server route
  and Android cache directories.
- Prepared Android version `0.1.11` (`versionCode 163`) with the shared Czech
  and Mandarin browser experience.
- Kept pending native Mandarin review as a visible quality disclosure while
  separating it from APK publication; active-course promotion and approved
  pronunciation guidance remain independently gated.

### Governance and release integrity

- Licensed first-party Caatuu software, developer documentation, and
  Caatuu-authored English and Mandarin curriculum under `AGPL-3.0-only`, with
  explicit exclusions for third-party or separately licensed models, data,
  artwork, branding, and components.
- Preserved the historical MIT runtime text without withdrawing permissions
  already granted for earlier versions.
- Added a legal and provenance inventory with conservative release gates.
- Paused outside contributions until inbound terms are published.
- Defined development, invited-test, private-beta, public-beta, and stable
  release channels.
- Removed unsupported blanket MIT statements from the product UI.
- Reserved the public Android launcher for signed, non-debuggable builds rather
  than silently falling back to a debug APK.
- Disabled remote diagnostic collection by default, removed its public controls,
  and clear the retired browser feedback queue when the updated runtime loads.
- Added explicit AI-interaction disclosure plus development-preview privacy,
  security, support, and product-readiness documents.
