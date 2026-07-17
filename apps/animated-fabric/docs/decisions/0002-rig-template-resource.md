# 0002: Built-in rig-template resource format

- Status: accepted
- Date: 2026-07-17
- Ticket: AF-031

## Context

The specification requires `RigTemplateRegistry` to load built-in JSON templates and lists the
facts each template must declare, but it does not define the resource schema. It also does not
provide complete humanoid bone transforms, socket transforms, part draw-slot assignments, or
direction-specific slot profiles. Those behaviors belong to template application in AF-032.

## Decision

Built-in templates use the strict format `animated-fabric.rig-template.v1` and the stable `0.1.x`
schema family. A resource declares immutable ordered records for bones, required and optional
parts with their default bones, import alias groups, socket identities with default bones and
slots, a global draw-slot inventory, compatible generator IDs, numeric limits, and matching
initial values. Every reference is validated eagerly and templates contain no module names,
callbacks, expressions, or other executable configuration.

The registry reads an explicit package-owned filename list through `importlib.resources`; callers
cannot select a file path. Resources are bounded before decoding, must be unambiguous UTF-8 JSON,
and must use `<template_id>.json`. Registry listing is sorted by `template_id`, while declaration
order inside each template is preserved.

For `humanoid_v1`, the part-to-bone relationships follow the normative semantic names. The socket
bone and slot defaults extend the one complete `head_hat` example consistently. The numeric values
record the specified 192 px canvas, `[96, 160]` anchor, 2048 px safety ceiling, and a deliberately
chosen 8 px joint overlap within the recommended 6 to 12 px range. The 15 slots from section 10.1
are an inventory only; AF-032 remains responsible for constructing actual SE and NE profiles and
proportional bone placement.

Invalid installed resources and unknown IDs raise `RigDefinitionError`. A later use case may map
expected user-selection failures to diagnostics. AF-030's injectable alias table is not rewired in
this ticket, and the existing fixture rig is not reinterpreted through the registry.

## Consequences

- Installed distributions contain self-contained, deterministic template data.
- AF-032 can consume validated anatomy without loading arbitrary files or executing template code.
- Direction-specific ordering, bone transforms, pivots, bindings, and rig persistence remain
  explicit AF-032 work.
- Adding `quadruped_v1` remains AF-080 and requires a separate reviewed resource.
