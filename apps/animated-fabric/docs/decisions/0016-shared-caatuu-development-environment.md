# ADR 0016: Shared Caatuu Development Environment

Status: accepted

Date: 2026-08-03

Supersedes: the development-environment and orchestration portions of the
original M0 container decision and any later ADR that assumes
`apps/animated-fabric/compose.yaml` is the Compose authority.

## Context

Animated Fabric was initially given an independent Compose project and a
source-bearing `animated-fabric-dev` container. Caatuu now has one canonical
checkout, one established development service, and explicit safeguards against
parallel environments becoming competing authorities.

## Decision

`C:\Work\caatuu` is the only source authority. The root `caatuu` Compose
project and its existing `caatuu-dev` service are the sole interactive
development environment for Animated Fabric.

Animated Fabric commands run with `docker exec` against the already-running
`caatuu-dev` container. A Python 3.12 tool environment is baked inside that
image at `/opt/animated-fabric`; it is not a project-local virtual environment
and is never installed into Windows.

The former `caatuu-animated-fabric` Compose project and
`caatuu-animated-fabric-dev` container are retired.

Cutout, Blender, and reconstruction may retain narrowly mounted, non-source
worker images because their dependency and security contracts are mutually
incompatible with the interactive development environment. Their definitions
must belong to the root `caatuu` Compose project, remain opt-in, and never
become source authorities or interactive development containers.

## Consequences

Normal formatting, linting, type checking, tests, fixture generation, CLI use,
and packaging all use one canonical repository mount and one development
container. Specialist workers preserve their offline, read-only, non-root, and
resource-bounded contracts without creating another Compose project.
