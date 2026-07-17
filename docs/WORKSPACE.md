# Workspace map

Caatuu is a small monorepo with explicit boundaries:

| Path | Contents |
| --- | --- |
| [`apps/`](../apps/) | Active applications and the runtime that serves them |
| [`archive/`](../archive/) | Preserved superseded implementations |
| [`demos/`](../demos/) | Reviewed, isolated experiments used by the runtime |
| [`docs/`](./) | Project-wide architecture, policy, and development guidance |
| [`tools/`](../tools/) | Build, model, benchmark, validation, and release tooling |

## Naming convention

- Use lowercase kebab-case for repository directories and files.
- Prefer ownership names such as `runtime` or `on-device-models` over status
  labels such as `new`, `unified`, or `experimental`.
- Put language applications under `apps/languages/<language>`.
- Keep component-specific tooling beside the component that owns it; reserve
  `tools/` for shared workflows.
- Keep stable public routes, downloaded artifact names, model identifiers, and
  storage keys unchanged unless a compatibility migration is intentional.
- Do not add numeric prefixes merely to force display order. Tables and indexes
  should provide human-readable ordering instead.

## What belongs in Git

Commit source, configuration, small reviewed assets, manifests, licenses, and
documentation needed to understand or reproduce the project. Keep generated
models, dependency trees, compiler outputs, raw research inputs, local secrets,
and replaceable downloads outside Git.

The repository checks enforce that boundary. The local cleanup command removes
known ignored build and dependency state without touching first-party source
or active language data:

```powershell
.\tools\repository\clean-local-workspace.ps1
.\tools\repository\clean-local-workspace.ps1 -Execute
.\tools\repository\clean-local-workspace.ps1 -Execute -IncludeDownloads
```

The first command is a preview. `-IncludeDownloads` also removes large
reproducible downloads and duplicated benchmark artifacts.
