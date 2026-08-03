# Caatuu Server

This is the Rust/Axum server for the unified Caatuu runtime.

It owns the route split:

```text
/                 apps/launcher/static
/cz/              apps/languages/czech/static
/games/           ignored language-independent artifacts/games Web exports
/archive/chinese/ archive/caatuu-chinese/static; API/WebSocket disabled by default
/android/         signed stable and explicit debug Android artifacts
```

The Chinese trainer source is preserved under `archive/caatuu-chinese`. The
active Android app and active browser language target are Czech.

Memory Moon is authored under `apps/games/memory-moon`, generated under
`artifacts/games/memory-moon/web/godot-v1`, and served at
`/games/memory-moon/godot-v1/`. `/cz/games/**` temporarily aliases the same
physical artifact for compatibility; it is not another game copy.

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

## Czech dictionary-gap ledger

The active Czech runtime accepts the narrow, write-only dictionary maintenance
request:

```text
POST /cz/api/dictionary/gaps
```

The `caatuu.dictionary-gap-report.v1` body contains a schema discriminator and
only six observation fields: `targetWord`, `normalizedWord`, `dictionaryKey`,
`dictionaryDirection`, `lookupOutcome`, and `lookupReturned`. The route rejects
unknown fields, unsupported dictionary identities, and oversized or malformed
requests. It does not accept sentences, translations, comments, client
timestamps, report identifiers, URLs, retry metadata, or device information.

After validation, the server deduplicates by dictionary key, direction, and
normalized word, adds server-side first-seen and last-seen timestamps, and
atomically publishes the private ledger. It returns
`{"ok":true,"stored":true}` only after that durable publish succeeds, allowing
the client to retain failed attempts in its dedicated device outbox and retry
later.

Compose persists the ledger at:

```text
artifacts/dictionary-gaps/czech-missing-words.v1.json
```

inside the ignored host artifact directory, mounted at
`/var/lib/caatuu/dictionary-gaps` in the container. Direct launches can override
the path with `DICTIONARY_GAP_STORE_PATH`. There is deliberately no GET or
listing route for the ledger. Records currently remain until a maintainer
reviews, archives, or deletes them; there is no automatic retention expiry.

This endpoint is not a general diagnostic channel. Word World sentence reports
remain device-local, and the generic `/api/bug-report` route remains disabled
for the development preview.

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

Android caching follows the publication contract rather than the file type:

- Versioned files under `/android/releases/<version>/` and gated
  `/android/debug-releases/<version>/` are immutable and may be cached for one
  year.
- Mutable APK and manifest aliases, publication-status endpoints, preview
  aliases, and the Termux install helper are always served with `no-store`.

Release and Play packaging also fail closed unless every release-signing
environment variable is present and nonblank. Debug packaging remains
available without release credentials.
