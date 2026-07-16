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
