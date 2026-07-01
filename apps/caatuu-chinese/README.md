# Caatuu Chinese

Caatuu Chinese is the Chinese trainer app. It keeps its Rust/Axum backend and
static PWA frontend.

In the unified Caatuu container it is served at:

```text
/zh/
/zh/api/v1/
/zh/ws
```

Use the workspace README for container and Cloudflare commands:

```text
C:\Work\caatuu\README.md
```

The backend still runs from this folder. The unified gateway only adds the
`/zh/` prefix so it can coexist with the Czech app under the same hostname.
