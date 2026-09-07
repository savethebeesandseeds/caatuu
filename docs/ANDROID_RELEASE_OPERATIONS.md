# Android release operations

Last reviewed: 7 September 2026

This is the operational handoff for maintainers and coding sessions. Use the
maintained entrypoints, not a remembered sequence of repair commands.
[`RELEASING.md`](RELEASING.md) still owns channel approval and device gates;
successful publication is not proof of beta/stable readiness.

## Choose the operation

| Intent | Maintained path | What can build? |
| --- | --- | --- |
| New Android version | `pwsh -NoProfile -File apps/android/tooling/release-android.ps1` | One guarded Android build, only if no sealed candidate exists. |
| Retry finalized Android publication | Rerun that command, or use the receipt-only command below. | Neither Android nor website. |
| Publish changed website sources | Explicit `deployment_scope=website` in the existing Pages workflow. | Website only; existing Android artifacts are retained. |
| Change release tooling/tests/docs | Focused verification and source CI. | No new APK solely to test orchestration. |

Run from `C:\Work\caatuu` on the Windows host. Heavy builds and Node checks run
in the established `caatuu-dev` container at `/workspace`. Never create a
parallel checkout, branch, container, service, or host dependency installation
to make a release work. The existing local app on port 8765 need not be stopped.

## Before a new version

1. Verify the canonical root and that the only local and remote-tracking branch
   is `main` (a symbolic remote `HEAD` is not a branch). Inspect the development
   container bind mount: it must be `C:\Work\caatuu` to `/workspace`. Stop on an
   active alternate-checkout/source mismatch; preserve recovery material.
2. Inspect shared changes. Do not reset, stash, clean, replace, or stage another
   session's files without explicit integration authority. Agree on a source
   checkpoint if overlapping work is active. The publisher requires clean,
   pushed source; a new edit during the build must not silently enter it.
3. For an actual new APK, increment the authoritative product `versionCode`
   monotonically and set its `versionName`. Never increment just to retry an
   upload, repair deployment tooling, or work around an immutable mismatch.
4. Run focused tests for the changed boundary, then commit and push the verified
   source on `main`. Keep signing keys, generated packages, SDK/model caches and
   temporary fixtures out of Git. Structural/documentation changes also require
   the repository tracked-file and Markdown-link checks.
5. Invoke the routine command once. It owns the build lock, preflight, signing,
   package audit, finalization, upload, Pages handoff and public verification.
   Do not first build the same APK separately or run a full website export.

Signing lineage is pinned by
[`direct-release-certificate.sha256`](../apps/android/tooling/direct-release-certificate.sha256).
The existing ignored keystore retains its historical filename. A missing or
mismatched key is a stop condition, never permission to generate a replacement.

## Build once, then move the sealed bytes

The builder seals an APK/AAB receipt under
`artifacts/android/release-candidates/<versionCode>.json`. The publisher
finalizes that APK, its manifest and receipt under
`artifacts/android/releases/<versionCode>/`. The receipt binds source revision,
package/version, signer, byte lengths and SHA-256 identities.

For a bootstrap APK, the same candidate receipt also seals `artifacts.setup`:
`artifacts/android/release-candidates/setup/<archive-sha256>.tar`. The
compiler emits APK-resident engine/setup files and a companion inventory of
the exact transformed curriculum and artwork bytes. The builder packages that
inventory once, validates its complete correspondence with the APK's setup
catalogs, and includes the archive in the pre-audit identity and sealed receipt.
Finalization copies it to `releases/<versionCode>/caatuu-setup-payload.tar`
before installing the final receipt or changing local download aliases.
Legacy receipts without a setup artifact remain valid and unchanged.

The wrapper checks whether the finalized files exist to choose the stage. That
existence check is not an integrity approval: the deployer authenticates the
receipt and artifacts before uploading. A corrupt finalized candidate fails;
it does not trigger a replacement build under the same version.

A fresh build runs one full archive audit. The builder may pass its publisher
a private, random, same-invocation proof bound to **pre-audit** artifact hashes,
the sealed receipt, clean source revision and tracked verifier/launcher
identities. The publisher checks the copied bytes against it and still verifies package,
version, non-debuggable state and signing pin. Missing, stale, changed or
adopted proof takes the full-audit path. This is not a persistent audit cache,
and an old receipt alone never bypasses the audit. This short-lived proof is
not a complete SDK/JDK fingerprint; the pinned build environment remains part
of release provenance.

Receipt-only deployment:

```powershell
pwsh -NoProfile -File apps/android/tooling/deploy-pages-release.ps1 `
  -CandidateReceipt artifacts/android/releases/<versionCode>/caatuu-release-candidate.json
```

This uploads only missing exact assets, updates the append-only Android Pages
descriptor on `main`, dispatches Android scope, and verifies the public result.
It does not invoke Gradle or either source compiler.

Android scope restores the hash-pinned published website snapshot, preserves
the live inventory and earlier immutable additions, then adds the sealed
Android release and updates its mutable download pointers. Missing
content-addressed setup assets may come from the sealed APK. Existing website
or immutable release bytes cannot be overwritten. Pages still transports a
complete site artifact; that transport is not a website rebuild.

Downloadable curriculum/artwork comes from the sealed companion archive,
published as `caatuu-<versionCode>-setup-payload.tar` alongside the existing
GitHub Release assets. The append-only Pages descriptor pins its hash and byte
length. Both website builds and Android overlays retain the objects from every
recorded companion under `/assets/setup/<sha256>/<filename>`, so older installed
APKs keep their required content. The archive itself stays on the GitHub
Release; Pages serves its individually verified objects. Before deployment,
the output must contain the exact APK-pinned setup closure. Pages switches
the complete site atomically; public verification then checks each current
companion object against the verified APK's setup catalogs. A missing or
changed archive/object is a failed release, never permission to regenerate
payload from a newer checkout or publish the APK without its dependencies.

## Recovery decision table

| Observed state | Next action | Never do |
| --- | --- | --- |
| Another publisher owns the build lock | Inspect that process and its output; reuse its eventual receipt. | Start another builder or kill a build just because the terminal stopped waiting. |
| Build failed before sealing | Fix the reported source/tool problem and rerun the maintained command after its source checks. | Disable signing, content integrity or package-boundary checks. |
| Sealed candidate exists, local finalization incomplete | Reuse that candidate; if `main` advanced, explicitly select its receipt as described below. | Delete the receipt to force Gradle again. |
| Finalized receipt exists; upload, Pages or public verification failed | Rerun receipt-only deployment with the same version and exact files. | Build another APK to solve a network/deployment failure. |
| Upload response was lost | Reconcile the exact remote tag, asset hash and size before proceeding; the deployer does this for uncertain responses. | Blindly repeat or clobber an upload. |
| Workflow dispatch response was lost | Find the newly accepted run for the intended source and Android scope; the deployer reconciles without resending. | Repeatedly dispatch while the original run may be active. |
| Immutable hash, signer, source or version floor mismatch | Stop, retain artifacts/logs, and investigate the exact mismatch. | Rewrite a published version, roll back stable pointers, or invent a new signing key. |
| Website inventory changed during Android deployment | Inspect the newer publication and resume from its verified inventory. | Restore a stale snapshot over the new website. |

The routine build-once path requires a candidate from the exact current source
revision. If source has advanced after sealing but before local finalization,
use the explicit receipt promotion path; it validates the existing source and
bytes without Gradle:

```powershell
docker exec -w /workspace caatuu-dev bash apps/android/tooling/publish-release.sh --candidate-receipt artifacts/android/release-candidates/<versionCode>.json
```

After finalization, use the receipt-only deployer with the receipt in
`artifacts/android/releases/<versionCode>/`. Source changes are not permission
to replace an existing candidate or bypass its version-floor checks.

Receipt promotion audits the package against the catalog and shared source
bytes at the receipt's full Git commit ID. These are read directly from Git
objects in the canonical repository; no alternate checkout is created.
Current validator security and integrity checks still apply. This allows a
later course addition to coexist with an already sealed earlier APK.

If the finalized receipt predates the current source before its first Pages
descriptor advance, pass `-ExpectedSourceRevision <receipt-source-commit>` to
the receipt-only deployer. The full commit must match the verified receipt
exactly and remain an ancestor of `origin/main`. Omission keeps the routine
exact-current-source guard. Keep the same argument when resuming an interrupted
descriptor handoff; this option never rebuilds or replaces sealed artifacts.

Short allowlisted metadata reads have at most three attempts: a 60-second
process limit per attempt and 2/4-second backoff. TLS handshake timeouts,
connection resets, HTTP 408/429 and selected 5xx errors are retryable.
Authentication, permission, certificate and permanent HTTP errors stop.
Uploads, release finalization and workflow dispatch are not blindly retried;
uncertain responses require exact server-state reconciliation. Long workflow
watching and artifact transfers are separate from these short-read limits.

## Test policy: behavior and integrity, not incidental wording

Keep exact assertions for identifiers and invariants that genuinely must not
change: signatures, immutable hashes, package identity, disabled capabilities,
path confinement, required interface keys, locale parity, and catalog-to-file
closure. Frozen compatibility releases retain their exact historical pins.
Intentional delivery-size budgets also remain in the compilers; a fixture's
snapshot of today's file total is not a size policy. Android still rejects
model payload leakage and verifies exact inventory/receipt bytes without a
hard-coded total derived from one past APK.

Do not gate publication on an English UI phrase, current artwork filename,
hard-coded live catalog revision, corpus total, CSS spelling, or source-code
formatting. Derive changing expectations from authoritative catalogs; test
rendered structure or behavior where appropriate. Replacing one stale literal
with today's literal does not fix this class of failure. If a wording assertion
has no safety or behavior contract, remove it rather than maintaining it.

Source CI owns larger compiler fixtures and website tests. Routine APK preflight
stays small; the real compiler and final archive audit retain integrity checks.
Fresh-checkout fixtures must not secretly require Git-ignored model downloads.
Metadata-only tests may explicitly exercise the setup-delivered runtime mode;
normal Android builds remain strict. Synthetic missing-file, byte/hash mismatch
and path-escape tests cover those failure boundaries without large model files.

When changing this pipeline, run from the canonical workspace:

```powershell
pwsh -NoProfile -File apps/android/tooling/tests/release-orchestration.test.ps1
pwsh -NoProfile -File apps/android/tooling/tests/release-network-retry.test.ps1
docker exec -w /workspace caatuu-dev node --test apps/android/tooling/tests/release-android-contract.test.mjs apps/android/tooling/tests/release-candidate.test.mjs apps/android/tooling/tests/publisher-build-once-contract.test.mjs apps/android/tooling/tests/release-publication-state.test.mjs apps/android/tooling/tests/deploy-pages-release-contract.test.mjs
docker exec -w /workspace caatuu-dev node --test apps/android/tooling/tests/setup-payload.test.mjs apps/android/tooling/tests/pages-current-release.test.mjs apps/android/tooling/tests/pages-android-overlay.test.mjs apps/android/tooling/tests/pages-website-snapshot.test.mjs apps/android/tooling/tests/verify-public-pages-release.test.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-tracked-files.mjs
docker exec -w /workspace caatuu-dev node tools/repository/check-markdown-links.mjs
```

The native PowerShell suites need no Pester installation and perform no real
build, Git mutation or publication. They exercise the maintained orchestration
and network/dispatch functions with controlled stage failures: before sealing,
after upload, during Pages and public verification, corrupted receipt, bounded
read timeout, and an accepted dispatch with a lost response. Retries must keep
the same artifact identity and must not call the builder twice. Source CI runs
these suites alongside the Node contracts. These simulations do not replace a
signed-package audit, actual public-byte verification or physical-device testing.

Also verify script-call scope, not only `pwsh -File`: CI invokes these scripts
from a parent PowerShell script. Closures must capture helper scriptblocks
explicitly rather than relying on functions being in the global scope. Use a
fail-fast parent so missing helpers cannot print errors followed by a false pass:

```powershell
pwsh -NoProfile -Command '$ErrorActionPreference = "Stop"; & ./apps/android/tooling/tests/release-orchestration.test.ps1; & ./apps/android/tooling/tests/release-network-retry.test.ps1'
```

## Close the loop after each incident

Record the failing phase, exact error, source revision, candidate identity and
relevant run/log link. Fix the owning entrypoint or validator, add a focused
executable regression, and update this runbook plus adjacent tooling details
when behavior changes. Avoid a parallel repair script or a session-only command
sequence. Preserve useful recovery artifacts; cleanup needs separate authority.

Android 168's first attempt at source `ff5003336241164cde430016e8e7983a320bbe93`
stopped in source preflight with `missing Android-enabled catalog courses: es-en`;
no APK build or sealed candidate existed. Synthetic package fixtures must supply
their own publication plan, while current-catalog tests derive enabled courses
from the manifests. The same source's CI caught a single-course compiler using
the bundle-only embedding setup transform. The compiler now collects artwork
storage metadata through each output's own setup projection. The package,
course-plan, single-course compiler, and static-site suites cover these paths.
An additional cross-course fixture incorrectly required identical artwork
keymaps for separate course exports; formatting its large Buffer mismatch
exhausted test memory. Compare each projected keymap with its authorized image
sources, and use bounded equality diagnostics for large binary assets.

Android 168 then published successfully, but the public verifier's 30-second
deadline repeatedly timed out downloading its 41,702,058-byte immutable APK
(`artifacts/android/release-168-final-session.log`). The source remains
`46845e65c3b295ffa2cf8caf5215fb8eb7a5e472`; its sealed APK was not rebuilt.
Full APK requests now have a bounded 120-second deadline, while metadata and
range requests retain 30 seconds. Regression tests cover slower complete
downloads, body timeouts, and unchanged byte/hash validation. Resume with the
same finalized receipt after a download timeout.

Report three independent statuses:

- **Published:** exact version, public manifest/APK URL, verified identity and
  deployment run. A lightweight manifest read suffices after the deployer has
  verified public bytes.
- **Checks:** source revision and relevant CI results; name unrelated failures
  separately rather than claiming that all CI is green.
- **Device:** tested/not tested, device and install/update/offline/data-preservation
  results. Publication cannot establish this status.

Print phase timings and identify the stalled phase. Do not promise a fixed
seven-minute release or that failures can never recur. The enforceable promise
is narrower: bounded retry rules, no duplicate build after sealing, no website
source rebuild for an Android retry, immutable-byte verification, and a tested
recovery path maintained in code and documentation.

### Reference incident: September 2026

Android 166 (`0.1.14`) was published by
[Pages run 34067964985](https://github.com/savethebeesandseeds/caatuu/actions/runs/34067964985).
Its Android-only deployment skipped website compilation and preserved all 814
non-Android website files. An interrupted upload resumed the finalized receipt
without rebuilding. The APK SHA-256 is
`c2d6f8035f89df5e03d1175c6cdef2072ffc57c2c833a8f732fe8433f00bce3a`.

That incident exposed avoidable work: UI-copy/source-shape assertions, model
fixtures that depended on a local download, website compilation coupled to APK
deployment, unbounded transient-read handling, and duplicate archive auditing.
The maintained boundaries and regressions above address those failure classes.
The recorded local finalization was about 7m33s and a resumed deployment about
3m36s; those are historical measurements, not timing guarantees. Phone testing
was not established by those automation results.

Implementation details remain in the
[Android tooling README](../apps/android/tooling/README.md); website-origin and
cutover operations remain in [`STATIC_WEB_HOSTING.md`](STATIC_WEB_HOSTING.md).

### Reference incident: duplicate Windows Git discovery

Android 167 (`0.1.15`), built from
`fd9884573e791723e367cc067a9b13340aa4399d`, finalized successfully but its
receipt-only deployment stopped during preflight: PowerShell returned two Git
applications, and the bounded process runner combined their paths into an
invalid executable filename. The same finalized APK resumed without a rebuild
and passed public verification in
[Pages run 34075703300](https://github.com/savethebeesandseeds/caatuu/actions/runs/34075703300).
Its APK SHA-256 is
`a61e71bf73800810f8a71f1adddc40b4ddd50f6c8f3287e16be559de3ea98e68`.

The bounded runner now selects the first discovered application, preserving
normal PATH precedence. The native network suite verifies multiple discovery
results using the real process runner, including captured output and exit code.
No global PATH or Git identity change is required. Device testing remains
separate from the successful package and publication checks.
