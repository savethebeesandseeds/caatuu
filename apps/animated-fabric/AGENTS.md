# AGENTS.md - Animated Fabric

These instructions govern all Codex work in this application.

## 1. Sources of truth

Read these files before writing code:

1. `AGENTS.md`
2. `docs/SPEC.md`
3. `docs/STATUS.md`

`docs/SPEC.md` is normative. Do not change an ADR without first recording the
replacement decision under `docs/decisions/` and explaining why it is needed.

## 2. Scope of each task

Work only on the tickets named by the user. Do not advance into later milestones,
even when doing so appears easy. Build the application as executable vertical slices.

Before changing files:

- identify the ticket;
- summarize the affected contracts;
- list any material ambiguity;
- use specification defaults unless a real blocker remains.

## 3. Authoritative development environment

Linux is the authoritative development and production environment. Run Python,
dependency installation, formatting, linting, type checking, tests, fixture generation,
rendering, background removal, and packaging inside the application's own Linux container.

- Build with `docker compose build animated-fabric-dev` from this directory.
- Run tools with `docker compose run --rm animated-fabric-dev <command>`.
- Use the `gui` profile for native-Linux X11 display forwarding; keep test services offscreen.
- Use only the documented cutout profiles for background removal and model provisioning.
- Do not install project dependencies on Windows.
- Do not use Codex-bundled Python, Node.js, or libraries for productive project work.
- Windows may invoke Docker, Git, and read-only inspection tools; it is not the reference runtime.
- Linux CI must exercise the same image and commands used locally.
- Keep this application isolated from Caatuu's other application containers.

## 4. Architecture boundaries

- Code, identifiers, documentation, CLI output, GUI text, and diagnostics are in English.
- `domain` performs no IO and imports no PySide6, OpenCV, or widgets.
- PySide6 may be imported only under `src/animated_fabric/gui`.
- GUI and CLI invoke the same use cases.
- Preview and export use the same renderer.
- Do not add a database, telemetry, or project-provided script execution.
- Original assets are immutable.
- Persisted paths are project-relative and use `/` separators.
- Layered PNG files remain the stable import boundary.
- Background removal is an optional, self-contained preprocessing capability. Its ML
  dependencies must remain separate from the base runtime and must not be imported by
  domain code or required for prepared PNG layers.
- Do not import code from a sibling Tukevejtso checkout at runtime. Any adopted method must
  be owned, documented, tested, and versioned within Animated Fabric.

## 5. Implementation quality

- Add tests with every non-trivial behavior.
- Use type hints on public APIs.
- Avoid `Any`; justify every unavoidable occurrence.
- Catch broad exceptions only at CLI, GUI, or worker process boundaries.
- Explain the purpose and license of every new dependency.
- Do not leave stubs that look like completed features.
- Do not duplicate logic for short-term convenience.
- Preserve determinism and stable ordering.
- Use atomic writes for project files, generated assets, and exports.

## 6. Required verification

Before declaring a ticket complete, run inside the Linux container:

```bash
ruff format --check .
ruff check .
mypy src
pytest -q
python -m pip check
```

When container infrastructure changes, also validate every Compose profile and smoke-test
the baked image without a source bind mount. When cutout code or packaging changes, build
and smoke-test at least the `cutout-classic` profile; CPU/CUDA verification is recorded
separately because those images are intentionally not base-development dependencies.

When a ticket affects rendering, animation, or export, also run:

```bash
python scripts/run_demo_pipeline.py --out .tmp/demo
```

Report actual results. Never claim that an unexecuted command passed.

## 7. Visual changes

Renderer changes require:

- a relevant unit test;
- a new or deliberately updated golden image;
- an explanation of the visual difference;
- confirmation that alpha and dimensions remain correct.

Never replace golden files merely to silence a failing test.

## 8. Data and schemas

- Every persisted file includes `schema_version`.
- An incompatible change requires migration and backup.
- Do not rename normative bones, parts, sockets, or properties without migration.
- Write JSON as UTF-8 with 2-space indentation and a final newline.

## 9. Security and errors

- Reject path traversal and links outside the project root.
- Limit image dimensions and counts.
- Convert expected failures into `Diagnostic` values.
- Use typed exceptions for unrecoverable failures.
- Preserve actionable warnings.

## 10. Status documentation

At the end of a task, update `docs/STATUS.md` with:

- completed ticket;
- principal files;
- verification performed;
- known debt;
- next permitted ticket.

## 11. Final response format

```text
Ticket completed: AF-XXX

Changes:
- ...

Verification:
- command: actual result

Decisions or deviations:
- none / details

Remaining risks:
- ...

Next permitted ticket:
- AF-YYY
```
