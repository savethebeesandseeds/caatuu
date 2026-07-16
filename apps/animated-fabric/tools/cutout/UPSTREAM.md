# Cutout upstream record

This directory is an owned adaptation of the proven Tukevejtso cutout engine.
Animated Fabric never imports a sibling checkout at runtime.

## Source

- Repository URL: <https://github.com/savethebeesandseeds/tukevejtso.git>
- Local source checkout: `C:\Work\tukevejtso`
- Source commit used for this import: `e4990e59bfe2fa13be0e8f4d3e0355c8bd147169`
- Original cutout-engine introduction commit: `906eefbc0314b2c0f02eda99c1310eb34c423dd9`
- Source directory: `linux/scripts/images/cutout_engine/`
- Source license: MIT, retained as `LICENSE.tukevejtso`

Copied and adapted modules:

- `__init__.py`, `__main__.py`, `cli.py`, `dependencies.py`, `errors.py`
- `image_io.py`, `pipeline.py`, `postprocess.py`, `types.py`
- `providers/__init__.py`, `providers/classic.py`, `providers/birefnet.py`

The Tukevejtso GUI scaffold was intentionally not copied. Animated Fabric owns its
GUI separately, and the optional cutout runtime must not add PySide6 to its classic
or ML dependency layers.

## Local modifications

- Rebranded paths and operator text for Animated Fabric.
- Added immutable BiRefNet revision selection and offline-only inference.
- Added an explicit network-enabled `prefetch` command.
- Added atomic PNG/JSON writes and stricter batch path boundaries.
- Added model-cache diagnostics, dependency layers, tests, and license notices.
- Removed unrelated ImageMagick, FFmpeg, GUI, and planned-provider reporting.

## Repeatable sync and review

From a Linux shell with both repositories available:

```bash
upstream=/workspace/tukevejtso/linux/scripts/images/cutout_engine
local=/workspace/caatuu/apps/animated-fabric/tools/cutout

git -C /workspace/tukevejtso show \
  e4990e59bfe2fa13be0e8f4d3e0355c8bd147169:linux/scripts/images/cutout_engine/providers/classic.py \
  >/tmp/tukevejtso-classic.py
diff -u /tmp/tukevejtso-classic.py "$local/providers/classic.py" || true

diff -ru \
  --exclude='__pycache__' \
  --exclude='gui.py' \
  --exclude='README.md' \
  "$upstream" "$local" || true
```

For a future sync, first record the new upstream commit here, review the full diff,
port changes manually, and rerun the classic/offline and provider-contract tests.
Never copy caches, model weights, generated media, or Tukevejtso worktree changes.
