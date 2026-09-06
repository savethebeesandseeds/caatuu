# External splitter compatibility record

[tukevejtso-empty-slots.patch](tukevejtso-empty-slots.patch) preserves the
Tukevejtso splitter change used for the five-pose macaw sheets. It adds the
explicit `--empty-slots` option, validation and focused tests to that external
repository. It was applied and tested in the existing managed image container
during this workflow. This copy records that dependency change; Caatuu's preview
publisher does not apply it or modify the external checkout.

Before regeneration, inspect the current Tukevejtso guide and implementation.
If it already supports `--empty-slots`, use that version without reapplying the
patch. If it does not, review the external repository's state and applicable
instructions before integrating this change. Do not rebuild the container or
install host packages to work around the option.
