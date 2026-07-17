# Developer tools

This directory contains maintained build, model, validation, and release
tooling. It does not contain deployable Caatuu applications.

| Directory | Responsibility |
| --- | --- |
| [`czech-ml`](czech-ml/) | Czech datasets, model workflows, and ML scripts |
| [`dev-container`](dev-container/) | Shared Docker development and ML environment |
| [`on-device-models`](on-device-models/) | On-device model preparation and benchmark workflows |
| [`repository`](repository/) | Repository policy checks and local cleanup |

Android build tooling lives beside the Android app in
[`apps/android/tooling`](../apps/android/tooling/). Runtime image, audit, and
launch tooling lives beside the Rust service in
[`apps/runtime/tooling`](../apps/runtime/tooling/).

Generated models, dependencies, build trees, and benchmark artifacts are local
state. They are intentionally excluded from Git and can be rebuilt or restored
through the owning tool's documented workflow.
