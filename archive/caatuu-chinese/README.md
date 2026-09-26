# Caatuu Chinese

Caatuu Chinese is the archived Chinese trainer static app. It is preserved
outside the active `apps/` tree for later reuse, but it is not part of the
active language-selection path.

These historical routes are no longer served by the Caatuu runtime or public
site:

```text
/archive/chinese/
/archive/chinese/api/v1/
/archive/chinese/ws
```

The active `/zh/` route belongs to the modern Mandarin course under
[`apps/languages/mandarin-simplified`](../../apps/languages/mandarin-simplified/).
It does not redirect to this archive. The archived API and WebSocket sources
remain historical material; restoring them would require a separate scope and
runtime integration.
