# Developer tools

This directory contains maintained build, model, validation, and release
tooling. It does not contain deployable Caatuu applications.

| Directory | Responsibility |
| --- | --- |
| [`android-build`](android-build/) | Reproducible Android build environment |
| [`caatuu-cz-ml`](caatuu-cz-ml/) | Czech datasets, model workflows, and ML scripts |
| [`dev`](dev/) | Shared Docker development and ML environment |
| [`phone-bench`](phone-bench/) | On-device model preparation and benchmark workflows |
| [`repository`](repository/) | Repository policy checks and local cleanup |
| [`runtime`](runtime/) | Unified production runtime image and launch scripts |

Generated models, dependencies, build trees, and benchmark artifacts are local
state. They are intentionally excluded from Git and can be rebuilt or restored
through the owning tool's documented workflow.
