# Codex repository instructions

## Required execution environment

- Use the repository's existing Docker containers for ML, embeddings, vector-database generation, image-processing utilities, model tooling, and other dependency-heavy build work.
- Read `README.md`, the relevant Compose file, and the repository scripts to identify the established container command before running the task.
- Do not install Python, PyTorch, Node.js, CUDA, image-processing packages, or project dependencies into the Windows host environment for this repository.
- The Windows host may be used for read-only inspection, Git operations, small text edits, and invoking the established Docker workflow.
- Do not substitute Codex's bundled Python or Node runtimes for a repository container build merely because those runtimes are available.
- If the required container is unavailable or the documented container workflow fails, stop and report the blocker instead of creating a host-side environment.

## Asset catalog work

- For asset moves driven by a keymap, perform the direct catalog operation first: filter the authoritative keymap, move the matching files, rewrite the affected keymaps, and validate exact file-to-key parity.
- Only expand into schema, runtime, or generated-artifact changes that the request explicitly requires, and run their generators in the repository container.

## Generated sprite-sheet splitting

- For generated sprite sheets, follow `C:\Work\tukevejtso\linux\scripts\images\SPRITE_SPLIT_REPACK.md` and use the established `tukevejtso` container workflow.
- Use `image_tool.sh sprite-split` and its object-aware masking, previews, and manifest validation instead of writing an ad-hoc host-side crop or background-removal script.
- Treat source sheets as read-only, keep generated split/repack/preview folders isolated, inspect the previews, verify the expected sprite count, and require an empty warning list before integrating frames.
- Do not install splitter dependencies into Windows. If the Tukevejtso container lacks a required dependency, inspect its documented managed environment or report the container problem before rebuilding or changing dependencies.

## Image generation is an intermediate pipeline step

- Do not treat a successful image-generation call as task completion unless the user explicitly asked for only a standalone image.
- For animation and sprite work, continue through the remaining approved pipeline: preserve the generated source, split it with the documented Tukevejtso workflow, normalize and register the frames, update the demo or manifest, reload the served page, inspect the complete sequence in motion and frame-by-frame, and correct any problems found.
- Keep motion-reference approval separate from character transfer. Do not generate the target character while the user is still reviewing or refining the human pose authority.
- A generated image is not considered integrated or validated merely because it looks good in isolation.

## Repository organization

- Keep the repository root limited to project entrypoints, Git configuration,
  the license, the changelog, and the root README.
- Put project-wide technical and governance documentation under `docs/`.
- Put GitHub community files and workflows under `.github/`.
- Keep component-specific instructions beside the component they govern.
- Do not commit raw demo research sources, generated candidate workspaces,
  model caches, build artifacts, secrets, or dependency directories.
- Run `tools/repository/check-tracked-files.mjs` and
  `tools/repository/check-markdown-links.mjs` in a Node container before
  committing structural or documentation changes.

## Android public preview publication practices

- Prefer the canonical publisher for a routine Android publication:
  `docker exec -w /workspace caatuu-dev bash apps/android/tooling/publish-public-debug.sh`.
- The publisher already performs the public build, signing-lineage checks,
  immutable release checks, public download verification, and runtime-boundary
  audit. Avoid repeating that work unless the publisher reports a problem or
  the task specifically calls for independent verification.
- Run focused source tests before publication. A separate local APK build is
  usually unnecessary when the publisher will immediately build the same
  source, but it can still be useful for local delivery or device testing.
- After a successful routine publication, a lightweight read of
  `/android/caatuu-debug.json` is normally enough to report the public version
  and URL.
- If the terminal stops waiting while publication continues, first inspect the
  existing process and output. Reuse its result when possible instead of
  immediately starting another build or verification pass.
- Use judgment: extra checks are appropriate after publication-tool changes,
  ambiguous or incomplete output, signing concerns, artifact mismatch, or an
  explicit request for deeper release validation.
- Keep version monotonicity, immutable release paths, certificate pinning, and
  the publisher's built-in safeguards intact.
