# OwlRunKit 0.20 Team Delivery Phase 1 Product Decision

Date: 2026-08-13
Status: `source_candidate_implemented_and_verified / initial_read_only_dogfood_passed / owner_release_authorized / registry_publication_pending`

## Decision

OwlRunKit 0.20 Phase 1 adds a read-only Team Delivery projection and portable
team packet contracts on top of the existing Project Driver. It does not add a
second task graph, start Agents, route vendors, dispatch work, or change Quick
or Formal assurance.

The product sequence is fixed:

1. publish and stabilize 0.19.2;
2. implement 0.20 Phase 1 as read-only recommendation plus native contracts;
3. dogfood it in at least two real projects;
4. only if measured net value is positive, ask the Owner whether opt-in assisted
   dispatch should be designed.

Steps 1 and 2 are complete through a repository source candidate. Step 3 has
started with read-only recommendation and status projection; transfer and
acceptance value have not yet been proven through a complete live lifecycle.
The Owner separately authorized the 0.20 publication transition after the
initial read-only dogfood. That authorization does not pre-authorize assisted
dispatch, project adoption, deployment, production, business, funds, or any
other permission transition.

## Current source-candidate evidence

- Focused Team Delivery and public-contract checks: 25 passed, 0 failed.
- Compatibility, CLI, project-local binding, and neighboring Formal checks:
  129 passed, 0 failed.
- Standalone pack, isolated install, initialization, Team packet validation,
  and Quick attestation: 6 passed, 0 failed.
- Complete RunKit gate: 853 tests, 841 passed, 0 failed, 12 skipped.
- Root build and production dependency audit passed; the production audit
  reported 0 vulnerabilities.
- Core, Skill candidate, package config, public attester, and distribution
  manifest resolve to
  `sha256:30098aa9344c17c1ed0b5ed45ef1c590b3214b824402f584029c1ecb38ca7a70`.

These facts establish a source candidate only. They do not establish dogfood
value, registry publication, project adoption, runtime activation, or release
authority.

## Initial read-only dogfood

The candidate was run directly against current Project Driver truth without
installing or modifying either target project.

- OwlFootball had one actionable owned lane and one dependency-blocked future
  lane. Recommendation: `off + project_driver`, assurance unchanged.
- The active Sierac MES control project had one actionable writer and several
  dependency-blocked future lanes. Recommendation: `off + project_driver`,
  assurance unchanged.
- A real Sierac MES parallel worktree had two simultaneously actionable,
  disjoint, unassigned lanes. Recommendation: `team + project_driver_team`,
  both lanes parallel-eligible, no path conflict, assurance unchanged.
- The first Team result exposed a self-referential `team status` next action.
  The candidate was corrected so unassigned actionable lanes now point to
  `project assign --help`; focused and complete gates were rerun afterward.
- For each directly tested project/worktree, the Project Driver tree
  fingerprint and Git status fingerprint were byte-identical before and after.
  Dispatch remained disabled and every authority field remained false.

This establishes correct initial admission and exit behavior. It does not yet
establish lower handoff time, candidate transfer value, independent acceptance
value, or eligibility for assisted dispatch.

## Verified starting facts

- `owlrunkit@0.19.2` is published and exact-registry verified.
- Project Driver already owns durable WorkItems, dependencies, owned paths,
  assignments, decisions, checkpoints, handoffs, rework, integration gates,
  source delivery, takeover, and project truth hashing.
- Usage Mode already keeps continuity and assurance separate.
- Quick and Formal already own evidence strength; multi-Agent work does not by
  itself imply Formal.
- The local `manage-agent-team` Skill contains useful operating policy, but it
  is not available on every machine and is not an acceptable product runtime
  dependency.
- Real dogfood shows Team coordination is useful for multiple writers,
  independent acceptance, candidate transfer, and cross-session ownership; it
  is negative value for ordinary single-owner closure.

## Stable product model

Team Delivery adds one orthogonal dimension:

```text
continuity   none | project_driver
coordination none | team_delivery
assurance    none | quick | formal
acceptance   L0 | L1 | L2 | L3
authority    always externally granted; never inferred by RunKit
```

`team_delivery` is a read-only coordination recommendation in Phase 1. It is
not a continuity mode, assurance level, acceptance verdict, or authority.

Project Driver remains the sole active project and task truth. Team Delivery
may project WorkItems into lanes, but it cannot create a parallel team/task
database or reinterpret project events.

## User-visible Phase 1 surface

```text
npx --no-install owlrunkit team recommend --workspace "$PWD"
npx --no-install owlrunkit team status --workspace "$PWD"
npx --no-install owlrunkit team packet validate --workspace "$PWD" --packet <file>
```

All commands are read-only and support `--json`. Human output is the default.
Every result includes the authority boundary and
`authorizationGranted=false`.

### `team recommend`

The recommendation is derived only from current Project Driver truth:

- no initialized project, no ready work, or one ordinary ready WorkItem:
  `off`;
- two or more simultaneously actionable WorkItems with disjoint owned paths:
  `team`;
- overlapping owned paths: `team`, but parallel writing is blocked and the
  unique next action is to revise ownership or serialize the lanes;
- a WorkItem in independent verification: `team`;
- a pending handoff, rework return, or live candidate ownership transfer:
  `team`;
- multiple active owners: `team`.

The result explains trigger reasons, rejected lighter handling, projected
overhead, path conflicts, acceptance gaps, and one next command. It never
chooses a model vendor or starts an Agent.

### `team status`

Status projects the current Project Driver into:

- current project identity and truth hash;
- incomplete lanes with current owner, dependencies, owned paths, and explicit
  actionable state;
- which lanes may run concurrently;
- path conflicts;
- independent-acceptance gaps;
- handoff, rework, and source-delivery continuity facts;
- the current Team recommendation and unique coordination next action.

The next command must not loop back to `team status`. An unassigned actionable
lane points to assignment help, a path conflict points to immutable scope
revision help, an owner transition points to takeover help, and an already
owned Team candidate points to portable packet validation help.

It does not copy or persist a second task graph.

### `team packet validate`

The validator accepts one bounded regular non-symlink JSON file, rejects
duplicate keys and extra fields, validates the native packet contract, and
binds project-aware packets to the current `projectId`, `projectTruthHash`,
WorkItem, and owned paths. Validation performs no packet creation or project
mutation.

## Native portable contracts

Phase 1 publishes three strict Draft 2020-12 contracts and matching runtime
validators.

### TeamTaskPacket V2

The task packet binds one Project Driver WorkItem and Gate. It carries:

- actual launcher-declared Agent, model family, and model version;
- risk axes and required acceptance level;
- exact worktree and candidate-entry identity;
- allowed and prohibited paths/actions;
- evidence plan, verification cadence, handoff requirement, escalation budget,
  and exact stop point;
- project identity and project truth hash;
- an explicit all-false authority boundary.

Model family is opaque declared identity. Core does not contain Sol, Luna,
Grok, Kimi, capacity ratios, retries, or routing preferences.

### TeamAcceptancePacket V2

The acceptance packet binds one Gate and candidate, records implementation and
verification identities, acceptance level, fresh adversarial families,
candidate identity before and after, evidence reuse, findings, verdict, and
remaining levels. Medium or high second-order risk cannot claim independent
acceptance when implementation and verification model families are equal.

`ACCEPT`, `REWORK`, and `BLOCKED` remain distinct. One packet accepts one Gate;
it does not grant the next external transition.

### CandidateTransferPacket V1

The transfer packet preserves a live candidate across writer ownership change:

```text
candidate_active
  -> transfer_requested
  -> packet_generated
  -> new_owner_validation
  -> handoff_ack
  -> old_writer_release
```

It binds candidate identity, dirty manifest, reconstruction sources, protected
artifacts, previous and next owner, verification state, and handoff ACK. A
packet at `old_writer_release` is invalid unless the new owner has accepted the
handoff with evidence. The packet does not itself assign Project Driver
authority or release the prior writer.

## Admission and exit rules

Team Mode is recommended only when coordination changes the outcome or critical
path. Parallelism being possible is insufficient.

The recommendation must explicitly exit Team Mode for a single authorized
owner with a bounded, reversible, directly verifiable task. Production or
release labels alone do not force Team Mode. Long duration alone selects
continuity, not coordination. Multiple Agents alone do not force Formal.

Path conflict does not authorize parallel writers. It creates a visible
coordination blocker.

## Acceptance scenarios

1. No Project Driver definition returns `off`, zero lanes, no dispatch, and no
   authority.
2. One ordinary ready WorkItem returns `off` even though Project Driver exists.
3. Two independent ready WorkItems with disjoint owned paths return `team` and
   both lanes are parallel-eligible.
4. Two actionable WorkItems with overlapping owned paths return `team`, expose
   the exact conflict, and mark both lanes non-parallel.
5. Independent verification, pending handoff/rework, candidate transfer, or
   multiple active owners recommends `team` without changing assurance.
6. `team recommend`, `team status`, and packet validation write zero project,
   source, Git, or RunKit bytes.
7. A valid TeamTaskPacket is bound to the current Project Driver WorkItem and
   owned paths; stale project truth or widened scope is rejected.
8. Same-family verification at medium/high second-order risk cannot claim
   independent acceptance.
9. Candidate transfer cannot reach `old_writer_release` before accepted
   handoff ACK with evidence.
10. Packet schemas and runtime validators reject missing, extra, duplicate-key,
    authority-looking, and malformed identity fields consistently.
11. Installed-package help, CLI JSON, public schemas, Core manifest, and the
    Skill describe the same Phase 1 surface without requiring the local
    `manage-agent-team` Skill.
12. No output authorizes Git, release, deployment, production, business,
    automation, money, credentials, or Agent dispatch.

## Phase 1 non-goals

- no automatic or assisted Agent launch;
- no vendor CLI federation or general swarm;
- no model ranking, scorecard, capacity allocation, retry policy, or
  model-specific prompt logic in Core;
- no second project/task graph;
- no packet generator that silently assigns ownership;
- no new Quick or Formal Gate;
- no replacement for COM-019 or any domain product decision;
- no 0.20 publication claim before a separately verified release transition.

## Dogfood Gate before assisted dispatch

At least two real projects must demonstrate all of the following:

- ordinary single-owner work reliably exits Team Mode;
- multiple writers and independent acceptance produce correct lanes, path
  conflicts, and independence gaps;
- a machine without the local Skill can validate and continue from the npm
  package and self-contained packets;
- writer transfer preserves the candidate through ACK;
- measured handoff time, controller intervention, or duplicate verification
  decreases;
- the benefit is not merely more packets or receipts.

Only after these facts exist may the Owner decide whether to design opt-in
assisted dispatch. General automatic federation remains a separate product and
authority decision.

## What cannot be claimed now

- 0.20 has not completed transfer or independent-acceptance dogfood and has not
  yet been committed, tagged, registry-published, adopted, or made active;
  source-candidate verification is not registry publication proof.
- Team Delivery does not dispatch or supervise Agents.
- The local Skill is not part of the product runtime contract.
- Team recommendation is not acceptance or authority.
- Phase 1 is not the selected COM-019 Primary AI Value Loop.
- No business, production, deployment, or release outcome follows from this
  product decision.
