# Caatuu Chinese

Caatuu Chinese is the archived Chinese trainer static app. It is preserved
outside the active `apps/` tree for later reuse, but it is not part of the
active language-selection path.

In the unified Caatuu container it is served at:

```text
/archive/chinese/
/archive/chinese/api/v1/
/archive/chinese/ws
```

Compatibility redirects keep the old `/zh/` entry points working, but new code
and docs should use `/archive/chinese/`.

Use the workspace README for container and Cloudflare commands:

```text
C:\Work\caatuu\README.md
```

The Rust runtime lives in `apps/runtime`. Chinese API and WebSocket
routes are exposed only through the `/archive/chinese/` prefix so the archived
trainer can coexist with the active Czech app without looking like an active
language target.
