# Applications

Each directory here is an intentional product or runtime boundary. Shared
behavior belongs in contracts and services, not in a catch-all app.

| Directory | Responsibility |
| --- | --- |
| [`caatuu-unified`](caatuu-unified/) | Public launcher and shared browser shell |
| [`caatuu-czech`](caatuu-czech/) | Current Czech language world and browser experience |
| [`caatuu-runtime`](caatuu-runtime/) | Rust server that exposes the workspace as one runtime |
| [`caatuu-android`](caatuu-android/) | Native Android shell and offline model bridge |
| [`animated-fabric`](animated-fabric/) | Independent 2D rigging and animation application/library |

Application-specific setup stays in each directory. Project-wide architecture
and development guidance lives in [`docs/`](../docs/).
