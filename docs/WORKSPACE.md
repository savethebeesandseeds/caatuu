# Workspace map

Caatuu is a small monorepo with explicit boundaries:

| Path | Contents |
| --- | --- |
| [`apps/`](../apps/) | Active applications and the runtime that serves them |
| [`demos/`](../demos/) | Reviewed, isolated experiments used by the runtime |
| [`tools/`](../tools/) | Build, model, benchmark, validation, and release tooling |
| [`archive/`](../archive/) | Preserved superseded implementations |
| [`docs/`](./) | Project-wide architecture, policy, and development guidance |

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
