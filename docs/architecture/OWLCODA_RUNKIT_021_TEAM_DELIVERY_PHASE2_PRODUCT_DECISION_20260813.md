# OwlRunKit 0.21 Team Delivery Phase 2 Product Decision

Date: 2026-08-13
Status: `product_contract_definition / implementation_and_release_truth_tracked_separately`

## Decision

OwlRunKit 0.21 extends the existing Project Driver and read-only Team Delivery
projection with two missing kinds of durable truth:

1. typed external Gates produced by domain-owned adapters; and
2. an evidence-bound delivery lifecycle that keeps source acceptance,
   integration, materialization, deployment, live readback, and product acceptance separate.

Project Driver remains the only active task graph. Phase 2 does not add a
scheduler, start an Agent, select a model, increase assurance, parse arbitrary
domain documents, or grant Git, release, deployment, production, or business
authority.

The implementation order is fixed:

1. ExternalGateV1 plus DeliveryLifecycleV1 contracts and read-only projection;
2. explicit Quick-receipt binding for WorkItems that declare an evidence
   requirement;
3. inventory of explicit candidate artifacts not yet represented as active
   WorkItem lanes; and
4. copyable fleet Skill dry-run, install, and rollback plans.

The OwlFootball 0.20 dogfood adds three bounded Phase 2 corrections to the
same release: a canonical candidate identity, controller-owned verification of
a frozen foreign worktree, and explicit Doctor visibility for package/shared
Skill drift. Commit-rebinding remains a separate future receipt contract and
is not implied by these additions.

Assisted or automatic Agent dispatch is not part of 0.21. It requires a later
Owner decision after real dogfood demonstrates lower handoff time or lower
controller intervention.

## Stable product model

The independent dimensions remain:

```text
continuity   none | project_driver
coordination none | team_delivery
assurance    none | quick | formal
acceptance   L0 | L1 | L2 | L3
authority    externally granted; never inferred by RunKit
```

Phase 2 adds delivery state without folding it into those dimensions:

```text
work ledger
  -> source accepted
  -> integrated
  -> materialized
  -> deployed
  -> live readback
  -> product accepted
```

Every arrow requires a new append-only fact and evidence. A passed source Gate
does not imply integration. Integration does not imply a sealed or built
artifact. Materialization does not imply deployment. Deployment does not imply
a healthy readback. A healthy readback does not imply product or business
acceptance.

## ExternalGateV1

RunKit does not know what an OwlFootball packaging Gate, a MES runtime Gate, or
another domain decision means. The domain product owns that judgment. A
domain-owned adapter may emit one strict generic Gate observation containing:

- a stable Gate identity and title;
- the delivery stage that requires it;
- `pending`, `passed`, `blocked`, or `deferred` status;
- the responsible Agent;
- adapter identity, source reference, and exact SHA-256 source digest;
- a concise summary and evidence references; and
- an all-false authority boundary.

The typed Project Driver command records the observation as an immutable event.
A later observation must explicitly supersede the current observation for that
Gate. RunKit validates the structure and source binding; it does not parse or
reinterpret the domain source.

An unresolved external Gate is visible throughout status projection. Once the
work ledger is otherwise ready for the Gate's delivery stage, that Gate becomes
the dominant gap and replaces any misleading execution next action.

## DeliveryLifecycleV1

The lifecycle contains six fixed stages:

| Stage | Positive fact | Other honest outcomes |
|---|---|---|
| source | `accepted` | `rejected` |
| integration | `integrated` | `rejected` |
| materialization | `materialized` | `failed` |
| deployment | `deployed` | `failed`, `rolled_back` |
| live readback | `passed` | `failed` |
| product acceptance | `accepted` | `rejected`, `deferred` |

A lifecycle record binds one stage, outcome, responsible Agent, evidence, and
the external Gates used for that transition. The current projection includes
all six stages, the highest positively established stage, the next required
stage, any blocking stage, and unresolved external Gates.

The runtime enforces ordering. It rejects integration before source acceptance,
materialization before integration, deployment before materialization, live
readback before deployment, and product acceptance before a passed live
readback. A later correction for the same stage
must supersede the current stage record. A correction cannot silently rewrite
downstream facts.

Recording a deployed or accepted fact is evidence bookkeeping only. Every
result continues to carry `authorizationGranted=false` and cannot authorize the
underlying action.

## Versioning and compatibility

Published predecessor contracts are immutable:

- TeamProject Event V1-V5 retain their existing bytes and meanings;
- TeamProject Status V1-V3 retain their existing fields and projections; and
- Team Delivery Status V1 retains its Phase 1 surface.

Phase 2 uses successor contracts:

- TeamProject Event V6 for external Gate and delivery lifecycle facts;
- TeamProject Event V7 for WorkItem evidence policy and receipt-bound
  checkpoint facts;
- TeamProject Status V4 for ExternalGateV1 and DeliveryLifecycleV1 projection;
- Team Delivery Status V2 for the corresponding read-only Team view.

Raw generic capture may not create V6 or V7 facts. Operators use typed commands so
the current Gate, lifecycle ordering, source binding, and exact retry rules are
checked before the event is written.

## Receipt binding

Phase 2 adds `project work-item require-evidence` and
`project checkpoint --from-quick-receipt`. The WorkItem policy is append-only
and may select `none` or `quick`; it does not represent Formal acceptance.
Receipt binding attests the current Quick receipt and persists an immutable
reference. It becomes blocking only when the WorkItem contract explicitly
requires Quick evidence. Existing WorkItems, measurable work, and
assurance=`none` are not retroactively upgraded to Quick or Formal.

## Explicit candidate inventory

Team Delivery may report `unmodeled_candidate_lanes` only from artifacts RunKit
can identify explicitly, such as a verified DeliveryPacket, target snapshot,
data-candidate event, or external Gate. It may not infer a candidate from an
arbitrary dirty worktree or create a second task graph.

The inventory is read-only. Turning an artifact into active Project Driver work
requires a separate typed project action and authority.

## Fleet Skill operations

Shared Skill drift remains non-blocking for a project-local CLI unless an exact
project contract says otherwise. A fleet plan may show affected projects and
copyable dry-run, install, and rollback commands. It may not silently update a
shared Skill while any project has an active execution or lease.

## Canonical candidate identity

The primary dirty-candidate identity is a canonical ordered ledger, not a raw
`git diff` digest. It records the target HEAD and tracked tree plus every
changed path, prior rename path, operation, Git status, file kind, mode, byte
length, and content SHA-256. Discovery uses `LC_ALL=C`, disables optional Git
locks, and fixes `core.abbrev=40`; the command, environment, Git version,
ledger byte length, ledger hash, and candidate fingerprint are persisted.

The full-index binary diff remains available as a transport artifact with a
fixed command, but its digest is explicitly not the candidate identity.

## Controller-owned Foreign Quick

`quick-verify --workspace <controller> --foreign-workspace <target>` keeps the
project-local CLI and every RunKit artifact in the controller. The target must
be a separate real Git worktree root. RunKit copies its visible source into a
disposable consumer, optionally projects an already-installed disjoint
dependency root, and binds Quick Receipt V4 to the target's canonical candidate
and bounded filesystem identities before and after execution.

The current resolver remains fail-closed: a controller CLI may not masquerade
as the target's older or absent project-local CLI. `zeroWriteObserved` means
the governed target state matched before and after; RunKit does not claim an OS
write sandbox or prove that a transient write restored before the second
observation never occurred.

## Doctor Skill drift

Doctor reports package-bound and discovered process-wide Skill versions and absolute
paths. A mismatch is a visible non-blocking warning when the project-local CLI
and Core are valid. RunKit cannot observe which instruction bytes an existing
Agent process loaded, so `loadedSkillVersion` remains `unknown` and the repair
guidance starts a new session using the package-bound Skill. Fleet mutation
still requires the separate safe plan/install boundary.

## Acceptance scenarios

1. A typed pending external Gate is projected with its source hash, blocks the
   relevant delivery stage, and becomes the unique dominant gap when due.
2. A later exact superseding observation may pass the Gate; stale, duplicate,
   or source-unbound observations fail closed.
3. Source, integration, materialization, deployment, live readback, and product acceptance each
   require a separate evidence-bound event and never auto-promote.
4. Out-of-order lifecycle facts, unresolved required external Gates, and
   attempts to revise an earlier stage beneath downstream truth fail before
   writing.
5. Status V1-V3 and Team Delivery Status V1 remain unchanged; V4/V2 expose the
   new fields under new schema identities.
6. Raw project capture cannot bypass typed V6 intake.
7. Team and Project status remain read-only and dispatch remains disabled.
8. No result grants Git, release, deployment, production, business, automation,
   money, credential, or Agent-dispatch authority.
9. Quick-receipt binding never forces assurance on an existing WorkItem that
   did not explicitly require it.
10. Candidate inventory is derived only from explicit artifacts and does not
    infer arbitrary dirty-worktree truth.
11. Canonical candidate identity remains byte-stable when only Git object
    abbreviation settings or unrelated object-store population changes.
12. Foreign Quick writes receipts only under the controller, creates no target
    `.owlcoda/runkit`, binds target/dependency/command evidence, and invalidates
    any permanent governed target delta observed after execution.
13. Doctor exposes package/process Skill drift and absolute package Skill path
    without claiming knowledge of the Skill already loaded by an Agent.

## Non-goals

- no automatic or assisted Agent launch;
- no model or vendor selection;
- no general scheduler or second graph;
- no automatic assurance escalation;
- no parsing of domain product contracts inside Core;
- no implicit deployment, product acceptance, or business verdict;
- no shared Skill mutation without fleet-safe explicit invocation;
- no publication claim from repository source or test success.

## Claims boundary

This document defines the Phase 2 product contract. Its presence does not prove
implementation completion, package publication, project adoption, shared Skill
activation, runtime deployment, or business acceptance. Those facts require
their own current receipts and external readback.
