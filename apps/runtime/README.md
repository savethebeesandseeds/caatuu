# Caatuu Runtime

This is the Rust/Axum server for the unified Caatuu runtime.

It owns the route split:

```text
/                 apps/launcher/static
/cz/              apps/languages/czech/static
/demos/           top-level demos (isolated development projects)
/archive/chinese/ archive/caatuu-chinese/static; API/WebSocket disabled by default
/android/         signed stable and explicit debug Android artifacts
```

The Chinese trainer source is preserved under `archive/caatuu-chinese`. The
active Android app and active browser language target are Czech.

Build the locked release image from the workspace root with:

```powershell
docker compose up -d --build caatuu
```

Start the local runtime with:

```powershell
docker compose up -d caatuu
```

The host port is bound to `http://127.0.0.1:8765/`. Remote access is provided
intentionally by the optional Cloudflare Tunnel profile.

Direct `run.sh` or Cargo launches also bind to loopback by default on port
`9172`. Set `BIND_ADDR` explicitly only when a deliberate network boundary is
already in place; Compose sets `BIND_ADDR=0.0.0.0` inside its isolated container
and controls host exposure through its port mapping.

The archived Chinese API and WebSocket are opt-in. Keep them disabled for the
normal runtime; enabling them exposes an unauthenticated, potentially billable
backend anywhere the runtime is reachable:

```powershell
docker compose -f compose.yaml -f compose/archived-chinese.yaml up -d --build caatuu
```

If that backend needs OpenAI, put the key in the ignored
`secrets/openai-api-key` file and also include `-f compose/archived-chinese-openai.yaml`.
That override mounts only the secret file at `/run/secrets/openai-api-key`.
`env.local.sh` is intentionally not sourced and must not be used for secrets.

Under `/android/`, `caatuu.apk` and `caatuu.json` always mean a signed,
non-debuggable release. Debug builds are served as `caatuu-debug.apk` and
`caatuu-debug.json`.
