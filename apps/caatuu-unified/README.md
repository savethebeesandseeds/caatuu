# Caatuu Unified

This app is the static browser landing page for the workspace. It is served at
`/` by the Rust runtime in `apps/caatuu-runtime`.

The active language target is Czech. Android download is separate from language
selection. Chinese is preserved under `archive/caatuu-chinese` for later work,
but it is not shown in the active launcher.

The files live under:

```text
apps/caatuu-unified/static
```

It does not run its own server. Use the workspace README to start the unified
Docker runtime and open:

```text
http://127.0.0.1:8765/
```
