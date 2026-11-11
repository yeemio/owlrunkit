# OwlRunKit

OwlRunKit is OwlCoda's Project Driver for cross-Agent project continuity and
progression. Its execution, evidence, verification, and recovery substrate
makes that continuity inspectable and recoverable. RunKit 0.18 keeps work
moving across Agents and sessions through a typed direct flow while preserving
the existing assurance, source, and evidence boundaries.

RunKit 0.24.1 adds optional file-triggered Codex continuation. A native Stop
hook waits for RunKit data file changes, then resumes the bound session to
inspect the current project and continue its existing goal. It is disabled by default. See the setup below.

RunKit 0.18.1 adds a human-first usage-mode recommendation that selects
continuity and assurance independently. It keeps ordinary development light
while preserving mandatory Formal routing for material safety and authority
facts.

RunKit 0.18.2 is a focused dogfood patch for clearer CLI help, actionable
checkpoint and canonical-path errors, bounded Quick output summaries, typed
registry diagnostics, and explicit profile normalization previews.

RunKit 0.18.3 turns the next Sierac recovery dogfood findings into a smaller
Quick surface: hash-bound stdin scripts, bounded opening and closing summaries,
actionable-only receipt issues, optional one-command attestation, and concise
metrics by default. It also adds one atomic failed-work return path and makes
the bundled Skill's contract references self-contained.

RunKit 0.18.4 lets one controller project bind a separate frozen target
worktree without installing dependencies or `.owlcoda` into that target. It
captures an immutable entry snapshot, verifies an external DeliveryPacket,
classifies visible dirty-overlay changes, and imports the candidate identity
into Project Driver. Missing entry truth is reported as `candidate_only`, not
as an attested delta. Tool-cache and dependency-environment changes are
disclosed separately; unclassified source changes fail closed. The release
also makes project-local `npx --no-install owlrunkit` the documented command
surface so an older global binary cannot reinterpret newer project truth.
Profile detection now exposes real uncovered source paths and copyable repair
commands instead of reporting a non-actionable success. Takeover reports stale
handoffs and the exact current-versus-previous external candidate delta.
These additions use Profile Detection V3, Status/Takeover V2, Assurance Route
V2, and Usage Mode Recommendation V2; the published predecessor contracts
remain unchanged.

RunKit 0.19.0 consolidates the daily-use dogfood backlog into one release. It
adds atomic onboarding, isolated Quick dependency/cache execution, bounded
reuse of unchanged evidence, content-addressed output storage, explicit
external-runtime and rollback truth, upstream rework propagation, atomic
transfer actions, business-layer outcome projection, and local efficiency
metrics. These conveniences do not weaken Formal routing or grant Git,
release, deployment, production, or business authority.

RunKit 0.19.1 fixes mature-project onboarding when an existing owner profile
already owns command IDs proposed by detection. Reconciliation now extends that
sole command owner with the newly detected paths and authoritative command
binding instead of creating a second profile with duplicate IDs. Existing
owner profiles, strict validation, atomic rollback, and shared-Skill activation
boundaries remain unchanged.

RunKit 0.19.2 makes Formal Delivery easier to configure without weakening its
sandbox. A read-only envelope preflight reports known backend, subprocess,
temporary-directory, device-path, and protected runtime-root conflicts before
candidate evidence is written. Failed envelope checks receive typed failure
categories. Fully attested Quick receipts may be attached as source-bound
`supplemental-local` or `networked` evidence, but remain explicitly non-gating
and can never replace a Formal-eligible passed check.

The same candidate makes Project Driver completion honest: a completed
WorkItem ledger without separate Git/release/deploy authority is visibly
`code_complete_without_release_authority`, not a product-finished `next: none`.
Independent verification requires a different assigned Agent. Append-only
scope revision can widen or narrow a WorkItem after diagnosis without rewriting
history, and missing Quick/Formal receipt references remain visible warnings.

RunKit 0.20 Phase 1 adds Team Delivery as a read-only coordination dimension
over the existing Project Driver. `team recommend` exits for ordinary
single-owner work, recommends Team only for real coordination facts, exposes
owned-path conflicts and independent-acceptance gaps, and never dispatches an
Agent. `team status` projects the existing project graph without storing a
second graph. Three strict portable contracts—TeamTaskPacket V2,
TeamAcceptancePacket V2, and CandidateTransferPacket V1—can be validated on a
machine that does not have the local `manage-agent-team` Skill. This phase
does not add automatic or assisted dispatch and does not change Quick or Formal
assurance.

RunKit 0.21 Phase 2 keeps Team Delivery read-only while making delivery truth
explicit. Typed external Gates may block the relevant stage without parsing a
domain product's documents. Source acceptance, integration, materialization, deployment, live
readback, and product acceptance are separate evidence-bound lifecycle facts.
Project Status V4 and Team Delivery Status V3 expose that progression and an
explicit inventory of known-but-unmodeled candidates. An optional WorkItem
policy can require a currently attested Quick receipt, and `fleet skill-plan`
shows affected projects, active blockers, and copyable install/rollback commands
without mutating the shared Skill. No command dispatches an Agent or raises
assurance automatically.

The same phase adds a fixed-width canonical candidate ledger and
controller-owned Foreign Quick. A controller running 0.21 may verify a
disjoint frozen Git worktree without installing RunKit, changing package/lock
files, or creating `.owlcoda/runkit` in that target. Doctor also exposes the
package-bound and discovered process-wide Skill identities; it cannot prove which
instructions an already-running Agent process loaded, so that field remains
`unknown`.

This release also folds in the upgrade-usability patch: cross-version bootstrap
failures return copyable install and retry commands; `inspect --json --compact`
omits historical payloads; Team receipt warnings are non-blocking, actionable,
and grouped; doctor reports project CLI/Core separately from a process-level
shared Skill; and formatting-only profile reconciliation is a zero-write apply.

RunKit 0.22 adds a dedicated Hook Recovery projection for Codex
`SessionStart(source=compact)`. It exposes only the bounded project identity,
objective digest/preview, current Project Driver gap, execution/lease summary,
warnings, and false authority boundary needed for a consumer to decide whether
the project matches its current chat goal. It does not infer chat intent, emit
full execution or event history, change project state, dispatch an Agent, or
raise assurance.

RunKit 0.23 closes the continuity gap after a Project Driver ledger completes.
Project Status V5 distinguishes an exactly terminal source workspace from a
missing source baseline, an unavailable modeled target, and later unmodeled
workspace drift. A read-only `project successor scaffold` can project the
bounded delta and mechanically possible lanes for human review; it never
creates a project, infers the next objective, dispatches an Agent, or grants
authority.

The 0.18 Project Driver is a bounded surface for new projects and controlled
dogfood. Its product name does not claim to be a general long-running,
multi-phase, or enterprise control plane. Version 0.18 adds one bounded
Project Successor operation: an Owner may archive the exact prior bytes of a
derived-completed active project and install a different, empty V1 project as the sole
active project. It is not a general migration or multi-project writer system.
Incomplete projects stay on their current truth. Handoff and takeover do not
automatically promote an authoritative writer. Core successor, release
compatibility, publication, Project Successor, and project adoption remain
separate authority boundaries.

## Current release

`owlrunkit@0.25.1` is the version documented here. Its public surfaces
include:

- Project Driver and typed delivery lifecycle;
- Quick and Formal verification with source-bound receipts;
- controller/target worktree separation and foreign-candidate verification;
- Team Delivery read-only recommendations and portable transfer packets;
- bounded compact-session Hook Recovery;
- optional native Codex Stop continuation on a bound RunKit file event;
- managed local peer recovery for isolated macOS and Linux workers;
- completed-project drift detection and read-only successor scaffolding;
- fail-closed bootstrap, profile, registry, Core, and shared-Skill diagnostics.

This repository is the public corresponding-source, documentation, issue,
release, and trust surface for OwlRunKit. Day-to-day development remains in a
private source repository; every GPL-covered npm release must map to an exact
public source tag.

## Install

This package is the lifecycle-stable, registry-gated `owlrunkit@0.25.1`
artifact. Registry adoption remains fail-closed until its exact official npm
version, shasum, integrity, and tarball URL are independently verified. Local
tarballs remain candidate-test inputs and are never adoption provenance. Until
that registry evidence exists, use the package only for isolated candidate
verification; do not treat the command below as available release truth.

```bash
npm install --save-exact owlrunkit@0.25.1
```

Use `npx --no-install owlrunkit` for project commands. The package bootstrap
uses the project's exact locally bound CLI for
ordinary project commands. The installed current package remains responsible
for bootstrap operations such as initialization, adoption, and Core successor
migration, so a global CLI does not reinterpret an older project's control
state. Delegation is fail-closed: the lock entry must contain the canonical
official npm tarball URL and SHA-512 SRI, the installed Core closure must match
the current bootstrap Core or its embedded prior-release identity catalog, and
the project Config must independently bind the same Core.

```bash
npx --no-install owlrunkit --version
npx --no-install owlrunkit bootstrap --workspace /absolute/path/to/project \
  --exact owlrunkit@0.25.1 --dry-run
npx --no-install owlrunkit bootstrap --workspace /absolute/path/to/project \
  --exact owlrunkit@0.25.1 --apply
npx --no-install owlrunkit init --workspace /absolute/path/to/project
npx --no-install owlrunkit doctor --workspace /absolute/path/to/project
npx --no-install owlrunkit inspect --workspace /absolute/path/to/project --json --compact
npx --no-install owlrunkit mode recommend --workspace /absolute/path/to/project
npx --no-install owlrunkit mode status --workspace /absolute/path/to/project
```

`bootstrap` is the complete first-onboarding and eligible idle-upgrade entry.
It binds the exact project-local package to the official registry, initializes
Core, reconciles and validates profiles, writes adoption evidence, and reads
back doctor. Dry-run is zero-write; failed apply restores the governed preimage
and keeps a failure receipt. It reports shared Skill drift but never silently
updates a user or fleet Skill.

When an older CLI receives a different exact successor spec, bootstrap returns
two bounded repair commands: install that exact project dependency, then rerun
the successor's project-local bootstrap dry-run. Doctor keeps shared Skill
drift non-blocking and reports why fleet-safe activation must wait when an
active execution or lease is present.

`mode recommend` is read-only and defaults to human output; add `--json` for a
machine contract. The five user modes are presets over `continuity`
(`none | project_driver`) and `assurance` (`none | quick | formal`). They never
grant Git, release, deployment, production, or business authority.

## Hook recovery for compacted sessions

Use the dedicated machine surface instead of full inspect when a Codex Hook
needs only enough RunKit truth to compare identities after compaction:

```bash
npx --no-install owlrunkit hook recovery --workspace /absolute/path/to/project --json
```

The strict `OwlCodaRunKitHookRecoveryV1` response is deterministic and no more
than 2,000 UTF-8 bytes. It includes `projectId`, `projectTruthHash`, an
`objectiveDigest`, a bounded `objectivePreview`, progress, headline, dominant
gap, owner, next action, delivery disposition, execution/open/lease counts,
aggregated warnings, the latest provable project fact time, and a complete
all-false authority boundary. Project text is escaped and labeled
`untrusted_data`; it is data, never an instruction.

The Hook consumer must first compare its current Goal/Done-when with
`projectId` and the objective digest/preview. Only after that identity check may
it consider `nextAction`; RunKit does not decide what the current chat means.
An active Project Driver remains visible when there is no active execution.
No Project Driver is explicit. Invalid, redirected, version-mismatched, or
ambiguous control truth fails closed. The command never assigns, checkpoints,
hands off, takes over, creates an execution, acquires a lease, dispatches an
Agent, changes assurance, or grants Git, release, deployment, production,
business, automation, or money authority.

## Team Delivery: Recommend coordination without dispatch

Team Delivery is separate from continuity and assurance. It reads the current
Project Driver, recommends whether Team coordination is useful, and validates
self-contained packets without importing model-specific routing policy:

```bash
npx --no-install owlrunkit team recommend --workspace .
npx --no-install owlrunkit team status --workspace .
npx --no-install owlrunkit team packet validate --workspace . \
  --packet ./team-task-packet.json
```

No initialized project, no actionable work, and one ordinary ready WorkItem
remain `off`. Two disjoint actionable WorkItems may be parallel-eligible.
Overlapping owned paths recommend Team but block parallel writing and point to
append-only scope revision or serialization. Verification, handoff, rework,
candidate transfer, or multiple active owners keep coordination visible without
raising assurance. Every result keeps Agent dispatch and all external authority
false. Phase 1 contains no launcher, scheduler, model ranking, or vendor CLI
federation.

`team status` emits Team Delivery Status V3. Each
`no_bound_verification_receipt` entry includes `severity`, `blocking`,
`requiredAtGate`, and `recommendedAction`, plus a separate advisory summary.
Completed historical WorkItems whose evidence policy did not require a reusable
receipt are not retroactively told to add Formal evidence.

## Project Driver: Coordinate a multi-Agent project

RunKit 0.18 keeps the project alive independently of any one Agent or chat.
Initialize a definition, then use typed direct commands for the normal
assignment, checkpoint, handoff, failed-work return, decision, integration,
status, and takeover flow:

```bash
cp node_modules/owlrunkit/scripts/runkit-contract/templates/team-project-definition.json ./project-definition.json
npx --no-install owlrunkit project init --workspace . \
  --definition ./project-definition.json
npx --no-install owlrunkit project assign --workspace . --assignment-id assign-1 \
  --at 2026-08-09T00:00:00.000Z --work-item work-item-1 --agent agent-runtime
npx --no-install owlrunkit project checkpoint --workspace . --checkpoint-id checkpoint-1 \
  --at 2026-08-09T00:05:00.000Z --assignment-id assign-1 --work-item work-item-1 \
  --state active --summary 'Implement the bounded work item' \
  --completed-units 0 \
  --next 'Run the focused verification'
npx --no-install owlrunkit project handoff --workspace . --handoff-id handoff-1 \
  --at 2026-08-09T00:10:00.000Z --assignment-id assign-1 --work-item work-item-1 \
  --from-agent agent-runtime --to-agent agent-successor \
  --summary 'Source work is ready for continuation' --next 'Run verification' \
  --evidence evidence/source.txt
# If review instead rejects a failed checkpoint, preserve it and open rework
# without first mutating the WorkItem back to active:
npx --no-install owlrunkit project reject-and-return --workspace . --rework-id review-1 \
  --at 2026-08-09T00:10:30.000Z --work-item work-item-1 \
  --reviewer-agent agent-control --to-agent agent-runtime \
  --reason 'The candidate violates its versioned contract' \
  --next 'Repair the contract and rerun the focused check' \
  --evidence evidence/rejected-review.txt
npx --no-install owlrunkit project assign --workspace . --assignment-id assign-2 \
  --at 2026-08-09T00:11:00.000Z --work-item work-item-1 \
  --agent agent-successor --supersedes assign-1
npx --no-install owlrunkit project work-item revise-scope --workspace . \
  --revision-id scope-1 --at 2026-08-09T00:11:30Z \
  --assignment-id assign-2 --work-item work-item-1 --owner-agent agent-successor \
  --owned-path 'src/adapter/**' --owned-path 'src/canonical-store/**' \
  --measurable-unit interface --measurable-total 2 \
  --reason 'Diagnosis proved the canonical store is part of this bounded fix' \
  --evidence evidence/scope-decision.txt
npx --no-install owlrunkit project decision --workspace . --open --decision-id decision-1 \
  --at 2026-08-09T00:12:00.000Z --title 'Choose the accepted source path' \
  --question 'Which source path should continue?' --owner-agent agent-successor \
  --blocking-work-item work-item-1 --option accepted --option rejected
npx --no-install owlrunkit project decision --workspace . --resolve --decision-id decision-1 \
  --at 2026-08-09T00:13:00.000Z --resolution 'Use the accepted source path' \
  --rationale 'It preserves the project contract' --evidence evidence/decision.txt
npx --no-install owlrunkit project checkpoint --workspace . --checkpoint-id checkpoint-2 \
  --at 2026-08-09T00:14:00.000Z --assignment-id assign-2 \
  --work-item work-item-1 --state completed --completed-units 1 \
  --summary 'Accepted work is complete' --evidence evidence/completion.txt
npx --no-install owlrunkit project verification --workspace . --defer \
  --verification-id release-batch --at 2026-08-09T00:14:30.000Z \
  --work-item work-item-1 --owner-agent agent-successor \
  --check typecheck --check full-suite --check package-smoke \
  --reason 'Run broad checks once after the related changes settle' \
  --due-gate integration-ready
# After those checks run once against the frozen candidate:
npx --no-install owlrunkit project verification --workspace . --close \
  --verification-id release-batch --at 2026-08-09T00:14:45.000Z \
  --disposition verified --summary 'The batched release checks passed' \
  --evidence evidence/release-batch.txt
npx --no-install owlrunkit project integrate --workspace . --gate integration-ready \
  --at 2026-08-09T00:15:00.000Z --summary 'Integration gate evidence is complete' \
  --evidence evidence/integration.txt
npx --no-install owlrunkit project status --workspace .
npx --no-install owlrunkit project takeover --workspace . --agent agent-successor
npx --no-install owlrunkit project successor scaffold --workspace . \
  --from-workspace /absolute/source/worktree --dry-run
npx --no-install owlrunkit project successor --workspace . --transition-id project-next-001 \
  --at 2026-08-09T00:16:00.000Z --definition ./next-project-definition.json \
  --reason 'Archive the completed project and begin the next bounded project'
```

Normal users supply the one definition JSON to `init`, then use typed flags and
values. They do not need to author request, event, receipt, or hash JSON. The
legacy `--request <event.json>` path remains available for existing automation
and compatibility. Multiple Agents do not make project coordination Formal by
themselves. Project Driver continuity does not make project coordination Formal
by itself. The assurance lane follows actual writer and authority count,
rollback certainty, permissions, security, funds, irreversibility, schema/data
migration, and explicit acceptance contracts—not environment labels alone.

`project checkpoint --state verifying` requires the current assignment to have
been superseded by a different Agent. This turns independent verification into
a mechanical project invariant without forcing Formal. A verifying or completed
checkpoint that does not reference a recognizable Quick/Formal receipt remains
valid project truth but receives `no_bound_verification_receipt`; the warning is
about the missing bound reference and does not attest any referenced receipt.
Team Status V3 and Compact V2 surface this non-retroactive fact as an advisory,
not an actionable warning.

`project work-item revise-scope` appends Event V5 and never rewrites the original
definition. It must bind the current assignment and owner, records the previous
and new paths/measurable contract, and invalidates older checkpoints for progress
projection. Repeating the exact revision is idempotent; changing an existing
revision fails closed.

`project reject-and-return` applies only to the current explicit failed
checkpoint. One Event V2 atomically binds that failure, its prior assignment,
the reviewer, evidence, target Agent, and new assignment. The failed checkpoint
remains immutable; status and takeover expose the rework relation and attempt.
The command is not a Git rejection, merge action, or release authorization.

### Import a frozen external source lane

Capture the target before delegating source work, then import the producer's
DeliveryPacket after it freezes the candidate:

```bash
npx --no-install owlrunkit project target-snapshot --workspace . \
  --snapshot-id w2-5-entry --at 2026-08-12T08:00:00.000Z \
  --work-item work-item-1 --target-workspace /absolute/frozen/worktree --apply

npx --no-install owlrunkit project import-delivery --workspace . \
  --delivery-id w2-5-luna --at 2026-08-12T09:00:00.000Z \
  --assignment-id assign-1 --work-item work-item-1 --producer luna-max \
  --target-workspace /absolute/frozen/worktree \
  --packet /absolute/delivery-packet.json \
  --entry-snapshot w2-5-entry --apply
```

Both commands support `--dry-run` instead of `--apply`. Artifacts are written
only under the controller's `.owlcoda/runkit/project`; the target is read-only.
Controller and target must be disjoint real directories, and the target must
be the exact Git worktree root rather than a nested repository directory.
The imported Event V3 records `deliveryCandidateFingerprint`,
`workspaceSnapshotFingerprint`, target HEAD, candidate file hashes, overlay
classification, and explicit `proven` / `notProven` statements. Omitting
`--entry-snapshot` verifies the current candidate bytes but records
`overlayStatus=candidate_only`.

External-delivery intake cache classification covers paths visible to Git status, such as
`.vitest/**`, `.vite/**`, `.pytest_cache/**`, and `__pycache__/**`. It does not
claim to bind ignored paths (`ignoredPathsBound=false`) and does not create a
Quick isolated consumer. Lockfile or
`node_modules` changes outside the packet are disclosed as dependency
environment changes. Any other entry-to-candidate delta, or any packet path
outside the WorkItem's allowed ownership, blocks import before project truth is
written. This includes the deleted source side of a Git rename; changing target
HEAD, tracked tree, or submodule identity also blocks overlay attestation.
Event V3 can be created only by this verified intake path, not a legacy raw
project request. No imported delivery grants Git, release, deployment,
production, UX, or business acceptance.

`project verification --defer` is a small deferred-verification ledger, not a
test scheduler. It records stable check IDs, why they were intentionally not
run yet, the responsible Agent, and the integration gate before which they
must close. `status` and `takeover` keep that gap visible without repeatedly
executing anything; the due gate stays blocked while the record is open.
Closing as `verified` requires evidence. Closing a check that is no longer
required uses `--disposition no_longer_required` and must reference an already
resolved project decision. RunKit never turns either disposition into Git,
release, deployment, or business authority.

The existing coverage-adoption and verification-plan surfaces remain the
source for reusable receipts and exact pending commands in the Formal lane.
The Project Driver records the remaining coordination gap; it does not create
a second test engine or ask an Agent to repeat already covered checks.

`project successor` is available only after the current project derives
`overall=completed`. It keeps the active path at
`.owlcoda/runkit/project`, moves the exact prior bytes into a
content-addressed `project-archives` entry, and installs a new definition with
an empty event directory. A durable transition journal makes the same request
restartable after interruption; a competing transition, symlink, archive
collision, changed truth, same project identity, or incomplete project fails
closed. Archived regular files and directories are sealed against ordinary
writes with the receipt-bound `0444`/`0555` policy before completion. Archive
integrity and that seal are validated on an exact retry and before any later
successor; `project status` and `project takeover` remain active-truth
projections and do not perform a broad historical archive scan. The receipt
always keeps Git, release, publish, deploy, and adoption authority false.

Project Status V5 separately inspects source continuity after the WorkItem
ledger completes. It reuses the latest matching verified external-delivery
snapshot as the source baseline. A matching workspace is terminal against that
baseline; no baseline is reported as missing rather than guessed; an
unavailable or non-canonical target is unverifiable; and a changed target is
reported as unmodeled workspace drift. Explicit external Gates and delivery
lifecycle records keep their own meanings. Git, release, deployment,
production, product, and business authority remain external even when source
continuity is terminal.

`project successor scaffold --from-workspace <git-root> --dry-run` is a
zero-write review surface for a completed project. It reports the bounded
baseline-to-current delta, paths that match historical WorkItem ownership,
unmatched paths, and overlapping historical scopes. Its project ID, objective,
titles, owners, and acceptance remain deliberately unset for human review. It
has no apply form and never invokes `project successor`.

`project status` reports every Agent's active, waiting, completed, and failed
work; unresolved dependencies and decisions; the ready queue; critical work;
and integration gates. It does not accept a guessed completion percentage.
Measured progress is allowed only when the unit and total were declared in the
WorkItem. An assignment may bind an exact RunKit execution and lease; in that
case, the WorkItem cannot complete until the execution has a trusted accepted
closeout and its lease is released.

Status/Takeover V3 retain their published completion projection. Status V4
adds explicit delivery stages, and current Status V5 adds source-continuity
truth. `overall=completed` still means only that the WorkItem ledger is
complete. Missing release authority stays visible through the all-false
authority boundary; it is not fabricated as project work or used to hide a
missing baseline or later source drift.

`project takeover` adds the current candidate, its exact added/changed/removed
path delta from the previous imported delivery, and handoffs that are stale
because later project truth superseded them. These are read-only projections;
they do not reopen work or grant writer authority.

The Agent-facing natural actions are stable: split and assign work, report
status, open or resolve a decision, hand off, take over, capture evidence, and
verify. The CLI is the durable implementation surface; users can keep speaking
in project terms.

## Detect and apply project profiles

Preview deterministic, project-local commands, or atomically adopt only
high-confidence candidates:

```bash
npx --no-install owlrunkit profiles detect --workspace . --dry-run
npx --no-install owlrunkit profiles detect --workspace . --apply
npx --no-install owlrunkit profiles reconcile --workspace . --dry-run
npx --no-install owlrunkit profiles reconcile --workspace . --apply
npx --no-install owlrunkit profiles validate --workspace .
```

`profiles detect --apply` is create-only. `profiles reconcile` previews or
atomically updates an existing profile set and leaves a migration receipt. Both
paths refuse ambiguous or low-confidence candidates, source drift, symlinks,
and launchers that do not resolve to exact local files. Detection directly
supports lock-bound npm plus exact project-installed pnpm, Yarn, and Bun
launchers. A PATH-only package manager remains review-required. A dry-run that
only canonicalizes JSON formatting reports `normalizationOnly: true` instead of
showing unexplained hash drift with an empty update list. Applying that plan is
a zero-write `profiles_already_current` result: owner bytes remain unchanged and
no migration receipt or tracked formatting diff is created.

The dry-run is the V2 detection contract. It reports `profiles_insufficient`
instead of `profiles_detected` when Git-visible source paths are uncovered or
no actionable primary exists. `changedPaths`, `uncoveredSourcePaths`,
`primaryBlockers`, `minimalSuggestedProfile`, and `repairCommands` explain the
gap using only real project surfaces; absent conventional `src/` or `tests/`
directories are never invented as blockers. Detection records both sides of a
Git rename, reports Git-status failure, and rechecks the exact changed-path set
before apply so a stale dry-run cannot write incomplete coverage.

## Choose auto, off, light, managed, or formal

Start with the human-first read-only recommendation:

```bash
npx --no-install owlrunkit mode recommend --workspace .
```

- **off / No RunKit** uses neither continuity nor assurance for analysis,
  documentation, and disposable exploration that needs no reusable evidence.
- **light / Quick Verification** runs one exact low-risk, source-bound command.
- **managed** adds Project Driver continuity; each WorkItem may still use no
  assurance, Quick, or Formal according to its own facts.
- **formal / Formal Delivery** is forced by multiple writers, permission or
  security boundaries, funds, irreversible work, uncertain rollback,
  schema/data migration, or an explicit Formal acceptance contract.
- **auto** derives the preset from supplied facts and is the default.

Production, release, deployment, long duration, and interruption recovery do
not force Formal by themselves. Long or interrupted work primarily selects
Project Driver continuity. Risk containment permits a fresh lower-assurance
recommendation; escalation is not sticky.

Machine integrations may route an explicit risk-facts document directly:

```bash
npx --no-install owlrunkit assurance route --workspace . \
  --request ./scripts/runkit-contract/templates/assurance-request.json
```

`mode recommend --help` lists every accepted `--risk-category`; an invalid
category reports both the rejected value and the canonical allowed list.

The router fails closed to Formal when required risk facts are incomplete.
Quick receipts cannot become Formal acceptance, and Formal acceptance does not
grant Git, release, publish, deploy, or business authority.

Run Quick with:

```bash
npx --no-install owlrunkit quick-verify --workspace . -- npm test
npx --no-install owlrunkit quick-verify --workspace . --stdin-file ./remote-check.sh --attest \
  -- ssh test-host /bin/sh
npx --no-install owlrunkit quick-verify --workspace . --isolate \
  --dependency-root /absolute/dependency-consumer -- npm test
npx --no-install owlrunkit quick-verify --workspace /absolute/controller \
  --foreign-workspace /absolute/frozen-target \
  --dependency-root /absolute/dependency-consumer -- npm test
npx --no-install owlrunkit quick-verify --workspace . \
  --bind-ignored .generated/audit.json -- node ./verify-generated.mjs
npx --no-install owlrunkit quick-reuse --workspace . \
  --base-receipt .owlcoda/runkit/quick/receipts/<id>/receipt.json \
  --allow-path src/new-adapter.mjs --dry-run -- node --test tests/new-adapter.test.mjs
npx --no-install owlrunkit quick-verify --workspace . --capture-runtime \
  -- ./deploy-and-readback.sh
npx --no-install owlrunkit quick-runtime-verify --workspace . \
  --receipt .owlcoda/runkit/quick/receipts/<id>/runtime-transition.json
npx --no-install owlrunkit quick-metrics --workspace .
npx --no-install owlrunkit quick-metrics --workspace . --verbose
```

`--stdin-file` accepts a regular non-symlink file up to 1 MiB, copies its exact
bytes into the receipt store, and binds its path, size, and SHA-256 in a V2
Quick receipt before supplying those stored bytes as stdin. This avoids putting
large scripts into SSH argv or receipt JSON. The top-level `outputSummary`
includes bounded opening and closing stdout/stderr lines, so both rollback and
restore phases remain visible while the complete artifacts stay receipt-bound.
`--attest` runs the existing attestation immediately and returns its independent
object alongside the Quick result; it does not promote Quick to Formal.

`--isolate` emits Quick Receipt V3 and runs the exact command from a disposable
copy of Git-visible candidate files. Common cache variables and temporary files
point outside the source checkout; new ignored artifacts are disclosed and
discarded, while a visible source edit in the consumer invalidates the receipt.
The exact caller-owned command is not an OS write sandbox; direct writes it
performs outside the consumer remain subject to the explicit before/after
bindings.
An optional `--dependency-root` projects an already-installed `node_modules`
into the consumer, prepends its binary directory, and hash-binds package, lock,
installed-package, and executable metadata before and after execution. RunKit
does not install dependencies or contact a registry for this command.

`--foreign-workspace` emits Quick Receipt V4 and always uses a disposable
consumer. The exact project-local CLI, receipt store, stdout/stderr, and any
stdin material remain under the controller `--workspace`; the target receives
no RunKit initialization. The receipt records the target realpath, HEAD,
fixed-width status ledger, path/mode/size/content hashes, before/after governed
filesystem identity, command argv/cwd, and dependency environment. A permanent
observed target change invalidates the receipt. This is before/after evidence,
not an OS write sandbox or proof that no transient write was restored between
observations.

Repeatable literal `--bind-ignored` paths opt specific ignored workspace bytes
into Workspace Snapshot V2. Missing is a bound state; file or directory changes
invalidate Quick. Unrequested ignored paths remain explicitly outside the
claim. V1/V2 receipts and Workspace Snapshot V1 keep their existing meanings.

`quick-reuse` checks an earlier passed, source-unchanged Quick receipt against
the current candidate at byte level. A clean commit does not create false drift
when it preserves the previously dirty candidate bytes. Only literal
`--allow-path` deltas may remain; any other tracked, untracked, deleted,
renamed, submodule, or previously bound ignored-path delta blocks before the
exact command runs. `--apply` then runs only the delta gate and records
`OwlCodaQuickEvidenceReuseReceiptV1`. It does not promote either Quick receipt
to Formal, UX, deployment, production, or business acceptance.

New Quick output and Verification Envelope stdout/stderr bytes are also placed
in a project-global create-only SHA-256 object store. Repeated objects reuse the
same content identity; receipt-local Quick paths remain readable through
copy-on-write materialization, and historical receipt paths are not rewritten
or destructively compacted.

`--capture-runtime` sets `OWLRUNKIT_RUNTIME_REPORT` to an initially absent,
receipt-local path. The exact command may write one strict
`OwlCodaRunKitExternalRuntimeReportV1`; RunKit then keeps the ordinary Quick
receipt and adds an `OwlCodaRunKitRuntimeTransitionReceiptV1`. The companion
separates derived `workspaceMutation` from command-reported
`externalMutation`, and binds ordered stages, failed/last-passed stages,
rollback, final external state, and recovery artifacts with explicit
`capturedBefore` and `restoresTo` identities. Missing or inconsistent runtime
truth fails closed without erasing the Quick receipt. This is a hash-bound
command report, not an independent external observation or deployment
authorization; `quick-runtime-verify` verifies stored integrity only.

`quick-metrics` is local-only and returns aggregate counts. Add `--verbose`
when the individual receipt paths are needed. The former `--local` flag remains
accepted as a compatibility no-op. New successful receipts no longer carry
the fixed `quick_ignored_artifact_unbound` issue; historical receipts remain
strictly readable without surfacing that non-actionable code as an attestation
issue.

Quick's default human result is business-first: it says whether the exact
verification passed, what candidate/workspace evidence is bound, and keeps
product/UX, deployment/runtime, and production/business acceptance visibly
separate. A command-reported runtime transition is labeled as reported rather
than independently observed. Use `--json` for the strict
`OwlCodaRunKitOutcomeSummaryV1` projection.

RunKit can measure its own local workflow friction without telemetry:

```bash
npx --no-install owlrunkit efficiency record --workspace . \
  --event-id wave-start --at 2026-08-13T00:00:00.000Z \
  --kind workflow_started --workflow-id wave-1 --summary 'Wave started.'
npx --no-install owlrunkit efficiency status --workspace .
npx --no-install owlrunkit efficiency status --workspace . --verbose --json
```

Repeated Quick command executions are derived from matching command, candidate,
input, and dependency bindings. False blocks and manual interventions count
only when explicitly recorded. Handoff wait comes from Project Driver truth;
time-to-acceptable-result requires paired workflow start/result marks. Receipt
volume is intentionally not a value metric, and every result keeps Git,
release, deployment, production, and business authority false.

## Formal Delivery in three commands

Given a Goal Contract and the paths this work item may write, the happy path is:

```bash
NODE_BIN="$(node -p 'process.execPath')"

npx --no-install owlrunkit formal start --workspace . --run-id release-001 \
  --goal .owlcoda/runkit/goal.json --owned-path 'src/**'

npx --no-install owlrunkit formal check --workspace . --run-id release-001 \
  --check-id source-syntax -- "$NODE_BIN" --check src/index.js

npx --no-install owlrunkit formal finish --workspace . --run-id release-001 \
  --decision accepted
```

`formal start` creates the execution and exact writer lease. Each `formal check`
adds source-bound evidence without rebuilding the execution. `formal finish`
performs the final source-drift, evidence, permission, acceptance, closeout,
and lease-release gates in one command. Create a related execution only when
the authorized permission scope really changes. Repeating the same `check` or
`finish` command resumes exact create-only artifacts after an interruption;
different bytes fail closed.

Formal also accepts a real project command through an enforced Verification
Envelope:

```bash
npx --no-install owlrunkit formal preflight --workspace . \
  --envelope scripts/runkit-contract/templates/verification-envelope.json

npx --no-install owlrunkit formal check --workspace . --run-id release-001 \
  --work-item delivery --check-id project-tests \
  --envelope scripts/runkit-contract/templates/verification-envelope.json
```

The envelope declares exact commands, cwd, lockfiles, environment, timeout,
immutable source, writable outputs, disposable scratch, forbidden paths,
network mode, subprocess policy, and bounded setup/check/teardown. RunKit
captures stdout, stderr, output hashes, source before/after fingerprints,
runner identity, cleanup, and a self-verifying receipt. The public 0.17 package
provides a real macOS enforcement backend. If the current platform cannot prove
the policy, the command is not run and no Formal acceptance is possible.
Existing legacy verification may still capture evidence, but it is not silently
promoted into this Formal path.

If a required project check cannot run inside the envelope, attach its fully
attested Quick receipt to the same source candidate:

```bash
npx --no-install owlrunkit formal attach-evidence --workspace . \
  --run-id release-001 --evidence-id local-migration-readback \
  --kind supplemental-local --receipt /absolute/path/to/receipt.json
```

Use `networked` only for a Quick command that used network access. This is an
operator declaration, not a fact attested by Quick Receipt V3; the attachment
and summary therefore expose `classificationBasis=operator_declared_not_attested`.
The receipt and its materials are re-attested, but attached evidence is always
non-gating and cannot replace a passed Formal check or grant Git, release,
deployment, production, or business authority. Evidence Summary generation is
part of accepted finish; rejected and blocked closeouts remain honest without
creating an acceptance-oriented summary.

Use `npx --no-install owlrunkit status --workspace .` for a concise human view of what is ready,
what has not happened, how many gates remain, and the next allowed action.

## Freeze a dirty worktree safely

`SourceCandidateV2` makes a dirty but precisely bounded candidate a first-class
artifact. It binds the baseline, exact owned-path closure, source manifest,
and payload bytes without requiring a Git commit.
The serialized candidate contract is bounded to 64 MiB and 2,000,000 JSON
values. Freeze applies the same bound as the reader before writing that
candidate's payload or document, so an oversized workspace fails closed rather
than producing an unreadable candidate.

```bash
npx --no-install owlrunkit candidate freeze --workspace . --run-id release-001 \
  --from-lease delivery --candidate-id rc-001
npx --no-install owlrunkit candidate verify --workspace . \
  --candidate .owlcoda/runkit/executions/release-001/source-candidates/rc-001.json
npx --no-install owlrunkit candidate materialize --workspace . \
  --candidate .owlcoda/runkit/executions/release-001/source-candidates/rc-001.json \
  --target-workspace /absolute/clean/materialization
```

Materialization is create-only and verifies every byte. It applies payloads in
a sibling staging checkout, then atomically switches the target directory.
Write or mode failures roll back to the byte-exact clean target, and an
interrupted switch is recovered from its transaction journal on the next
invocation. Release reconstruction can therefore compare a clean workspace
with the frozen candidate instead of requiring the working tree to be
committed first.

## Register and automatically discover a fleet

Register every coverage root once. Later discovery and process-wide migration
commands use the persistent registry automatically:

```bash
npx --no-install owlrunkit fleet register-root --fleet-root /absolute/projects
npx --no-install owlrunkit fleet register-root --fleet-root /absolute/other-projects
npx --no-install owlrunkit fleet inspect-registry
npx --no-install owlrunkit fleet discover
```

The registry lives under the user-owned OwlCoda home. Initial discovery stops
at each project root; nested projects require a separate coverage root or
explicit registration. Marker, depth and filesystem failures are reported as
typed path-level issues rather than being collapsed into an unreachable root.
After a fleet is classified, `fleet replace-registry --dry-run` previews an
evidence-bound active, retired, excluded and invalid membership. Applying the
same request atomically records the exact preimage and a rollback receipt;
coverage reduction requires explicit exclusion evidence. Retired archives stay
auditable but are never interpreted as active writers.

RunKit rejects an unreachable root and freezes the exact active workspace list
before a shared Skill or Core change.
Shared Skill activation is the final fleet step: every discovered project must
already bind the target release through its exact package declaration,
lockfile, installed CLI/Core, Config, and official-registry adoption evidence.
The installer replaces only the process-wide Skill. It locks every project
control root in canonical order and proves the workspace package manifest,
lockfile, installed package manifest, Config, and adoption evidence unchanged;
it never upgrades project dependencies or Core. An interruption journal
restores the exact prior Skill before a later installer action continues. The
fleet registry remains transaction-locked through final receipt commit.
Receipt and journal byte bounds are enforced by both writers and readers before
Skill mutation; legacy Config preimages use transaction-scoped, hash-bound
files so a large fleet does not make its recovery journal unreadable. V2
receipts always bind their discovery source and frozen membership, so rollback
must rediscover the same current fleet and also recovers atomically after an
interruption. Legacy V1 rollback remains supported only when the operator
supplies an explicit current fleet source.
Explicit `--fleet-root` and `--fleet-manifest` remain available for bounded
one-off operations. Completeness is intentionally limited to registered roots;
RunKit does not claim machine-wide protection for an unregistered location.

## Upgrade a self-hosted Core

Core successor separates an immutable candidate and fleet-wide plan from the
Owner-authorized migration:

```bash
npx --no-install owlrunkit core-successor plan --workspace . --plan-id core-016 \
  --run-id release-001 --from-lease delivery --candidate-id rc-001

npx --no-install owlrunkit core-successor apply --workspace . \
  --plan .owlcoda/runkit/core-successors/core-016/plan.json \
  --owner-authority ./owner-core-successor-authority.json \
  --receipt-id core-016-apply
```

Planning materializes the complete `SourceCandidateV2` in a clean workspace,
requires its computed Core identity to equal the proposed successor, and freezes
the automatically discovered registered fleet. Apply rediscovers the same
fleet, verifies the frozen plan and Ed25519-signed Owner authority against the
fixed user trust store, supports mixed prior Core identities, and writes
append-only per-project migration receipts. Unsigned V1 authority is historical
evidence only and cannot execute a migration.

## Two-stage deployment and remote adapter

Build and verification stay separate from the later permission to change a
machine:

```bash
npx --no-install owlrunkit deployment prepare --workspace . --run-id build-001 \
  --artifact dist/app.tgz --media-type application/gzip \
  --owner-decision ./owner-deployment-decision.json \
  --output .owlcoda/runkit/deployments/app-prepare.json

npx --no-install owlrunkit deployment execute --workspace . \
  --prepare .owlcoda/runkit/deployments/app-prepare.json \
  --owner-decision ./owner-deployment-decision.json \
  --owner-authority ./deployment-owner-authority.json \
  --manifest ./remote-deployment-manifest.json

# Resume the automatic child after an interrupted or indeterminate stage.
npx --no-install owlrunkit deployment execute --workspace . --resume \
  --prepare .owlcoda/runkit/deployments/app-prepare.json \
  --owner-decision ./owner-deployment-decision.json \
  --owner-authority ./deployment-owner-authority.json \
  --manifest ./remote-deployment-manifest.json
```

`deployment_prepare` freezes the accepted source artifact, build artifact, and
canonical `OwnerDeploymentDecisionV1` hash without granting deployment. The
decision explicitly states clean install versus in-place update, existing
asset and data authority, rollback semantics, service activation, baseline
cut, and destructive scope; missing high-risk fields fail closed. A Formal
`SourceCandidateV2`, including an
ordinary modification or deletion-only candidate, remains the first-class
source artifact through verification, accepted closeout, prepare, and lineage.
Legacy accepted runs that use a DeliveryPacket remain compatible.
`deployment_execute` requires a separate active execution
and signed V2 Owner authority that binds the prepare receipt, independent Owner
decision, and complete remote intent. Before creating the child or lease,
RunKit compiles the decision against the Goal, prepare receipt, manifest, and
authority. Conflicts stop before any executable child or remote command. The
default command creates the child execution, goal, lease,
profile, resource preflight, lineage, and result automatically. Supplying a
fully assembled `--request`, `--lineage-output`, and `--output` remains an
advanced compatibility path for controllers that already own those artifacts.

The standard remote deployment adapter models first install and update
separately. Its contract binds the VM host key and machine identity, create-only
upload, ordered remote stages, before/after state, exact file hashes, explicit
deletion allowlists, and remote smoke checks. A failure receipt identifies the
exact stage reached; destructive deletion is impossible unless both the
manifest and Owner-authorized execution permit it. Before every stage, RunKit
revalidates the child execution, lease, preflight, engine pin, and lineage.

Every external stage invocation has create-only before/after journal entries
under the deployment child. The journal binds the deployment lineage, remote
manifest, execute request, and adapter identity. Resume validates the complete
journal and reconciles remote truth before proceeding. Interrupted upload,
hash-check, identity, and smoke stages may be rerun because their contracts are
idempotent. Interrupted install, service, or proxy stages are never replayed
unless read-only reconciliation proves the expected state. Otherwise RunKit
returns `reconciliation_required`, keeps the existing child and lease active,
and requires the same `deployment execute --resume` path after the remote state
is reconciled.

`--resume` is limited to the same child and same Owner decision. If the bound
decision is replaced by a decision that explicitly supersedes it, RunKit sends
no remote command, releases the old child lease, and appends a blocked
`closed_superseded` closeout with `businessGoalIncomplete=true` and
`nextAllowedAction=plan_replacement_execution`. RunKit does not automatically
invent the replacement execution. Qualification evidence may remain reusable,
but rollback, remote intent, and Owner authority bound to the old decision do
not.

The remote manifest can select either adapter path:

- `kind: "builtin_ssh"` uses RunKit's built-in, argv-only SSH adapter. The
  manifest binds the exact Core adapter bytes, project-owned `known_hosts`
  bytes through `target.hostKeySha256`, SSH executable bytes, opaque credential
  reference and authentication mode, target identity, a caller-provided remote
  helper path/protocol/version/capability descriptor, and structured install,
  systemd, Nginx, and smoke contracts. Credential bytes are never written to
  the manifest or result. Before every SSH or reconciliation invocation, RunKit
  revalidates `known_hosts`, the SSH executable, and any identity file as
  regular non-symlink files with the same real path and exact SHA-256 bytes.
  Before upload or any later side effect, `identity_preflight` requires the
  helper to return the exact declared protocol, version, and
  `["execute", "reconcile"]` capability set. A mismatch fails closed.

  This npm package is the SSH client and protocol enforcer; it does not contain
  or install the privileged `owlrunkit-remote-helper` on a target VM. The
  operator must install and audit that helper separately, then bind its exact
  descriptor in the manifest. The handshake proves compatibility with the
  trusted target response, not the provenance of a host already controlled by
  an attacker. Therefore built-in SSH is not an out-of-the-box VM deployment
  capability.
- `kind: "process"` runs an exact externally supplied adapter executable and
  preserves the existing JSON stage protocol. A transport timeout, nonzero exit,
  or invalid output is indeterminate rather than a proven remote failure, so
  the stage journal drives the same safe resume rules. Manifests created before
  0.16 may omit `kind`; they remain process-adapter manifests.

For `identity_file` authentication, the manifest contains only the canonical
local file path and SHA-256 binding; the private key bytes are never persisted
by RunKit. Agent authentication stores only its opaque `agent:`, `keychain:`,
or `vault:` reference.

## Optional Codex file-event Stop hook

This feature uses the native synchronous Codex `Stop` hook. Codex remains
waiting in that hook; an operating-system file notification releases it with
one continuation request. There are no periodic model calls. It cannot restart
a fully ended idle Desktop turn. Native continuation was tested with Codex
0.162.0-alpha.2 using an offline response source; that probe does not install or enable
the hook in an existing Desktop session.

Install the exact registry release in the controller workspace through your
normal project adoption procedure. Add the following entry to the active
project or user `hooks.json`, merging with existing hooks. Use the real
absolute paths for Node, the installed package, and the canonical workspace:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "'/absolute/path/to/node' '/canonical/workspace/node_modules/owlrunkit/scripts/runkit-contract/file-event-stop-hook.mjs' --workspace '/canonical/workspace'",
        "timeout": 330,
        "statusMessage": "Waiting for the bound RunKit file event"
      }]
    }]
  }
}
```

On Windows, use the command quoting required by your native hook shell. Native
hooks must be enabled in Codex and the exact hook configuration approved through
`/hooks`. Review and approve the configuration again when its bytes change;
do not bypass trust in normal use. See the [native Codex hook documentation](https://learn.chatgpt.com/docs/hooks).

Before the controller reaches Stop, explicitly arm the existing project by
writing `.owlcoda/runkit/file-event-hook.json` in that workspace:

```json
{
  "schemaVersion": "OwlRunKitFileEventHookBindingV2",
  "enabled": true,
  "workspaceRoot": "/canonical/workspace",
  "projectId": "your-project",
  "sessionId": "actual-codex-session-id",
  "timeoutMs": 300000
}
```

Use the project ID in `project/definition.json` and the actual Codex session ID.
Replace a 0.24.0 V1 binding with this V2 binding. There is no checkpoint state,
event ID, assignment or frozen candidate prerequisite. Producers keep writing
normal RunKit data through their existing commands; no ZCode delivery-format
change is required. The hook recursively watches `.owlcoda/runkit/` using local
OS file notifications. Changed content requests continuation, including normal
`waiting_dependency` writes or data files without a Project Driver event.

Binding edits, `hook-continuations/`, control locks and temporary transaction
files are excluded from the content snapshot. A per-project/session cursor
merges unchanged rewrites and prevents concurrent requests for the same change.
The first wait establishes the current baseline; subsequent waits can notice
changes since that cursor. The Stop following a hook continuation does not wait
again, preventing an automatic feedback loop. A cursor's
`continuation_requested` status is not delivery or acceptance. If interrupted
after the claim, inspect the project and resume manually rather than replaying it.

Setting `enabled` to `false` or removing the binding cancels a pending wait.
A project/session mismatch never continues. Waits are bounded to 600000 ms;
keep the native hook timeout above the binding timeout. Expiry ends the wait
without starting another model pass. OS notifications may coalesce; this is a
notification to inspect current data, not an audit trail for every intermediate
write. The hook grants no new permissions and does no acceptance, Git operation,
release, deployment or executor launch. The resumed Codex controller handles its
existing authorized work, including driving ZCode through Computer Use when
that is its existing execution arrangement.

Installing the package enables nothing and changes no global configuration,
shared Skill or other workspace. This is same-session synchronous Stop
continuation; fully idle Desktop wake requires a separate supported ingress.

## Managed local peer recovery

Opt a new task into peer recovery before starting its writer. The project
controller names the current agent, successor, and exact checkpoint paths in
`peer.json`, for example:

```json
{"owner":"alpha","successor":"bravo","paths":["result.txt"]}
```

```bash
npx --no-install owlrunkit peer create --workspace . --task repair --request peer.json
npx --no-install owlrunkit peer run --workspace . --task repair --agent alpha --generation 1 -- /absolute/worker
npx --no-install owlrunkit peer inspect --workspace . --task repair
npx --no-install owlrunkit peer recover --workspace . --task repair --agent bravo --generation 1 --revision 2 -- /absolute/successor-worker
```

The cooperating agent uses the last two commands when it observes an
interruption and has authority to run the successor worker. Use the generation
and revision returned by `inspect`.
Recovery requests a wake from the current worker. A matching, changed checkpoint
keeps that worker in charge. If wake remains unconfirmed after the bounded wait,
recovery can move ownership to the designated successor because the current
attempt already runs in an isolated directory. One durable revision binds the
successor generation to the last accepted checkpoint. With a worker command
after `--`, recovery starts that worker after takeover and reports its result.
A concurrent retry may report the already-started attempt. Without a command,
the successor starts its own worker with `peer run`. An ACK or timeout does
not prove worker death. Retry the observed revision to read back the handoff.

Use a local worker that speaks newline-delimited JSON. RunKit seeds the attempt
directory from the previous checkpoint and sets `OWLRUNKIT_PEER_PATHS` to the
ordered path array. The worker reads a wake challenge from stdin as
`{"type":"wake","wakeId":"..."}`. Stdout is reserved for protocol messages.
Report work as `{"type":"checkpoint","wakeId":"...","files":[{"path":"result.txt","content":"..."}]}`.
Use the wake ID only when reporting progress in response to that challenge.
The `files` array covers the exact ordered paths, with canonical base64 bytes
or `null` for a missing file. The decoded checkpoint limit is 1 MiB. Emit
`finish` with the same `files` shape to record the result. Human diagnostics
go to stderr. `inspect` returns the checkpoint path and hash for handoff and
review. Only accepted checkpoints seed the next attempt, and the previous
scratch directory is reported for inspection while it remains on disk.

The macOS and Linux backends confine writes to the attempt and deny network
connections and new worker processes. Linux supports x86-64 and ARM64 with
Landlock ABI 3 or later, seccomp filtering, and `close_range`. The packaged
helper checks the effective policy before a managed task starts. It terminates
the worker if the supervisor process is killed. The host caller supplies the
worker command and peer identity. Existing Desktop sessions and writers using
legacy shared-directory leases follow their own recovery procedure. An
existing managed task remains pinned to the core that created it.

Linux control transactions use a kernel lock and a marker in the runtime
directory. If the process exits during an atomic lease operation, the next
transaction reads the lease state from the committed artifact. For other
transactions, automatic recovery requires unchanged control state. A partial
transaction returns `runkit_control_reconciliation_required` and preserves its
state. An older `control.lock` directory has no kernel ownership record and
requires the existing explicit recovery procedure.

## Shared Skill upgrades

Process-wide Codex Skill updates automatically use the registered fleet:

```bash
node ./scripts/runkit-contract/install-codex-skill.mjs install \
  --repository /absolute/path/to/owlrunkit-package \
  --target /absolute/path/to/installed/owlcoda-runkit \
  --archive /absolute/path/to/skill-archives
```

The installer stops before any mutation when the registry is missing, a
registered root is unreachable, a discovered project is invalid, or the fleet
contains active work. Historical closed leases remain evidence but do not
masquerade as active writers. Restore and drift recovery remain receipt-bound
and preserve project history.

The package also includes the read-only verifier:

```bash
owlrunkit-attest /absolute/path/to/receipt.json
```

## Requirements

- Node.js 20.19 or newer
- a local project directory
- network access only for explicit registry diagnostics and adoption; normal
  verification, fleet discovery, recovery, and attestation remain local

OwlRunKit belongs to the OwlCoda product family and source repository, but its
npm version is independent from the `owlcoda` CLI version.

## License

GPL-3.0-or-later. See `LICENSE` and `NOTICE.md`.
