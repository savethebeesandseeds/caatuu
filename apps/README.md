# Applications

Each directory here is an intentional product or runtime boundary. Shared
behavior belongs in contracts and services, not in a catch-all app.

| Directory | Responsibility |
| --- | --- |
| [`animated-fabric`](animated-fabric/) | Independent 2D rigging and animation application/library |
| [`android`](android/) | Native Android shell and offline model bridge |
| [`languages/czech`](languages/czech/) | Current Czech language world and browser experience |
| [`launcher`](launcher/) | Public launcher and shared browser shell |
| [`runtime`](runtime/) | Rust server that exposes the workspace as one runtime |

Application-specific setup stays in each directory. Project-wide architecture
and development guidance lives in [`docs/`](../docs/).
