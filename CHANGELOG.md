# Changelog

## 0.24.1

- Corrects the optional Stop hook to notify on RunKit data file changes, including
  `waiting_dependency`, without checkpoint state, event, assignment or candidate
  prerequisites. V2 binds only canonical workspace, project, session and timeout.
- Recursively watches local data, coalesces unchanged writes, deduplicates through
  a content cursor and excludes the hook's own claims and transaction scratch.
  A continuation's Stop does not re-arm itself. Default-off and authority limits
  remain; this does not restart an ended idle Desktop turn.
- Keeps 0.24.0 as the exact published rollback baseline.

## 0.24.0

- Adds an opt-in native Codex Stop hook that waits for RunKit file changes and
  requests one continuation in the bound session when its saved checkpoint
  arrives. Uses operating-system file notifications, without model polling or
  a recurring automation. Disabled unless explicitly configured and armed.
- Binds workspace, project definition, WorkItem, assignment, candidate, event,
  and session. Superseded work, disabled bindings, mismatched candidates, and
  repeated events cannot request another continuation. A local claim records
  a continuation request, never acceptance or new authority.
- Requires an active session waiting in its synchronous Stop hook. Background
  hooks cannot start a fully ended idle Desktop turn. Waiting is bounded by an
  explicit timeout; expiry ends the wait without continuing.
- Adds public repository, homepage, and issue metadata to the npm package.

## 0.23.0

- Adds Project Status V5 with a separate completion-continuity projection.
  Completed ledgers now distinguish an exact source-baseline match, missing
  baseline evidence, an unverifiable modeled target, and later unmodeled
  workspace drift instead of inventing more project work from absent release
  authority.
- Reuses the latest matching verified external-delivery target snapshot as the
  source baseline and reports a bounded committed, dirty-overlay, dependency,
  and submodule delta when the current source workspace changes.
- Adds read-only `project successor scaffold --from-workspace <git-root>
  --dry-run`. It groups changed paths against historical WorkItem ownership,
  reports unmatched and overlapping scopes, and leaves project identity,
  objective, owners, titles, and acceptance unset for human confirmation.
- Keeps Project Status V1-V4 callable, preserves Compact V2 and Hook Recovery
  V1 shapes, and advances only the current CLI status surface to V5. Explicit
  external Gates and delivery-lifecycle facts retain their meanings.
- Keeps status and scaffold deterministic and zero-write. No surface creates a
  successor project, dispatches an Agent, changes assurance, or grants Git,
  release, deployment, production, business, automation, or money authority.

## 0.22.1

- Makes process-wide Codex Skill activation require every discovered project
  to already have an exact package, lockfile, installed CLI/Core, Config, and
  official-registry adoption binding for the target RunKit version.
- Removes project migration from the shared Skill installer. Skill activation
  now replaces only the shared Skill bytes and emits V2 upgrade/rollback
  receipts proving that the package manifest, lockfile, installed package
  manifest, Config, and adoption evidence were unchanged.
- Adds canonical project control locks, a fleet-registry transaction lock,
  frozen-fleet revalidation, and recoverable install and rollback journals so
  interruption cannot leave a silent half-upgrade or partial legacy Config
  rollback.
- Gives upgrade receipts and transaction journals independent, writer-enforced
  byte bounds before Skill mutation. Legacy V1 Config preimages are stored as
  transaction-scoped, hash-bound files instead of duplicated base64 journal
  payloads, and terminal rollback recovery cannot rewrite a newly active
  project after its control lock is released.
- Binds V2 upgrade receipts to the exact fleet discovery source and frozen
  membership. Rollback rediscovers the current fleet and refuses newly added,
  active, or identity-drifted projects; legacy receipts require an explicit
  current fleet source.
- Makes both first activation and the read-only plan fail closed on an existing
  incompatible default fleet or any path-level discovery issue.
- Makes the read-only fleet Skill plan report package/adoption mismatches as
  blocking, with a project-local install/bootstrap or adoption repair boundary,
  instead of presenting Config-only projects as safe to activate.
- Preserves legacy V1 rollback receipts while keeping all Git, release,
  deployment, production, business, automation, and money authority false.

## 0.22.0

- Adds the independent `OwlCodaRunKitHookRecoveryV1` public contract and
  `hook recovery` CLI for Codex `SessionStart(source=compact)` consumers.
- Projects active Project Driver truth even when there is no active execution,
  while keeping execution and lease state as a separate bounded summary.
- Binds project identity with a deterministic objective digest, bounded preview,
  current dominant gap, owner, next action, delivery disposition, warning
  summary, and latest provable project fact time.
- Caps the complete JSON response at 2,000 UTF-8 bytes, escapes control and
  separator characters as untrusted data, and fails closed on redirected,
  version-mismatched, invalid, or ambiguous control truth.
- Keeps Compact V1/V2, full inspect, status, and takeover contracts unchanged;
  Hook recovery remains byte-stable, read-only, zero-write, no-dispatch, and
  all authority fields remain false.

## 0.21.1

- Adds Inspect Compact V2 with separate lifecycle, Project Driver, and
  maintenance next actions plus distinct project, maintenance, shared-Skill,
  and advisory summaries. Historical non-required receipt advisories no longer
  inflate its actionable warning count.
- Adds Doctor Report V3. ESLint flat config projects receive a global `ignores`
  recommendation instead of the obsolete `.eslintignore` advice; only an
  ignore-only object or ESLint's `globalIgnores()` helper counts as global
  coverage. Shared-Skill activation is explicitly `eligible`, `blocked`, or
  `not_evaluated`; unmanaged or drifted bytes remain blocked consistently with
  fleet planning. Relative launcher warnings remain grouped and non-blocking.
- Adds Team Recommendation V2 and Team Delivery Status V3. The public field is
  now `teamCoordinationMode`, making clear that Team projection does not replace
  ordinary usage-mode assurance. Missing historical verification receipts are
  advisory and remain non-retroactive.
- Adds Takeover V4 so completed WorkItems remain visible in history without
  being presented as a current responsibility or contributing a stale owner
  next action. Earlier takeover contracts remain unchanged.
- Keeps project-local bootstrap compatible with the exact published 0.20.1 and
  0.21.0 predecessor Core identities, and makes Team Delivery Status V3's
  public schema mechanically keep receipt advisories out of actionable warning
  summaries.

## 0.21.0

- Adds ExternalGateV1 as typed, source-hash-bound Project Driver truth. A due
  pending, blocked, or deferred Gate becomes the dominant gap for its delivery
  stage; superseding observations are append-only and raw capture cannot bypass
  typed intake.
- Adds DeliveryLifecycleV1 and Project Status V4 so source acceptance,
  integration, materialization, deployment, live readback, and product acceptance are distinct
  evidence facts. Work-ledger completion never auto-promotes a later stage.
- Adds Team Delivery Status V2 with explicit known-but-unmodeled candidate
  lanes while retaining one Project Driver graph and read-only, no-dispatch
  Team coordination.
- Adds optional WorkItem Quick-evidence policy and
  `project checkpoint --from-quick-receipt`; ordinary WorkItems remain
  lightweight and no assurance mode changes automatically.
- Adds read-only `fleet skill-plan` for affected-project inventory, active
  execution/lease blockers, and copyable dry-run, install, and rollback
  commands. It grants no shared-Skill, project, Git, or release authority.
- Adds a canonical candidate ledger with fixed Git object width, C-locale path
  ordering, complete path/mode/size/content bindings, and a transport-only raw
  binary diff. Object-store growth no longer changes the candidate identity.
- Adds controller-owned `quick-verify --foreign-workspace` and Quick Receipt
  V4. The target is copied into a disposable consumer; receipts remain under
  the controller and bind target candidate, filesystem, dependency, command,
  and before/after observed zero-write evidence without initializing RunKit in
  the frozen target.
- Doctor now reports the package-bound and discovered process-wide Skill versions and
  absolute paths, labels drift as a visible non-blocking warning, and keeps the
  actually loaded Skill version honest as `unknown`.
- Replaces the temporal, candidate-only registry policy with a lifecycle-stable
  registry-gated release artifact policy. The packed README, Skill, policy, and
  SBOM no longer claim that the package is unpublished or that an older version
  is still current; adoption still requires independent exact-registry evidence.
- Treats formatting-only profile reconciliation as an apply-time no-op. The
  result remains explicit through `normalizationOnly: true`, but owner JSON
  bytes stay unchanged and no migration receipt or tracked diff is created.
- Makes a version-mismatched bootstrap return the exact successor install and
  dry-run commands instead of only reporting the older CLI's own exact spec.
- Adds `inspect --json --compact`, a bounded projection of project truth,
  progress, dominant gap, owner, next action, warning groups, execution counts,
  and the unchanged authority boundary without full execution history.
- Adds Team Delivery Status V2. Missing receipt warnings now carry severity,
  blocking and gate semantics, an actionable recommendation, and deterministic
  aggregation without retroactively requiring Formal evidence.
- Shows project CLI/Core and process-level shared Skill versions in doctor.
  Skill drift is explicitly non-blocking and includes a fleet activation
  blocker when an active execution or lease prevents safe refresh.

## 0.20.0

- Adds read-only `team recommend` and `team status` projections over the
  existing Project Driver. Ordinary single-owner work remains off; real
  multi-lane coordination, owned-path conflicts, independent verification, and
  owner transitions are explained without persisting a second task graph.
- Publishes strict TeamTaskPacket V2, TeamAcceptancePacket V2, and
  CandidateTransferPacket V1 contracts plus `team packet validate`. Project
  bindings, exact WorkItem ownership, model-family independence, candidate
  identity, handoff ACK, false-authority fields, and duplicate JSON keys fail
  closed.
- Keeps Team Delivery orthogonal to continuity and assurance. This phase does
  not dispatch Agents, rank providers, federate vendor CLIs, grant authority,
  or turn multi-Agent coordination into Formal Delivery.

## 0.19.2

- Adds read-only `formal preflight` and reuses it before an envelope-backed
  Formal check writes candidate or evidence artifacts. It reports enforcement
  backend, package-script subprocesses, protected `.owlcoda/runkit/` scan
  conflicts, temporary-directory needs, device paths, and actionable repairs.
- Adds Formal Check V2 failure taxonomy for source failures, missing envelope
  capability, unresolved toolchains, and backend-proven network denial while
  preserving the existing Formal Check V1 contract. Classification uses
  trusted runner facts, never command-authored stdout or stderr; the current
  backend conservatively leaves unproven network causes as source failures.
- Adds `formal attach-evidence` for fully attested, source-bound
  `supplemental-local` or `networked` Quick evidence and a deterministic finish
  summary. The environment classification is explicitly operator-declared and
  not attested by Quick Receipt V3. Supplemental evidence is always non-gating
  and cannot replace a Formal-eligible passed check.
- Re-attests supplemental receipt and material bytes at accepted finish, excludes stale
  candidate attachments, rejects symlinked evidence roots, and preserves exact
  resume semantics for the evidence summary.
- Completes action-specific Formal and Project Driver help for supported
  options without changing Git, release, deployment, production, or business
  authority boundaries.
- Adds Project Status and Takeover V3 so `overall=completed` means only that the
  WorkItem ledger is complete. Without separate authority the visible delivery
  disposition is `code_complete_without_release_authority`, the dominant gap is
  `release_authority`, and the next action is never silently `none`.
- Requires a different assigned Agent before a WorkItem enters `verifying`,
  warns when verifying/completed checkpoints lack a Quick or Formal receipt
  reference, and keeps an initialized Project Driver in managed continuity when
  auto mode would otherwise recommend off.
- Adds append-only Project Event V5 and `project work-item revise-scope` for
  superseding owned paths or measurable units without rewriting the project
  definition or allowing old checkpoints to prove the revised scope.
- Accepts ISO-8601 UTC timestamps with seconds or up to three fractional digits
  and stores canonical millisecond timestamps. Passed-gate defer errors now
  identify the successor/new-gate correction path.

## 0.19.1

- Fixes profile reconciliation for mature projects where an existing profile
  already owns command IDs such as `npm-build` or `npm-test`. When those
  detected commands have one existing owner, reconciliation extends that owner
  with the detected paths and current authoritative command definitions instead
  of creating an invalid duplicate-command profile.
- Preserves create-only receipts, atomic rollback, strict profile validation,
  project-local CLI binding, `authorizationGranted=false`, and the separate
  fleet/shared Skill activation gate.

## 0.19.0

- Adds `bootstrap --dry-run|--apply` as one exact-registry, project-local,
  lifecycle-locked onboarding transaction. It initializes or upgrades Core,
  reconciles and validates profiles, adopts the release, runs doctor, and
  restores its bounded preimage on failure without refreshing shared Skills.
- Makes first-use help and empty-profile repair actionable, and reports the
  installed package/Core/Skill identity independently instead of accepting a
  matching version string with drifted Core bytes.
- Runs Quick commands in an isolated temporary consumer with bounded dependency
  projection and tool-cache directories, separating workspace source changes,
  requested ignored-artifact bindings, and dependency-environment identity.
- Adds `quick-reuse` planning and execution for a passed prior receipt plus an
  explicitly allowed small delta. Reuse fails closed on prior candidate,
  command, dependency, ignored-binding, or out-of-scope path drift.
- Stores repeated Quick and Verification Envelope stdout/stderr as verified
  content-addressed evidence objects while retaining the existing receipt-local
  references and create-only receipt semantics.
- Adds `quick-runtime-verify` with explicit workspace mutation, external
  mutation, rollback, final external state, failed/last-passed stage, and
  recovery lineage fields. Command-reported runtime truth remains distinct from
  independent deployment or business acceptance.
- Adds Project Event V4 actions for reopening or invalidating upstream work,
  propagating downstream waiting, and atomically transferring responsibility.
  Immutable prior failures, assignments, handoffs, and evidence remain visible.
- Adds a six-layer human outcome projection that separates candidate identity,
  workspace attestation, verification, product/UX acceptance, deployment/runtime
  activation, and production/business validity; lower layers never promote the
  higher ones automatically.
- Adds local-only `efficiency record|status` metrics for repeated commands,
  explicit false blocks and manual interventions, handoff wait, and
  time-to-acceptable-result. Receipt count is intentionally not a success
  metric and no telemetry is sent.
- Preserves the independent continuity and assurance axes, mandatory Formal
  risk routing, strict predecessor contracts, and
  `authorizationGranted=false` for Git, release, deployment, production, and
  business authority.

## 0.18.4

- Adds controller-owned `project target-snapshot --dry-run|--apply` for binding
  an immutable target HEAD, visible dirty overlay, WorkItem path boundary, and
  full workspace fingerprint without writing the frozen target worktree.
- Adds `project import-delivery --dry-run|--apply` for verifying an external
  DeliveryPacket against that target and recording exact candidate identity in
  Project Driver through append-only Event V3.
- Distinguishes an attested entry-to-candidate overlay from `candidate_only`
  intake when no entry snapshot exists, so current candidate verification is
  never overstated as historical delta proof.
- Classifies visible tool-cache and dependency-environment changes separately
  while rejecting packet paths outside WorkItem ownership and any unclassified
  source delta before project truth is written.
- Documents project-local `npx --no-install owlrunkit` as the normal command
  surface and treats an older global CLI or process-level Skill as version
  drift, not as authority to reinterpret a newer project.
- Makes `profiles detect --dry-run` return the V3 contract with real visible
  changed paths, `profiles_insufficient` when source coverage is incomplete,
  a minimal suggested profile, and copyable preview/apply repair commands.
- Emits Status/Takeover V2 and extends takeover with stale-handoff reasons plus
  the current external delivery and exact per-file delta from its predecessor,
  while retaining the one-screen human projection.
- Emits Assurance Route V2 and Usage Mode Recommendation V2 with project-local
  commands. The published Profile Detection V2, Status/Takeover V1, Assurance
  Route V1, and Usage Mode Recommendation V1 contracts remain unchanged for
  existing consumers.
- Adds action-specific `project assign --help` and makes `quick-metrics`
  local-by-default without requiring `--local`; the old flag remains an
  accepted compatibility no-op.
- Requires disjoint controller and target workspaces, binds only an exact Git
  worktree root, brackets DeliveryPacket verification with stable target
  snapshots, and rejects base-identity drift plus both sides of any
  cross-boundary rename.
- Reserves Event V3 for verified `import-delivery` intake so legacy raw request
  actions cannot inject external-delivery truth without checking target bytes.
- Revalidates Git-visible changed paths between profile detection and apply;
  Git-status failure and rename-source coverage now fail closed instead of
  appearing as a high-confidence empty candidate.
- Keeps target writes and every Git, release, deployment, production, UX, and
  business authorization flag false.

## 0.18.3

- Adds `quick-verify --stdin-file <file>` so a local or remote verification
  script can be copied into the receipt store, hash-bound, and supplied as
  exact stdin without embedding its bytes in argv.
- Returns bounded opening and closing Quick output lines while preserving the
  complete stdout/stderr artifacts for later inspection.
- Stops emitting the fixed `quick_ignored_artifact_unbound` noise on new Quick
  receipts and omits it from attestation issue output for historical receipts.
- Adds `quick-verify --attest` as one high-level command while preserving the
  Quick receipt and attestation as separate evidence objects.
- Adds action-specific `quick-metrics --help`; aggregate counts are now the
  default output and receipt paths require `--verbose`.
- Adds atomic `project reject-and-return` for a current failed checkpoint. It
  preserves the failed attempt, records reviewer evidence, opens an assigned
  rework attempt, and keeps every authority flag false.
- Introduces `OwlCodaRunKitTeamProjectEventV2` for the new rework event instead
  of changing the existing Event V1 contract in place.
- Packages the Contract v0.1 and v0.2 references beside the bundled Codex Skill
  so its relative links work before and after managed Skill installation.

## 0.18.2

- Makes `project checkpoint --help` action-specific and returns a complete,
  shell-safe correction command when a measured checkpoint omits
  `--completed-units`.
- Keeps symlinked workspace roots fail-closed while reporting the canonical
  `--workspace` path, including the macOS `/tmp` to `/private/tmp` case.
- Returns a bounded stdout/stderr `outputSummary` at the top level of Quick
  results without changing the receipt or weakening full-output binding.
- Retries one transient registry transport failure while retaining the existing
  per-attempt timeout, and distinguishes DNS, connection, timeout, HTTP,
  authentication, and missing-version failures.
- Aligns the packaged README with five-mode routing and existing profile
  reconciliation instead of treating long-running, release, or production
  labels as automatic Formal triggers.
- Adds action-specific `quick-verify --help`, lists canonical risk-category
  values in mode help and validation errors, and marks formatting-only profile
  reconcile plans with `normalizationOnly: true`.

## 0.18.1

- Adds read-only `mode recommend` and `mode status` commands with five
  user-facing presets over independent continuity and assurance dimensions.
- Routes long-running, interruption recovery, and ordinary reversible project
  mutation to Project Driver continuity without automatically forcing Formal.
  Multi-writer, permission/security, funds, irreversible, rollback-uncertain,
  schema/data migration, and explicit acceptance facts still force Formal.
- Fixes Quick metrics to report receipt-time pass, fail, and source mutation
  independently of later workspace drift.
- Returns the standalone `quick-attest` command from Quick results and adds
  action-specific `quick-attest --help`.
- Diagnoses managed Skill/config Core version drift independently from installed
  file integrity.
- Aligns `doctor` with full profile validation, stops profile detection from
  inventing absent `src/**` and `tests/**` surfaces, and adds atomic profile
  reconciliation for an existing project.
- Adds action-specific `adopt --help` and keeps top-level inspection focused on
  the Project Driver's dominant project gap when one exists.
- Preserves `authorizationGranted=false` and the separation between workflow,
  acceptance, Git, release, deployment, production, and business authority.

## 0.18.0

- Introduces the Project Driver product path for continuity across Agents and
  sessions, with typed direct `init`, `assign`, `checkpoint`, `handoff`,
  `decision`, `verification`, `integrate`, `status`, `takeover`, and
  bounded `successor` actions.
- Projects a deterministic dominant gap, next action, next actor, and headline
  from durable project artifacts without accepting guessed percentages or
  inventing completion.
- Keeps legacy `--request` event input for compatibility while removing the
  need for normal users to author request, event, receipt, or hash JSON.
- Clarifies that ordinary multi-Agent coordination does not automatically mean
  Formal; the assurance boundary follows the underlying risk and authority.
- Adds a deferred-verification ledger that records stable unrun check IDs,
  reason, owner, and due integration gate without executing tests. Due open
  checks block only their declared gate; closure requires verification evidence
  or an already resolved project decision that says the check is no longer
  required.
- Keeps coverage reuse in the existing verification-plan/receipt substrate, so
  Project Driver status exposes the remaining gap instead of creating a second
  test engine or repeatedly rerunning covered checks.
- Defines the 0.18 Project Driver as a bounded surface for new projects and
  controlled dogfood. Its product name does not claim to be a general
  long-running, multi-phase, or enterprise control plane.
- Adds an Owner-invoked Project Successor for one derived-completed active V1
  project: archive the exact prior bytes under a content-addressed identity,
  install one different empty V1 project at the same active path, and recover
  the atomic transition from a durable journal after interruption.
- Rejects incomplete or changed project truth, the same project identity,
  symlinked inputs, archive collisions, and competing successor transactions.
  Completed archives are sealed against ordinary writes; exact retry and the
  next successor boundary validate every completed journal's archive bytes and
  seal before active truth or a new journal can change. Status and takeover do
  not perform that historical scan. Incomplete projects stay on their current
  truth. The receipt grants no Git, release, publication, deployment, or
  adoption authority. Handoff and takeover do not automatically promote an
  authoritative writer.
- Keeps Core successor, release compatibility, publication, Project Successor,
  and project adoption as separate authority boundaries.
- Preserves the published `0.17.2` Core and package as the trusted rollback
  prior for the independent `0.18.0` candidate.

## 0.17.2

- Treats valid profile launcher portability warnings as non-blocking maintenance,
  allowing an adopted project to finish onboarding.
- Separates lifecycle, maintenance, and optional-review actions while keeping one
  lifecycle-prioritized top-level next action.
- Reports trusted unlinked closeouts as non-blocking independent histories rather
  than implying damaged or ambiguous control state.
- Collapses repeated profile launcher warnings into one machine-readable summary
  while retaining detailed launcher diagnostics under the profile check.

## 0.17.1

- Prevents a completed checkpoint with `nextAction: null` from reviving an
  earlier handoff action in WorkItem and per-Agent project status.
- Prevents takeover packets for completed or failed responsibilities from
  inventing a continuation action after the work has ended.
- Preserves handoff recovery guidance until a later checkpoint explicitly
  supersedes it.

## 0.17.0

- Adds an Agent-native persistent project model for milestones, workstreams,
  WorkItems, dependencies, per-Agent assignments, checkpoints, decisions,
  handoffs, integration gates, and evidence-backed data candidates.
- Projects honest per-Agent progress from append-only artifacts instead of
  accepting self-reported percentages. WorkItems may use predeclared measured
  units, and execution-bound completion requires a trusted accepted closeout
  with a released lease.
- Adds blank-session takeover packets so a successor Agent can recover the
  objective, assigned work, blockers, evidence, history, and next action without
  relying on an old chat.
- Adds `owlrunkit project` commands for initialization, assignment,
  checkpointing, decisions, handoff, evidence capture, status, and takeover.
- Adds an enforced Verification Envelope for real Formal checks with explicit
  source/output/scratch/forbidden paths, environment, network, process,
  timeout, setup/check/teardown, cleanup, and content-addressed evidence.
- Provides a macOS sandbox backend and fails closed on platforms where the
  declared filesystem, network, credential, process, and cleanup policy cannot
  be proved.
- Preserves the 0.16 execution, lease, SourceCandidate, closeout, fleet,
  deployment, recovery, and authority boundaries.

## 0.16.1

- Replaces mutable publication-state assertions in the bundled Codex Skill
  with time-stable registry verification guidance.
- Binds the 0.16.1 candidate and rollback path to the exact officially
  published `owlrunkit@0.16.0` registry shasum, integrity, and tarball URL.
- Extends the trusted prior-Core catalog and public verifier so 0.16.0 projects
  can enter the existing fail-closed Core-successor path without hand edits.
- Strengthens the release identity gate so both source and unpacked Skill
  copies fail when stale publication claims or mismatched release identities
  appear.
- Grants no Git, publish, release, deploy, installation, global Skill update,
  or foreign-project migration authority.

## 0.16.0

- Adds a persistent coverage-root registry. After each fleet root is registered
  once, ordinary discovery, shared Skill upgrades, and Core successor planning
  automatically scan the complete registered scope. RunKit refuses unreachable
  registered roots and does not claim to discover projects outside them.
- Upgrades profile detection to emit high-confidence, exact project-local
  npm, pnpm, Yarn, or Bun launchers that can be adopted atomically with
  `profiles detect --apply`; a PATH-only manager remains review-required.
- Adds deterministic assurance routing among No RunKit, Quick Verification,
  and Formal Delivery based on explicit risk facts.
- Adds the three-command Formal happy path: `formal start`, incremental
  `formal check`, and one `formal finish` that performs the final source,
  evidence, permission, closeout, and lease-release gates. Exact create-only
  checks and finishes resume after interruption; mismatches fail closed.
- Restricts Formal accepted checks to the mechanically safe built-in Node
  syntax checker until a filesystem-write and network sandbox exists. Profile,
  package-manager, wrapper, and custom commands fail before spawn; legacy
  verification remains available without being treated as sandbox-equivalent.
- Adds `SourceCandidateV2` for immutable dirty-worktree candidates with exact
  owned-path closure, verification, and clean-workspace materialization.
  Materialization now uses a sibling staging checkout, atomic target switch,
  byte-exact rollback, and interruption recovery instead of incrementally
  mutating the clean target. An accepted candidate, including deletion-only
  and renamed changes, remains first-class through closeout, READY V2, release
  successor verification, deployment prepare, and deployment lineage while
  legacy DeliveryPacket runs remain compatible.
- Adds fleet-safe Core successor planning and Owner-authorized apply, including
  mixed prior Core identities, exact candidate materialization, and
  append-only per-project migration receipts. Owner authorization is an
  Ed25519-signed V2 artifact verified against the fixed user trust store.
- Adds linked deployment prepare/execute contracts and a staged remote
  deployment adapter with fixed machine identity, create-only upload, exact
  deletion allowlists, before/after state, hash verification, and stage-specific
  failure receipts. Deployment authority binds the full remote intent and is
  revalidated with execution, lease, preflight, engine, and lineage state before
  every remote stage.
- Adds an independently hashed `OwnerDeploymentDecisionV1` for deployment
  mode, existing assets, rollback and data authority, service activation,
  baseline cut, and destructive scope. The decision is compiled against Goal,
  prepare receipt, remote manifest, and signed Authority V2 before child or
  lease creation, then revalidated before every remote stage.
- Closes a child as blocked `closed_superseded` when its Owner decision changes,
  preserving old evidence and reporting the business goal incomplete with a
  replacement plan required. Exact same-decision resume remains supported;
  permission, target, artifact, remote intent, data, rollback, service,
  baseline, or destructive expansion requires new authority.
- Adds a release identity gate that compares package version, computed Core,
  public Attest, bundled Skill declaration and config, unpacked tarball copies,
  release binding, and retained tarball bytes. A stale hash on any surface
  blocks the release successor.
- Makes the built-in argv-only SSH adapter selectable directly from the remote
  deployment manifest, with exact bindings for the Core adapter, `known_hosts`,
  SSH executable, opaque credential reference, target, and structured stage
  contracts. Its caller-provided privileged remote helper is explicitly bound
  by path, protocol, version, and fixed execute/reconcile capabilities, then
  checked during identity preflight before any side effect. The npm package
  does not install this VM prerequisite and does not claim out-of-the-box
  privileged deployment. Existing external process-adapter manifests remain
  compatible.
- Adds create-only before/after journals for every remote stage invocation,
  bound to the deployment lineage, remote manifest, execute request, and exact
  adapter identity. `deployment execute --resume` reuses the existing child,
  validates the complete journal, and reconciles remote truth instead of
  creating a replacement execution.
- Prevents interrupted install, service, and proxy stages from being replayed
  without a successful read-only reconciliation. Unknown non-idempotent state
  returns `reconciliation_required` and keeps the child control active; only
  idempotent stages may be retried without proof.
- Revalidates `known_hosts`, the SSH executable, and identity-file real paths
  and hashes before every external SSH invocation. SSH and process transport
  failures are recorded as indeterminate remote state rather than proven
  failures.
- Adds a concise human status projection that reports completed steps,
  remaining gates, and the next allowed action.
- Adds action-specific help for the new daily-use commands and makes the
  automatic deployment child workflow the documented default; manually
  assembled execute requests remain an advanced compatibility path.
- Makes nested command help available through the published bootstrap before
  project binding, rejects symlink traversal for READY evidence and retained
  release artifacts, validates the complete READY lineage, and includes file
  modes in SourceCandidate V2 release equivalence.
- Makes the `owlrunkit` launcher prefer a project's exact locally bound CLI for
  ordinary commands; bootstrap-only operations continue through the current
  package. Delegation additionally requires the canonical official npm tarball
  URL, canonical SHA-512 SRI, a bootstrap-trusted Core identity, and a matching
  project Config, so a jointly forged local CLI and Config remain blocked.
- Was published to the official npm registry with `owlrunkit@0.15.1` as its
  release-time rollback baseline; publication did not grant Git, deployment,
  installation, or business authority.

## 0.15.1

- Treats preserved active lease bytes in trusted `blocked` or `rejected`
  history as non-active during upgrade safety checks.
- Validates closeout hashes, decisions, authorization boundaries, accepted
  evidence, and execution pins before trusting historical closeout state.
- Keeps active executions, invalid closeouts, and accepted closeouts with an
  inconsistent active lease fail-closed.

## 0.15.0

- Makes detected npm launchers resolve to absolute regular files that Formal
  verification can execute without weakening symlink rejection.
- Adds workspace-aware `apps/*` and `packages/*` profile candidates with exact
  workspace script commands.
- Expands read-only runtime-isolation diagnostics across common formatters,
  linters, and explicitly broad test collectors.
- Preserves rejected verification preflights as append-only execution evidence
  and persists non-accepted finalize outcomes with their request binding.
- Consumes completed adoption/profile facts in doctor and inspect guidance only
  when the launcher and exact local registry bindings are still safe.
- Keeps Contract v0.2, 0.13/0.14 configurations, profiles, historical
  executions, receipts, and verifier Core identities readable; repeated
  upgrades write exclusive sequenced ConfigV2 Core-refresh receipts.
- Refuses Core or process-wide Codex Skill upgrades before mutation when any
  explicitly enrolled project has an active execution, writer lease,
  ambiguous closeout, or invalid config.
- Archives the exact prior Skill and project config bytes, adds receipt-bound
  exact rollback, and adds an exact-Core active-fleet recovery path for
  installations already drifted by an older unsafe replacement.
- Runs registry pack/install/upgrade/rollback gates through npm owned by each
  selected Node runtime and proves active work blocks upgrade before mutation
  and rollback restores the exact prior Skill identity and config bytes.
- Keeps OwlCoda CLI `0.15.31` unchanged and grants no Git, publish, release, or
  deploy authority.

## 0.14.0

- Adds ordinary `--help` and `--version`, read-only `doctor`, exact official
  registry `adopt`, and deterministic `profiles detect`, `validate`, and
  `impact` commands for self-service project onboarding.
- Makes `init` guide new users through doctor, profile detection, then exact
  adoption or Formal start while retaining a complete JSON machine view.
- Includes the previously prepared Core v0.13 documentation corrections for
  Quick verification, deterministic repair, offline transport,
  registry-first adoption, and the canonical Codex Skill update boundary.
- Updates the bundled Codex Skill and config template to Core `0.14.0`.
- Keeps Contract v0.2 and OwlCoda CLI `0.15.31` unchanged.
- Does not add signing, keys, GitHub Actions, or authority.

## 0.13.0

- First standalone npm release of OwlRunKit.
- Includes Contract v0.2 / Core v0.13.0 execution, leases, source-bound
  verification, deterministic repair, offline receipt transport, public
  read-only attestation, compatibility gates, and the canonical Codex Skill.
- Keeps OwlCoda CLI and RunKit package versions independent.
