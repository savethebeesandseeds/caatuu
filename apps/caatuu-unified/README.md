# Caatuu Unified

This app is the static browser landing page for the workspace. It is served at
`/` by the Rust runtime in `apps/caatuu-runtime`.

The launcher discovers active courses from `static/languages.json`; Czech is the
current default and only active entry. Browser and Android entry points belong
to each registry item, so future languages can expose the platforms they
actually support. Chinese is preserved under `archive/caatuu-chinese` for later
work, but it is not shown in the active launcher.

The files live under:

```text
apps/caatuu-unified/static
```

It does not run its own server. Use the workspace README to start the unified
Docker runtime and open:

```text
http://127.0.0.1:8765/
```

Large interactive experiments do not belong in this app's `static/assets`
catalog. They live under the workspace-level `demos/` directory and are served
separately at `/demos/` by the same runtime.
