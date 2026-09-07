# Changelog

All tester-facing changes will be recorded here. Caatuu has not yet declared a
governed beta or stable release.

## Unreleased

### Android 0.1.17 (169): smaller APK and selected-course setup

- Reduced APK-resident web assets from about 47 MB to 3.77 MB. Course content
  and shared artwork now download during setup; other courses reuse verified
  shared files. Excluded three unused legacy icons while retaining source art.
- Added a lightweight course picker, recoverable downloads, and verification
  before opening a course. Versioned storage protects installed shared assets.
- Sealed the setup payload with the APK so deployment retries reuse the same
  bytes and older app versions retain their content URLs.
- Included shared update-control and game-layout fixes, plus American English
  wording and context-specific Spanish gloss corrections in the development
  Spanish-to-English course.
- Physical-device installation, update, offline use, and progress-preservation
  testing remain unverified for this candidate.

### Android 0.1.16 (168) and shared game improvements

- Made setup preparation automatic and its checking, progress, retry, and ready
  states clearer; added visible update controls to Home and About.
- Included the Spanish-to-English development course for hands-on Android
  testing, keeping its pending curriculum review visible, and placed English
  first in the source-language chooser.
- Restored image lookup metadata for setup-downloaded artwork so picture clues
  and the developer image search can find those images in the APK.
- Kept Grammar Gravity's loading robot visible until its artwork is ready and
  prevented consecutive repetitions of the same word.
- Ended incorrect Case Cosmos answers with a correction and a next challenge;
  shortened Conjugation Comet retry delays, removed error underlines, and added
  an animated completion summary with the Next button.
- Standardized Naturalization Nucleus surfaces, loading, instructions, and
  controls; placed dictionary cards below the orbit and hid pinyin hints on
  unmatched Hanzi cards.
- Reset loaded game challenges when difficulty changes without clearing saved
  progress, and replaced alarming notification-permission wording.
- Physical-device installation, update, offline use, and progress-preservation
  testing remain unverified for this candidate.

### Android 0.1.15 (167) and shared course fixes

- Fixed Czech setup reporting readiness before its setup provider had enabled
  navigation, and retained Mandarin Verb Nebula in the Android package.
- Added shared Android update and cache controls for courses without the Czech
  setup provider, including update-download recovery after changing pages.
- Made the language chooser modal, stacked its choices vertically, and required
  an explicit source-language choice before enabling the target-language step.
- Enabled Verb Nebula and its Campaign entry for the browser-only Spanish to
  English course, with Spanish feedback and separate English retrieval text.
- Removed unrelated fallback picture clues, packaged the shared hearing and
  seeing artwork, and refreshed course profiles and offline asset references.
- Physical-device installation, update, offline use, and progress-preservation
  testing remain unverified for this candidate.

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
- Prepared Android version `0.1.12` (`versionCode 164`) with first-run source
  and target language selection, a light default theme, and the Mandarin
  development preview available from the shared browser setup.
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
- Made stable Android publication build-once and receipt-driven, with an
  append-only Pages release history and exact-commit deployment checks.
- Disabled remote diagnostic collection by default, removed its public controls,
  and clear the retired browser feedback queue when the updated runtime loads.
- Added explicit AI-interaction disclosure plus development-preview privacy,
  security, support, and product-readiness documents.
