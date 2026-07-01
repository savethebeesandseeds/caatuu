# Caatuu Czech

Caatuu Czech is a static browser app for Czech study and on-device WebLLM
testing.

The runtime app is Python-free. It serves files from `static/` and loads the
current browser-ready Czech model export from `static/data/models/`.

In the unified Caatuu container it is served at:

```text
/cz/
/cz/device-ai.html
```

Use the workspace README for container and Cloudflare commands:

```text
C:\Work\caatuu\README.md
```

The heavier ML workspace remains separate:

```text
C:\Work\caatuu\tools\caatuu-cz-ml
```

That workspace is only needed for future dataset rebuilds, training, and model
exports. The current demo model is already exported into `static/data/models/`.
