# OwlRunKit 0.18.4 External Delivery Intake Product Decision

> Status: implemented source candidate; unpublished, uninstalled, unadopted
>
> Date: 2026-08-12, Asia/Shanghai
>
> Scope: controller/target separation, external DeliveryPacket intake,
> dirty-overlay classification, actionable profile detection, takeover truth
> delta, and project-local command identity

## Decision

RunKit remains a flight recorder and stage controller. Its default posture is
light: ordinary analysis and small reversible source work do not require a
RunKit execution. Quick binds one important verification command. Project
Driver preserves continuity across sessions and writers. Formal remains
reserved for facts that actually require stronger assurance, such as multiple
writers or authorities, permissions, security, funds, irreversible change,
uncertain rollback, schema/data migration, or an explicit Formal acceptance
contract.

Version 0.18.4 addresses one narrower gap: a Project Driver in a controller
worktree must be able to record a candidate produced in a different frozen
worktree without installing dependencies, writing `.owlcoda`, or changing
package metadata in the target. Three adjacent onboarding and recovery defects
are included because they otherwise leave this path non-actionable: false-success
profile detection, missing stale/current candidate truth in takeover, and
inconsistent CLI help/local metrics behavior.

## Accepted dogfood facts

These facts come from the Sierac MES, OwlChen, OwlFootball, Luna, and Cursor
dogfood reports accepted as product input. This candidate does not re-run those
foreign-project workflows.

- Project Driver is a net benefit for long threads, cross-session takeover,
  multi-stage test deployment, and explicit Gate ownership.
- Quick is useful when it binds a frozen candidate and one decision-changing
  command. It is not the mechanism that discovers most source bugs.
- Ordinary single-writer source micro-batches become slower when every command
  is wrapped in RunKit ceremony.
- A controller worktree may have a valid RunKit project while a frozen source
  worktree cannot accept `.owlcoda`, `package.json`, a lockfile, or
  `node_modules` changes.
- External Luna and Cursor deliveries currently require manual path/hash
  aggregation before their candidate identity appears in Project Driver.
- `npx --no-install owlrunkit` can use the exact project package while a bare
  `owlrunkit` may resolve an older global binary. An old binary cannot safely
  predict or trust a future Core identity.
- Visible test-tool cache files can change a dirty-worktree fingerprint even
  when the intended source candidate did not change.
- Profile detection can look successful while its candidates do not cover the
  Git-visible source candidate or provide an actionable primary repair.
- A blank-session takeover needs to distinguish stale handoffs and show the
  current external candidate delta instead of presenting historical facts as
  competing next actions.
- Source/test success is not UX completion, deployment activation, production
  truth, or business effectiveness.

## Long-term product decision

Continuity and assurance remain independent dimensions. External source lanes
do not become Formal merely because they use another worktree or Agent.

| Situation | Continuity | Assurance |
| --- | --- | --- |
| Analysis, documentation discussion, disposable exploration | none | none |
| One low-risk frozen candidate and one exact command | none | quick |
| Cross-session or multi-stage ordinary reversible source work | project_driver | none or quick |
| Mandatory high-risk fact or explicit Formal acceptance | as needed | formal |

The user-facing presets remain `off`, `light`, `managed`, `formal`, and `auto`.
They are preferences, not authorization, and cannot weaken a mandatory Formal
route.

## Released capability before this candidate

The public npm release remains `owlrunkit@0.18.3`. It already provides:

- independent continuity/assurance mode recommendation;
- one-command `quick-verify --attest`;
- hash-bound `--stdin-file` input;
- bounded head-and-tail Quick output;
- actionable Quick issues and aggregate-by-default metrics;
- atomic failed-work `reject-and-return`;
- self-contained packaged Skill contract references.

Those features are not new 0.18.4 claims.

## 0.18.4 candidate implementation

### Controller-owned entry snapshot

`project target-snapshot --dry-run|--apply` reads a target Git worktree twice
and binds:

- canonical target workspace reference;
- repository identity and target HEAD;
- tracked tree, submodules, dependency lockfiles, and visible dirty overlay;
- the WorkItem's allowed path boundary;
- one full workspace snapshot fingerprint.

Only the controller's `.owlcoda/runkit/project/target-snapshots` path may be
written. Controller and target must be disjoint real directories, and target
must resolve to the exact Git worktree root. The target worktree is read-only.

### External DeliveryPacket import

`project import-delivery --dry-run|--apply` verifies the packet's exact
whole-file hashes against the target and records append-only Event V3 with:

- `deliveryCandidateFingerprint` for the packet file set;
- `workspaceSnapshotFingerprint` for the complete target snapshot;
- target HEAD, producer, WorkItem, and current assignment;
- entry snapshot reference and hash when available;
- candidate paths and entry-to-candidate changed paths;
- tool-cache, dependency-environment, unchanged-packet, and out-of-scope
  classifications;
- explicit `proven` and `notProven` statements;
- `targetWritePerformed=false` and `authorizationGranted=false`.

If no entry snapshot exists, the packet can still prove the current candidate
bytes. The event is then `candidate_only`; it cannot claim that the historical
entry-to-candidate delta was observed. Any packet path outside WorkItem
ownership or any unclassified source delta rejects the import before project
truth is written. Import brackets packet verification with stable workspace
snapshots, compares HEAD, tracked tree, submodules, and visible dirty overlay,
and treats both source and destination of a rename as changed paths. Event V3
is reserved for this verified intake path; legacy raw event requests cannot
manufacture an external-delivery fact.

### Command and Skill identity

Installed-project instructions use `npx --no-install owlrunkit`. A process-level
shared Skill or bare global CLI with an older version is reported as drift, not
used as authority to reinterpret current project truth. Safe fleet Skill
replacement remains a separate installation action and is not performed by
this candidate.

### Actionable profile onboarding

Public `profiles detect --dry-run` returns Profile Detection V3. V2 remains an
unchanged compatibility contract for existing consumers; V3 adds actionable
coverage fields. It reads Git-visible changed paths without writing the
workspace and reports
`profiles_insufficient` when source paths remain uncovered or no actionable
primary exists. The result includes exact uncovered paths, primary blockers, a
minimal profile using only real project surfaces, and copyable preview/apply
repair commands. Existing-profile repair continues through atomic
`profiles reconcile`; absent conventional directories are not blockers.
Detection and apply bind the same Git-visible changed-path set, including both
sides of a rename. Status failure or drift blocks apply before configuration is
written.

### Takeover truth delta and CLI consistency

`project status` and `project takeover` emit V2 projections while their V1
exports remain unchanged for existing consumers. Takeover V2 projects handoffs
made stale by later project facts, the current imported external delivery, and
an exact added/changed/removed path
delta from the previous delivery. The human projection remains one-screen.
`project assign --help` is action-specific, and `quick-metrics` is local by
definition: `--local` is optional and retained only as a compatibility no-op.

Assurance and usage-mode routing follow the same rule: their V1 contracts retain
the original bare-command machine values, while the CLI uses Assurance Route V2
and Usage Mode Recommendation V2 with project-local
`npx --no-install owlrunkit` commands.

## Acceptance-level presentation

Every imported delivery must keep these layers distinct:

1. candidate file identity verified;
2. entry-to-candidate visible overlay attested, or explicitly not attested;
3. verification command/test result, if separately run;
4. UX or independent product acceptance, if separately performed;
5. deployment/runtime activation, if separately authorized and read back;
6. production or business effectiveness, if separately accepted.

No lower layer promotes a higher one.

## Follow-up gaps

Ten issue classes remain outside 0.18.4 and need separate contracts:

- isolated temporary dependency consumer and test-cache execution;
- binding ignored paths when a task explicitly needs them;
- delta-oriented reuse of an older receipt plus a small allowed-path change;
- external runtime mutation, rollback, final-state, and stage-failure fields;
- upstream WorkItem invalidation/reopen with downstream waiting propagation;
- recovery evidence semantics;
- large-artifact deduplication;
- atomic onboarding/bootstrap and safer shared-Skill fleet activation;
- business-first stage summaries and acceptance-level UI projection;
- efficiency metrics for repeated commands, false blocks, manual intervention,
  handoff wait, and time to acceptable result.

## What this candidate cannot claim

- It is not published `owlrunkit@0.18.4`.
- It is not installed, adopted, activated, committed, tagged, or pushed.
- It does not auto-detect a source lane that was never assigned or imported.
- It does not prove ignored cache paths; workspace snapshots continue to say
  `ignoredPathsBound=false`.
- It does not isolate dependencies or automatically reuse prior tests.
- It does not run tests, create a Quick/Formal execution, modify Git, deploy,
  access production, or grant business authority.
- It does not move domain contracts or product judgment into OwlCoda.
