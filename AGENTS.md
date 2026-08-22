# Codex repository instructions

## Main-only Git policy (highest priority; explicit user safety requirement)

- `main` is the only permitted branch for this repository, both locally and on every remote. This explicit user safety requirement overrides any general Codex convention to create `codex/*`, `agent/*`, task, feature, release, recovery, temporary, pull-request, or integration branches.
- Never create a new branch by any method. This prohibition includes `git branch`, `git switch -c`, `git checkout -b`, `git worktree add -b`, Git hosting or pull-request tools that create branches, and any equivalent command, API, automation, helper, or subagent action.
- Never ask or allow another agent, session, tool, script, IDE, or hosting service to create a branch on Codex's behalf. Do not create a branch for isolation, experimentation, parallel work, releases, recovery, publication, or temporary storage.
- Perform all authorized repository work directly in the canonical `C:\Work\caatuu` checkout on `main`. Before any file write, commit, publication, or other mutation, verify all of the following: `git branch --show-current` returns exactly `main`; `refs/heads` contains only `refs/heads/main`; no non-`main` remote-tracking branch exists (a remote's symbolic `HEAD` is not a branch); and no other worktree is being used. If any check fails, stop before modifying the project, report the exact mismatch and branch names to the user, and wait for explicit consolidation direction.
- Never finish a task with commits or changes that exist only on a non-`main` branch. Before handing off completed work, verify and report any non-`main` local or remote branches discovered; do not silently leave branch cleanup for the user.
- If non-`main` branches already exist, treat them as a safety incident and recovery material. Do not automatically merge, rebase, cherry-pick, rewrite, switch branches, or delete refs. One explicitly assigned integration owner must inspect them, consolidate all wanted work into `main`, validate `main`, obtain the user's confirmation, and only then delete the exact branches the user explicitly authorizes.
- A workflow that requires a branch is blocked for this repository. Stop and report that requirement instead of bypassing this policy or selecting an alternate workflow.
- Branch creation remains forbidden unless the user first gives a new, explicit instruction that specifically changes this main-only policy. A request to implement a feature, fix a bug, publish, commit, open a pull request, or "handle everything" is not permission to create a branch.

## Canonical workspace and shared-session safety

- `C:\Work\caatuu` is the sole canonical local checkout and source of truth for Caatuu implementation, integration, serving, and validation.
- Do not create or use alternate clones, Git worktrees, mirrored source directories, copied bundles, or parallel repositories unless the user explicitly authorizes that exact isolation strategy.
- Do not serve or validate Caatuu from a noncanonical checkout. Reuse the established `caatuu` and `caatuu-dev` services and port `8765`; do not create additional containers, Compose projects, preview services, or ports without explicit user authorization.
- Before implementation or validation, verify the repository path and relevant container bind mounts. A path, branch, mount, service, or source mismatch is a hard stop for coordination, not a reason to create a parallel environment.
- Treat the canonical worktree as shared by concurrent Codex sessions. Every pre-existing modified, staged, or untracked path belongs to the user or another session unless the current task created it deliberately.
- Never relocate shared work to another checkout. Do not run repository-wide `git add`, `git stash`, `git reset`, `git clean`, `git checkout`, `git switch`, `git restore`, `git merge`, `git rebase`, or `git cherry-pick` in a shared dirty tree without explicit authorization and one assigned integration owner.
- Stage only the current task's verified paths. Before integrating separately committed work, first preserve and checkpoint the canonical shared state, inspect overlaps, use one integration owner, and validate the existing application before cleanup.
- Preserve recovery stashes, branches, and worktrees until the user has validated the final integrated state and explicitly authorized cleanup.

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
- Treat repeatable Android build and publication work as a maintained pipeline,
  not session-specific knowledge. When a publish requires recurring manual
  reasoning, command sequences, or recovery steps, improve the canonical
  publisher, its focused contract tests, and the adjacent tooling README so the
  next routine publish remains one documented command. Extend that entrypoint
  instead of creating alternate build scripts or duplicating its safeguards.
- Keep the routine path intentionally small: confirm the relevant source state,
  increment the monotonic preview version, run focused tests for the changed
  boundary, invoke the canonical publisher once, and report its manifest. Fold
  any repeatedly useful verification into the publisher rather than making
  every agent rediscover and rerun it.
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
