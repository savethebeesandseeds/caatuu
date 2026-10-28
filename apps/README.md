# Applications

Each directory here is an intentional product or runtime boundary. Shared
behavior belongs in contracts and services, not in a catch-all app.

| Directory | Responsibility |
| --- | --- |
| [`animated-fabric`](animated-fabric/) | Retired animation application; source, artwork, and provenance retained for reference |
| [`android`](android/) | Native Android shell and offline model bridge |
| [`games`](games/) | Language-independent authored games and their delivery manifests |
| [`languages`](languages/) | Course catalog and one manifest-backed pack per course. Every pack uses the same application |
| [`launcher`](launcher/) | Public launcher and shared browser shell |
| [`server`](server/) | Rust server that exposes the workspace as one runtime |

Application-specific setup stays in each directory. Project-wide architecture
and development guidance lives in [`docs/`](../docs/).
