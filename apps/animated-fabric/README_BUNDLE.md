# Animated Fabric starter bundle

Animated Fabric lives at `apps/animated-fabric` in the Caatuu repository and
uses Caatuu's established Linux development container.

Key files:

- `AGENTS.md`: permanent engineering and environment rules.
- `docs/SPEC.md`: canonical technical specification.
- `docs/STATUS.md`: current delivery state and next permitted work.
- `CODEX_START.md`: archived record of the original Milestone M0 prompt; do not rerun it.

Recommended order:

1. Open the canonical `C:\Work\caatuu` repository.
2. Read `AGENTS.md`, `docs/SPEC.md`, and `docs/STATUS.md`.
3. Build the shared environment with
   `docker compose --profile dev up -d --build caatuu-dev`.
4. Run project commands with
   `docker exec -w /workspace/apps/animated-fabric caatuu-dev caatuu-animated-fabric <command>`.
5. Check `docs/STATUS.md` for the current milestone and verified next work.
