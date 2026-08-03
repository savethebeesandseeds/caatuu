# Applications

Each directory here is an intentional product or runtime boundary. Shared
behavior belongs in contracts and services, not in a catch-all app.

| Directory | Responsibility |
| --- | --- |
| [`animated-fabric`](animated-fabric/) | 2D rigging and animation application/library using the shared Caatuu development environment |
| [`android`](android/) | Native Android shell and offline model bridge |
| [`games`](games/) | Language-independent authored games and their delivery manifests |
| [`languages/czech`](languages/czech/) | Current Czech language world and browser experience |
| [`launcher`](launcher/) | Public launcher and shared browser shell |
| [`server`](server/) | Rust server that exposes the workspace as one runtime |

Application-specific setup stays in each directory. Project-wide architecture
and development guidance lives in [`docs/`](../docs/).
