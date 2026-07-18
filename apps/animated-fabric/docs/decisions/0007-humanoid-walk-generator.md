# 0007: Humanoid walk generator

- Status: accepted
- Date: 2026-07-18
- Ticket: AF-042

## Context

AF-042 adds the second concrete animation generator. Section 12.3 of the specification is normative
for the generator identity, nine parameter defaults, eight conceptual curves, two foot-contact
events, and the absence of an IK requirement. The section deliberately describes knee bend and foot
lift only as applying primarily during a leg's forward phase. It does not define their exact bone
channels, signs, phase samples, integer rounding, or declaration order.

The persisted format accepts integer key and event times, while `duration_ms` need not divide evenly
by four. The parameter table supplies defaults but no recommended ranges or maximum values. AF-040
already owns key normalization, implicit loop closure, event sorting, and rig-aware clip validation;
the walk generator must not compete with those contracts or take on AF-043 publication behavior.

AF-041 also established hardened validation behavior for generator parameters and rigs. Copying that
security boundary into each generator would allow their rejection rules and value-leak protections to
drift. The second generator is the point at which those mechanical concerns should become private
shared support, while motion tables remain explicit in their owning generator.

## Decision

`humanoid_walk_v1` is a pure, deterministic generator with `template_id="humanoid_v1"`. It follows
the section 12.1 direct-return contract and uses `AnimationClipBuilder` to produce its final
`AnimationClip`. It does not perform IO or mutate its rig or parameter inputs.

The generated artifact has fixed identity and presentation defaults:

- `clip_id="walk"` and `display_name="Walk"`;
- `loop=true` and `fps_hint=12`;
- `generator_id="humanoid_walk_v1"`; and
- `animations/walk.animated-clip.json` as diagnostic context only.

The diagnostic path is never a publication destination. Builder failure is reported as one fixed,
sanitized animation invariant failure; submitted parameter values, nested rig values, Pydantic
details, and builder diagnostic messages are not exposed.

### Parameters and validation

The strict frozen parameter model contains the following fields and specification defaults:

| Parameter | Default |
|---|---:|
| `duration_ms` | 800 |
| `step_angle_deg` | 18.0 |
| `knee_bend_deg` | 12.0 |
| `arm_swing_deg` | 12.0 |
| `torso_bob_y_px` | 2.0 |
| `torso_sway_x_px` | 1.0 |
| `pelvis_tilt_deg` | 2.0 |
| `head_counter_deg` | 1.5 |
| `foot_lift_px` | 2.0 |

`duration_ms` is a strict integer of at least 4 so all four authored phase times remain distinct.
The eight amplitudes accept finite non-negative Python integers or floats and are stored as canonical
floats; booleans, strings, non-finite values, and negative values are rejected. Exact zero is stored
as positive `0.0`. Unknown fields and coercion are rejected. The specification gives no recommended
ranges for this generator, so AF-042 does not invent schema metadata or hard maximum values.

Both generators use private shared support for the strict frozen parameter configuration, finite
non-negative float canonicalization, sanitized parameter-field errors, and complete detached
`RigDefinition` revalidation. AF-042 may refactor AF-041 onto that support without changing idle
behavior. Generator-specific effective-parameter reconstruction, provenance, motion coefficients,
track order, and clip identity remain local and explicit.

This shared support is a closed idle/walk public-boundary defense, not a plugin extension point.
Built-in numeric subclasses are canonicalized through non-polymorphic base conversion rather than
an overridden conversion callback. Exceptions raised by arbitrary raw-`Mapping` callbacks or error
inspection callbacks become fixed generic `AnimationError` messages without chained causes.
Generator-parameter model subclasses and `RigDefinition` subclasses are rejected before overridden
model callbacks can run. Exact `RigDefinition` instances are dumped non-polymorphically through the
base model method and then strictly revalidated into detached effective rigs.

### Phase schedule and tracks

For `k` in `0, 1, 2, 3`, the authored time is the cumulative integer-floor quarter:

```text
t_k = floor(k * duration_ms / 4)
```

All 12 tracks are bone delta tracks. They are declared in the exact order below, and every authored
key uses smooth interpolation. Each table entry is multiplied by the named effective parameter.
Coefficients are literal constants; the generator does not evaluate trigonometric functions at
runtime.

| Order | Track | Parameter | `t_0` | `t_1` | `t_2` | `t_3` |
|---:|---|---|---:|---:|---:|---:|
| 1 | `thigh_l.rotation_deg` | `step_angle_deg` | 0 | 1 | 0 | -1 |
| 2 | `thigh_r.rotation_deg` | `step_angle_deg` | 0 | -1 | 0 | 1 |
| 3 | `upper_arm_l.rotation_deg` | `arm_swing_deg` | 0 | -1 | 0 | 1 |
| 4 | `upper_arm_r.rotation_deg` | `arm_swing_deg` | 0 | 1 | 0 | -1 |
| 5 | `pelvis.rotation_deg` | `pelvis_tilt_deg` | 0 | 1 | 0 | -1 |
| 6 | `torso.position_y` | `torso_bob_y_px` | 0 | -1 | 0 | -1 |
| 7 | `pelvis.position_x` | `torso_sway_x_px` | 0 | 1 | 0 | -1 |
| 8 | `head.rotation_deg` | `head_counter_deg` | 0 | -1 | 0 | 1 |
| 9 | `shin_l.rotation_deg` | `knee_bend_deg` | 0 | -1 | 0 | 0 |
| 10 | `shin_r.rotation_deg` | `knee_bend_deg` | 0 | 0 | 0 | -1 |
| 11 | `foot_l.position_y` | `foot_lift_px` | 0 | -1 | 0 | 0 |
| 12 | `foot_r.position_y` | `foot_lift_px` | 0 | 0 | 0 | -1 |

The left leg's forward wave peaks at `t_1`; the right leg's forward wave peaks at `t_3`. During its
forward peak, each shin receives a negative local counter-bend and the corresponding foot receives a
negative local-Y lift. This is a deliberately simple FK motion: AF-042 does not add IK, planted-foot
constraints, ground collision, stride translation, or automatic gait correction.

Only the four authored keys are passed to AF-040. The builder appends the duration endpoint from the
first value and owns the closing interpolation segment. Exact zero coefficients and zero amplitudes
produce canonical positive `0.0`.

### Events and provenance

The event tuple is fixed:

- `foot_contact_l` at `t_0`, which is 0 ms; and
- `foot_contact_r` at `t_2`, calculated as `floor(2 * duration_ms / 4)`.

The cumulative-floor rule therefore defines the right-contact time for odd durations without
requiring an even-duration constraint. Events are metadata and do not alter rendered pixels. The
builder retains responsibility for stable event ordering and validation.

Generator provenance records all nine effective parameter values, including defaults. The builder
detaches and canonicalizes the provenance map so future default changes cannot alter the meaning of
an existing generated clip.

### Visible proof

Acceptance uses the owned generated `stick_humanoid` project, imports both authored directions, and
applies `humanoid_v1` to obtain the real 17-bone rig. A Linux-only candidate demo generates the walk
clip in memory and renders all four authored phases for SE and NE without saving an animation file or
changing the project manifest. The idle and walk demos may share a private full-rig bootstrap and
render helper; that helper is not application API and does not publish clips.

Six reviewed golden frames cover SE and NE at `t_0`, `t_1`, and `t_2`, matching the AF-042
acceptance text. With the fixed coefficient table, `t_0` and `t_2` are expected to be pixel-identical
for a given direction. Both remain reviewed because they represent distinct contact phases; tests
separately assert `foot_contact_l` at `t_0` and `foot_contact_r` at `t_2`. Numeric tests cover `t_3`
and the right-leg forward wave even though AF-042 does not require a reviewed `t_3` golden.

### Deferred work

AF-042 does not add a generator registry, dynamic discovery, `AnimationGenerator` registry
protocols, `GeneratorSummary`, parameter-schema presentation, `GenerateAnimation`, user-selected
clip names or destinations, animation persistence, manifest registration, create-versus-replace
policy, transactions, CLI commands, or GUI controls. Those remain AF-043. Export sampling and
spritesheet publication remain AF-050 and later work.

## Consequences

- Walk output is deterministic for all valid integer durations, including odd durations.
- The exact coefficient table makes knee, foot, and counter-motion semantics testable without
  platform-dependent trigonometric residuals.
- Four authored phases and AF-040 loop closure provide a simple editable FK gait without implying IK.
- Shared private validation keeps idle and walk rejection behavior aligned without coupling their
  motion definitions.
- The full-rig demo proves both authored directions while remaining read-only with respect to
  animation publication.
- AF-043 retains one clear ownership boundary for discovery, naming, persistence, replacement, and
  presentation.
