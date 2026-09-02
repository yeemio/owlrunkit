# OwlCoda RunKit 0.18 Project Driver Product Definition

Status: public product contract for the standalone `owlrunkit@0.18.0` candidate.
This document defines the normal project-continuity path; it does not grant Git,
release, npm, deployment, production, migration, destructive, or business
authority.

The 0.18 Project Driver is a bounded surface for new projects and controlled
dogfood. Its product name does not claim to be a general long-running,
multi-phase, or enterprise control plane. Version 0.18 includes one bounded
Project Successor lifecycle operation for a derived-completed active V1
project. It is not a general existing-project migration, multi-project
registry, or automatic writer-promotion system. Incomplete projects stay on
their current truth. Handoff and takeover do not automatically promote an
authoritative writer. Core successor, rollback compatibility, publication,
Project Successor, and project adoption remain separate authority boundaries.

## Product outcome

RunKit 0.18 is the Project Driver for work that continues across Agents,
sessions, interruptions, and handoffs. A user should be able to return to a
blank session, run `status` or `takeover`, and receive a bounded next action,
the responsible Agent, the dominant gap, and the evidence needed to proceed.
The normal recovery target is a useful takeover packet within two minutes on a
local project with an existing definition and event history.

## Normal typed mainline

The ordinary user-facing flow is a typed direct CLI surface:

1. `project init` accepts one project definition JSON file and creates the
   durable project model.
2. `project assign` gives a WorkItem to an Agent.
3. `project checkpoint` records meaningful state and evidence.
4. `project handoff` transfers a responsibility without overwriting its
   history.
5. `project reject-and-return` preserves a current failed checkpoint and opens
   one evidence-linked rework assignment atomically.
6. `project decision` opens or resolves a decision with rationale and evidence.
7. `project integrate` records an integration-gate result with evidence.
8. `project status` projects the current team state.
9. `project takeover` builds the next bounded action for a successor Agent.
10. After the project derives `overall=completed`, `project successor`
   archives it and installs one fresh project under explicit Owner invocation.

Except for the one definition supplied to `init`, normal users provide typed
flags and values. They do not need to author request, event, receipt, or hash
JSON. The legacy `--request <event.json>` path remains available for existing
automation and compatibility, but it is not the product's primary interaction.

## Project Driver projection

Every status and takeover projection exposes the same deterministic recovery
spine:

- `dominantGap`: the highest-priority unresolved decision, failed WorkItem,
  blocked dependency root, active responsibility, or integration gate;
- `nextAction`: the next bounded action that is legal from the durable state;
- `nextActorId`: the Agent responsible for that action when one is known;
- `headline`: a concise human explanation of the current project state.

The projection derives these fields from append-only artifacts. It never accepts
a guessed percentage, promotes an evidence candidate into business truth,
invents completion, or overwrites an earlier assignment, handoff, decision, or
checkpoint.

## Continuity actions

A handoff preserves the outgoing assignment and records the successor action.
A reject-and-return event binds the current failed checkpoint, failed
assignment, reviewer, evidence, target Agent, and new rework assignment in one
append-only write. The failed event stays terminal and immutable; the WorkItem
continues from a new derived active rework attempt. It cannot target completed,
active, implicit execution-only failure, or historical failure state.
A decision separates the open question from its later resolution, rationale,
and evidence. An integration event records that the project gate was reached;
it is not a Git merge, release, deployment, or publication operation. Status and
takeover are read-only projections and are safe to repeat after an interruption.

## Bounded Project Successor

`project successor` is the only 0.18 operation that replaces the active
Project Driver truth. It first requires the current project to derive
`overall=completed`; a chat summary, checkpoint claim, or caller flag cannot
substitute for that projection. The target definition must use a different
project identity and begins with no events.

The operation holds an external lifecycle lock and the active project control
lock, records a durable transition journal, archives the exact prior bytes of
every regular file and directory under a content-addressed raw manifest, and atomically installs
the fresh active project at `.owlcoda/runkit/project`. Exact retries resume
the journal after the prepared, archived, or active-installed boundaries.
Before completion, archived regular files and directories are sealed against
ordinary writes with a receipt-bound `0444`/`0555` policy. An exact retry
validates that archive's bytes and seal. Before any later successor writes a
new journal or moves active truth, it validates the archive bound by every
completed transition journal. Status and takeover remain active-truth
projections and do not perform this historical scan. Different concurrent
transitions, leaf or ancestor symlinks, non-regular files, archive collisions,
truth drift, borrowed events, and ambiguous active state fail closed.

This lifecycle operation does not select a new authoritative Agent, migrate an
incomplete project, merge project histories, discover multiple projects, adopt
a package, or grant repository or release authority. Its receipt records all
Git, tag, publish, and deploy actions as false.

## Deferred verification without test thrash

RunKit may record a `verification_deferred` project event when related changes
should settle before a focused or broad check is run. The event contains only
stable check identifiers, the reason for deferral, the responsible Agent, the
related WorkItem, and the exact integration gate before which it is due. It
does not contain an executable shell command and does not schedule or run a
test.

An open record becomes the dominant project gap only after the ordinary work
needed by that gate is complete. The declared gate cannot pass until the record
closes. A `verified` close requires evidence; a `no_longer_required` close
requires a previously resolved project decision. The second disposition is
reported honestly and is never presented as a passing test.

Coverage adoption, source-bound receipts, and `verify-plan` remain responsible
for deciding which Formal commands are already covered and which are pending.
The Project Driver consumes that outcome as coordination truth rather than
duplicating the verification engine. This allows an Agent team to batch a
small, explainable group of related changes and verify it once at the correct
transition while preserving visible, fail-closed debt.

## Hidden trust substrate

The typed surface is backed by the existing trust substrate: immutable project
definition identity, append-only and idempotent events, canonical bytes,
regular workspace and path checks, source and evidence references, and
execution-bound lifecycle truth where a WorkItem binds an execution. Config,
profiles, leases, fingerprints, receipts, and the `.owlcoda/runkit` directory
remain internal control data; they are not user-supplied authorization.
The substrate continues to fail closed on malformed, ambiguous, redirected, or
untrusted control state. Normal project coordination retains
`authorizationGranted=false` unless a separately authorized boundary says
otherwise.

The new atomic rework record uses `OwlCodaRunKitTeamProjectEventV2`; existing
Event V1 bytes and meanings are unchanged and remain readable. This avoids
silently adding a new event meaning to the versioned V1 contract.

## Assurance boundary

Multiple Agents coordinating a project do not make project coordination Formal
by themselves. This normal flow does not make project coordination Formal by
itself; multi-Agent coordination does not automatically mean Formal.
The assurance lane is selected by the underlying risk and authority: ordinary
coordination may remain on the typed Project Driver path; high-risk source
integration, release, production, migration, destructive work, or an explicit
Formal acceptance request crosses the assurance boundary. Quick and Formal
verification remain distinct receipts and workflows. Neither grants Git, npm,
deployment, production, funds, or business authority.

## Performance and operating burden

The Project Driver is local-first and daemon-free. A project needs one
definition and an append-only event directory; ordinary users do not maintain
lease, receipt, fingerprint, or request JSON by hand. `status` and `takeover`
are read-only and deterministic, and repeated calls do not create project
events. Projection cost grows with the bounded definition and event history,
while the two-minute takeover target keeps interruption recovery operationally
small enough for routine Agent changes.

## Authority and compatibility

`owlrunkit@0.18.0` is an independent standalone candidate. The root `owlcoda`
package keeps its separate `0.15.32` lifecycle, and the published `owlrunkit`
`0.17.2` package remains the trusted rollback prior. Existing 0.17.x project
artifacts remain readable through the Core successor and trusted-prior paths.
The 0.17 Agent-Native product definition remains bundled as historical
compatibility documentation; this 0.18 document is the current Project Driver
contract.
