# Caatuu Runtime

This is the Rust/Axum server for the unified Caatuu runtime.

It owns the route split:

```text
/                 apps/caatuu-unified/static
/cz/              apps/caatuu-czech/static
/archive/chinese/ archive/caatuu-chinese/static plus archived API/WebSocket routes
/android/         generated Android APK and update manifest artifacts
```

The Chinese trainer source is preserved under `archive/caatuu-chinese`. The
active Android app and active browser language target are Czech.

Build from the workspace root with:

```powershell
docker compose -f compose.tools.yaml run --rm caatuu-build
```

Start the local runtime with:

```powershell
docker compose up -d caatuu
```
