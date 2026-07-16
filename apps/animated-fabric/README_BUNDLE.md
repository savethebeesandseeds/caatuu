# Animated Fabric starter bundle

Animated Fabric now lives at `apps/animated-fabric` in the Caatuu repository and owns its
dedicated Linux container.

Key files:

- `AGENTS.md`: permanent engineering and environment rules.
- `docs/SPEC.md`: canonical technical specification.
- `docs/STATUS.md`: current delivery state and next permitted work.
- `CODEX_START.md`: reproducible prompt for Milestone M0.

Recommended order:

1. Open `apps/animated-fabric`.
2. Read `AGENTS.md`, `docs/SPEC.md`, and `docs/STATUS.md`.
3. Build the dedicated container with `docker compose build animated-fabric-dev`.
4. Run development commands in that Linux container.
5. Do not begin M1 until M0 has been verified and `docs/STATUS.md` is current.
