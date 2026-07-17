# Repository checks

These dependency-free Node scripts keep the public repository boundary clean:

- `check-tracked-files.mjs` rejects secrets, generated workspaces, dependency
  trees, raw demo research, oversized source files, and project documentation
  placed in the root;
- `check-markdown-links.mjs` verifies that relative Markdown links resolve to
  files or directories included in the repository candidate set.

Run both in a container from the repository root:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace node:24-bookworm `
  bash -lc "node tools/repository/check-tracked-files.mjs && node tools/repository/check-markdown-links.mjs"
```

The repository workflow runs the same commands on GitHub Actions.

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
