# Archived Codex kickoff - Milestone M0

Milestone M0 is complete. This prompt is retained as an English bootstrap record; do not
rerun it against the current tree or use it to authorize M1 work.

Paste the following prompt into Codex from `apps/animated-fabric`:

```text
We are starting Animated Fabric.

Read AGENTS.md, docs/SPEC.md, and docs/STATUS.md first. The specification is normative.
Do not attempt to build the entire application in this task.

Implement only Milestone M0, tickets AF-001, AF-002, and AF-003.

Delivery objectives:
1. Create an installable Python package named animated_fabric with a Python 3.12 baseline.
2. Add pyproject.toml with the runtime and development dependencies from the specification.
3. Create a Typer CLI with `version` and `doctor`, plus
   `python -m animated_fabric --help`.
4. Create a minimal PySide6 GUI whose window title is "Animated Fabric", with no domain logic.
5. Implement Diagnostic, Severity, and OperationResult with tests.
6. Create typed base exceptions.
7. Create scripts/generate_fixture_assets.py to produce deterministic geometric PNG layers
   for a humanoid in SE and NE without external assets.
8. Configure Ruff, mypy, pytest, coverage, and initial Linux CI.
9. Create README.md and update docs/STATUS.md when complete.

Constraints:
- Do not implement rig models, a renderer, a real importer, or animation yet.
- Do not add runtime networking or a database.
- Do not import PySide6 outside src/animated_fabric/gui.
- Keep code, identifiers, documentation, CLI output, and GUI text in English.
- Run all Python and build commands inside the dedicated Linux container.
- Do not install project dependencies on Windows or use Codex-bundled runtimes.
- Add tests for every non-trivial behavior.

Before changing files, summarize the plan and contracts in fewer than 12 lines. Then implement.

When finished, run inside the Linux container:
ruff format --check .
ruff check .
mypy src
pytest -q
python scripts/generate_fixture_assets.py --out .tmp/fixtures
python -m animated_fabric doctor

Report actual results, principal files, and any deviation. Do not advance into M1.
```

## Expected M0 result

The application installs inside its dedicated Linux container, displays CLI help, opens a
minimal GUI, generates its own PNG fixtures, and passes formatting, linting, type checking,
and tests. It does not yet contain a functional renderer.
