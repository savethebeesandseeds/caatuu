# Archived Godot adventure prototype

Status: **retired, repository-only**, September 6, 2026.

This archive preserves the earlier Godot 4.7.1 Memory Grove implementation:
the Quaternius humanoid, rigid AF-054 macaw costume, navigation, terrain renderer
and Web export pipeline. The selected macaw sprite adventure is preserved
separately as a [paused concept](../../../apps/games/lab/RESUME.md).

All 23 original source, tooling, documentation and license files were moved
here without content changes and verified against Git checkpoint
`934d9cde60308475fc5c5432d8cf29c809e0c172`. Paths below `source/` retain their
original repository-relative layout. [archive.json](archive.json) records each
original location and blob identity. The former root Compose service and volume
definitions are saved in `compose.godot.yaml`.

The old source README and commands describe that historical checkpoint.
**Do not run the archived build or treat its paths as current instructions.**
Its shared asset dependencies remain in the canonical repository; this is not
a runnable checkout. No additional repository, container or port was created.

Active routing no longer mounts the old Web bundle, and the root Compose file
no longer declares the retired export services. Existing generated exports,
Docker containers, images, volumes and caches were not deleted. The separately
maintained Animated Fabric application and shared scenery are unaffected.

To inspect historical source without changing the shared checkout, use:

```powershell
git show 934d9cde60308475fc5c5432d8cf29c809e0c172:apps/games/caatuu-game/project.godot
```

Any revival must be explicitly scoped in the canonical checkout on main,
review current dependencies and delivery boundaries, and avoid serving or
building from this archive.
