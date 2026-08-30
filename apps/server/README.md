# Caatuu Server

This is the Rust/Axum server for the unified Caatuu runtime.

It owns the route split:

```text
/                 apps/launcher/static
/cz/              active Czech course from apps/languages/catalog.json
/zh/              Mandarin development course from the same catalog
/language-runtime narrowly shared course runtime and English embedding assets
/games/           ignored language-independent artifacts/games Web exports
/android/         signed stable and explicit debug Android artifacts
```

Browser language mounts are loaded from `apps/languages/catalog.json` and each
course manifest; the server does not maintain a parallel hard-coded language
list. The public launcher still lists only active courses, so the
`development` Mandarin preview remains directly addressable but unlisted and
`noindex`. The deprecated Chinese trainer source remains repository-only under
`archive/caatuu-chinese`; it is not mounted or routed. `/zh-hans/*` redirects
to the canonical `/zh/*` course. Czech remains the Android default.

The `/language-runtime/` surface is deliberately narrow: it exposes the shared
contract/static browser modules and the pinned English MiniLM runtime needed by
semantic search. Repository documentation and tests remain private. Target
text, pinyin, and target-language metadata are never model inputs.

Caatuu Game is authored under `apps/games/caatuu-game`, generated under
`artifacts/games/caatuu-game/web/godot-v1`, and served only when
`ENABLE_CAATUU_GAME_PREVIEW=1`. Its stable standalone URL is
`/games/caatuu-game/`; the versioned bundle remains at
`/games/caatuu-game/godot-v1/`. Language routes and Android do not alias,
embed, or package it.

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

The deprecated Chinese trainer remains under `archive/caatuu-chinese` only as
source history. No Compose override, static mount, API, WebSocket, or OpenAI
secret path can activate it. Preserve the archive files when historical
reference is useful, but do not add them to the runtime route tree.

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
