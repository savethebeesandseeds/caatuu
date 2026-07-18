# 0006: Humanoid idle generator

- Status: accepted
- Date: 2026-07-18
- Ticket: AF-041

## Context

AF-041 introduces the first concrete animation generator. Section 12.1 of the specification gives
generators a direct `AnimationClip` return, while AF-040 provides the shared normalization and
validation builder. The idle formulas are specified as continuous trigonometric curves sampled at
four phases, but persisted key times are integer milliseconds and a duration need not divide evenly
by four.

The parameter table labels its intervals as recommended ranges rather than validity bounds. Treating
those intervals as hard constraints would reject finite authored motion that the specification does
not forbid. Direct trigonometric evaluation at the four known phases would also introduce tiny
non-zero residuals where the normative curve is exactly zero.

Clip publication remains a separate concern. A pure generator needs stable clip identity and a path
for AF-040 diagnostic locations, but it does not own a project destination, overwrite policy, or
manifest transaction.

## Decision

`humanoid_idle_v1` is a pure, deterministic generator with `template_id="humanoid_v1"`. It follows
the normative direct-return contract: validated parameters and a compatible rig produce an
`AnimationClip` directly. It reuses `AnimationClipBuilder`; an unexpected builder failure is an
animation invariant failure rather than a second implementation of normalization or validation.

The generated artifact has fixed identity and presentation defaults:

- `clip_id="idle"` and `display_name="Idle"`;
- `loop=true`, `fps_hint=12`, and no events; and
- `animations/idle.animated-clip.json` as diagnostic context only.

That path does not authorize IO and is not a publication destination. AF-043 may supply a different
user-selected clip identity and destination through its application use case.

The strict parameter model contains `duration_ms`, `breath_y_px`, `torso_rotation_deg`,
`head_counter_deg`, `arm_drift_deg`, and `pelvis_shift_px`. Missing values receive the section 12.2
defaults. Unknown fields, coercion, booleans in numeric fields, and non-finite values are rejected.
`duration_ms` must be at least 4 so the four authored phase times remain distinct. The
specification's recommended intervals are exposed as parameter metadata, not enforced as hard
bounds.

For phase index `k` in `0, 1, 2, 3`, the authored time is calculated with cumulative integer-floor
quarters:

```text
time_ms(k) = floor(k * duration_ms / 4)
```

All six tracks are bone delta tracks in the declaration order below. Every authored key uses smooth
interpolation. Values are produced from this exact coefficient table rather than runtime sine or
cosine calls:

| Track | Parameter | 0 | 1/4 | 1/2 | 3/4 |
|---|---|---:|---:|---:|---:|
| `torso.position_y` | `breath_y_px` | -1 | 0 | 1 | 0 |
| `torso.rotation_deg` | `torso_rotation_deg` | 0 | 1 | 0 | -1 |
| `head.rotation_deg` | `head_counter_deg` | 0 | -1 | 0 | 1 |
| `pelvis.position_x` | `pelvis_shift_px` | 0 | 1 | 0 | -1 |
| `upper_arm_l.rotation_deg` | `arm_drift_deg` | `sqrt(3)/2` | `1/2` | `-sqrt(3)/2` | `-1/2` |
| `upper_arm_r.rotation_deg` | `arm_drift_deg` | `-sqrt(3)/2` | `1/2` | `sqrt(3)/2` | `-1/2` |

Exact zero coefficients produce canonical positive `0.0`. AF-040 receives only the four authored
keys and synthesizes the duration endpoint from the first value; the idle generator does not add a
competing endpoint rule.

Generator provenance records all six effective parameter values, including defaults, so the clip
does not depend on future default changes for interpretation. The builder remains responsible for
detaching and canonicalizing that provenance.

Acceptance generates the owned `stick_humanoid` SE/NE layers, imports them into a fresh project,
and applies `humanoid_v1` to create the real 17-bone rig. It does not use the lightweight root-only
fixture adapter as animation authority. Four reviewed goldens cover SE and NE at time zero and the
first quarter. Numeric unit tests cover every authored phase, periodic closure,
non-quarter-divisible durations, strict parameters, provenance, and repeatability independently of
the renderer.

AF-041 does not add the generator registry, `GeneratorSummary`, parameter-schema presentation,
`GenerateAnimation`, persistence, manifest registration, replacement semantics, CLI, or GUI. Those
remain AF-043. Walk tracks and foot-contact events remain AF-042.

## Consequences

- The first generator stays independent of filesystem, template-resource, registry, CLI, and GUI
  adapters.
- Fixed phase coefficients avoid platform-dependent trigonometric residuals and signed-zero output.
- Finite values outside the recommended ranges remain representable; presentation surfaces may
  describe or warn about those ranges later without changing generator validity.
- Non-divisible durations have one documented, stable integer schedule and still receive the AF-040
  loop endpoint.
- The packaged template's compatible-generator list remains declarative and never selects code for
  dynamic import or execution.
- AF-043 retains ownership of user-selected clip names, paths, publication, and registry discovery.
