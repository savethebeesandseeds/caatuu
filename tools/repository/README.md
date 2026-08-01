# Repository checks

These dependency-free Node scripts keep the public repository boundary clean:

- `check-tracked-files.mjs` rejects secrets, generated workspaces, dependency
  trees, raw demo research, oversized source files, and project documentation
  placed in the root;
- `check-markdown-links.mjs` verifies that relative Markdown links resolve to
  files or directories included in the repository candidate set; and
- `validate-release-manifest.mjs` is the normative validator for the
  provider-neutral immutable release manifest and mutable channel-pointer
  contracts documented in
  [`docs/DEPLOYMENT_STANDARD.md`](../../docs/DEPLOYMENT_STANDARD.md). It checks
  semantic rules and, by default, recursively verifies local references,
  exact sizes and hashes, containment, component envelopes, evidence status,
  and channel publication policy. The JSON Schemas are structural descriptions.

Run both in a container from the repository root:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace node:24-bookworm `
  bash -lc "node tools/repository/check-tracked-files.mjs && node tools/repository/check-markdown-links.mjs"
```

The repository workflow runs the same commands on GitHub Actions.

Inspect either checked-in synthetic example in structural authoring mode:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace node:24-bookworm `
  node tools/repository/validate-release-manifest.mjs `
  --structure-only `
  docs/examples/release-manifest.v1.example.json
```

The mutable Node tag above is acceptable only for authoring and CI feedback; it
is not a recorded release environment.

`--structure-only` must not be used for publication. Release automation should
validate a complete local release tree and bind both the immutable release and
channel pointer to their intended inputs. It must set
`CAATUU_VALIDATOR_IMAGE` from build provenance to an image reference ending in
`@sha256:<64 lowercase hex characters>`:

```powershell
$validatorImage = $env:CAATUU_VALIDATOR_IMAGE
if ($validatorImage -notmatch '@sha256:[0-9a-f]{64}$') {
  throw 'CAATUU_VALIDATOR_IMAGE must be pinned by digest.'
}

docker run --rm -v "${PWD}:/workspace" -w /workspace $validatorImage `
  node tools/repository/validate-release-manifest.mjs `
  --expected-commit 0123456789abcdef0123456789abcdef01234567 `
  --expected-release-id 0.2.0-beta.1 `
  dist/0.2.0-beta.1/release.json

docker run --rm -v "${PWD}:/workspace" -w /workspace $validatorImage `
  node tools/repository/validate-release-manifest.mjs `
  --expected-channel private-beta `
  --expected-release-id 0.2.0-beta.1 `
  dist/private-beta.json
```

The existing runtime contract-test glob includes
`apps/runtime/tooling/tests/release-manifest-contract.test.mjs`, so schema,
example, integrity, and fail-closed validation run in non-publishing repository
CI.

## Clean local generated state

Preview known ignored caches and build outputs from the repository root:

```powershell
.\tools\repository\clean-local-workspace.ps1
```

Remove them with `-Execute`. Add `-IncludeDownloads` to also remove large,
reproducible downloads and duplicated phone-benchmark artifacts:

```powershell
.\tools\repository\clean-local-workspace.ps1 -Execute -IncludeDownloads
```

The script resolves and validates every target inside the repository before
deleting it. It never removes first-party source, active language data, model
exports used by the apps, or secrets.
