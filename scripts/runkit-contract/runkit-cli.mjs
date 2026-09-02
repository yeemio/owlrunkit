#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CORE_VERSION,
  RUNTIME_ROOT,
  acceptedCloseoutVerificationIssues,
  createCoreArtifact,
  currentCoreIdentity,
  initializeProjectRunKit,
  isDirectExecution,
  validateCoreArtifact,
  validateExecutionPin,
  validateLeaseOwnedPaths,
  validateProjectConfigV2,
} from "./core-contract.mjs";
import { collapseByteIdenticalDeliveryCandidates } from "./delivery-selection.mjs";
import { validateVerificationReceiptGate } from "./verification-receipt-gate.mjs";
import { validateReceiptLineage } from "./receipt-lineage.mjs";
import { verifyDeliveryPacket } from "./source-fingerprint.mjs";
import { runSnapshot } from "./snapshot.mjs";
import { runFinalize } from "./finalize.mjs";
import { runReadyForCommit } from "./ready-for-commit.mjs";
import { runVisualSmoke } from "./visual-smoke.mjs";
import { runVerifyPlan } from "./verification-plan.mjs";
import { runCoverageAdoption } from "./coverage-adoption.mjs";
import { runResumeExecution } from "./resume-execution.mjs";
import {
  runResourcePreflight,
  summarizeResourcePreflight,
} from "./resource-preflight.mjs";
import {
  acquireLease,
  acquireLeaseWithinControlTransaction,
  inspectLeases,
  listLeaseArtifacts,
  releaseLease,
  releaseLeaseWithinControlTransaction,
  restoreLeaseWithinControlTransaction,
  withControlTransaction,
} from "./lease-lifecycle.mjs";
import {
  relativeToWorkspace,
  safeRelativePath,
  writeJsonExclusiveAtomically,
} from "./provenance-common.mjs";
import { createDeliveryFromLease } from "./delivery-create.mjs";
import {
  activeAcceptedGate,
  runHighLevelVerify,
} from "./lifecycle-orchestration.mjs";
import {
  finalizeFormalChecksWithinControlTransaction,
  recordFormalCheckV1,
  recordFormalEnvelopeCheckV1,
  resumeCompletedFormalFinishV1,
  validateLegacyVerificationSideEffectsV1,
} from "./formal-workflow.mjs";
import {
  formatFormalEnvelopePreflightHumanV1,
  preflightFormalEnvelopeV1,
} from "./formal-preflight.mjs";
import {
  attachFormalSupplementalEvidenceV1,
  reattestFormalEvidenceSummaryV1,
  summarizeFormalEvidenceWithinControlTransaction,
} from "./formal-supplemental-evidence.mjs";
import {
  freezeSourceCandidateV1,
  freezeSourceCandidateV2,
  materializeSourceCandidateV2,
  verifySourceCandidateV1,
  verifySourceCandidateV2,
} from "./source-candidate.mjs";
import {
  buildInspectCompactV2,
  buildInspectSummary,
  formatInspectHuman,
} from "./inspect-presentation.mjs";
import { buildHookRecoveryV1 } from "./hook-recovery.mjs";
import { attestQuickReceiptDetails } from "./quick-attest.mjs";
import { readLocalQuickMetrics } from "./quick-metrics.mjs";
import { runQuickEvidenceReuse } from "./quick-evidence-reuse.mjs";
import { runQuickVerification } from "./quick-verify.mjs";
import {
  formatQuickOutcomeHumanV1,
  projectQuickOutcomeV1,
} from "./outcome-presentation.mjs";
import {
  formatEfficiencyMetricsHumanV1,
  readEfficiencyMetricsV1,
  recordEfficiencyEventV1,
} from "./efficiency-metrics.mjs";
import { verifyRuntimeTransitionReceipt } from "./runtime-transition.mjs";
import { runRepairExecution } from "./repair-execution.mjs";
import {
  exportOfflineReceipt,
  importOfflineReceipt,
} from "./offline-store.mjs";
import {
  applyDetectedProfilesV3,
  detectProfilesV3,
  reconcileProfilesV2,
  resolveProfilesImpact,
  validateProfiles,
} from "./profile-onboarding.mjs";
import {
  discoverFleet,
  inspectFleetRegistry,
  registerFleetCoverageRoot,
  replaceFleetRegistry,
  rollbackFleetRegistry,
} from "./fleet-discovery.mjs";
import {
  formatFleetSkillUpgradePlanHumanV1,
  planFleetSkillUpgradeV1,
} from "./fleet-skill-plan.mjs";
import {
  RUNKIT_RISK_CATEGORIES,
  routeRunKitAssuranceV2,
} from "./assurance-router.mjs";
import {
  formatUsageModeHumanV2,
  recommendUsageModeV2,
} from "./usage-mode.mjs";
import { deriveHumanStatusFromInspectV1 } from "./human-status.mjs";
import {
  closeDeploymentExecuteChildRun,
  createDeploymentExecuteChildRun,
  createDeploymentExecuteLineageFromActiveRun,
  createDeploymentPrepareReceipt,
  createDeploymentPrepareReceiptFromClosedRun,
  inspectDeploymentOwnerDecisionStateV1,
} from "./deployment-workflow.mjs";
import {
  createRemoteDeploymentStageJournalV1,
  executeRemoteDeployment,
  validateRemoteDeploymentManifest,
} from "./remote-deployment.mjs";
import { createRemoteProcessAdapterV1 } from "./remote-process-adapter.mjs";
import {
  builtInSshRemoteAdapterIdentityV1,
  createSshRemoteAdapterV1,
} from "./ssh-remote-adapter.mjs";
import { inspectProjectControlState } from "./project-control-state.mjs";
import {
  applyCoreSuccessorPlanV1,
  createCoreSuccessorPlanFromFleetV1,
  resumeCoreSuccessorPlanV1,
} from "./core-successor.mjs";
import {
  formatDoctorHuman,
  inspectLocalMaintenanceV1,
  readAdoptionReadiness,
  readProfileLauncherReadiness,
  runDoctorV3,
} from "./onboarding-doctor.mjs";
import {
  applyOnboardingBootstrapV1,
  formatOnboardingBootstrapHumanV1,
  planOnboardingBootstrapV1,
} from "./onboarding-bootstrap.mjs";
import {
  formatAdoptionHuman,
  runRegistryAdoption,
} from "./registry-adoption.mjs";
import { OFFICIAL_NPM_REGISTRY } from "./registry-adoption-gate.mjs";
import {
  appendTeamProjectEventV1,
  assignTeamProjectV1,
  buildTeamProjectTakeoverV4,
  checkpointTeamProjectV1,
  checkpointTeamProjectFromQuickReceiptV1,
  closeTeamProjectVerificationV1,
  deferTeamProjectVerificationV1,
  formatTeamProjectStatusHumanV2,
  formatTeamProjectTakeoverHumanV2,
  handoffTeamProjectV1,
  initializeTeamProjectV1,
  integrateTeamProjectV1,
  openTeamProjectDecisionV1,
  readTeamProjectStatusV2,
  readTeamProjectStatusV3,
  reconcileExternalGateV1,
  recordDeliveryLifecycleV1,
  rejectAndReturnTeamProjectV1,
  reopenUpstreamTeamProjectV1,
  resolveTeamProjectDecisionV1,
  reviseTeamProjectWorkItemScopeV1,
  setWorkItemEvidenceRequirementV1,
  transferTeamProjectV1,
} from "./team-project.mjs";
import {
  buildSuccessorScaffoldV1,
  formatSuccessorScaffoldHumanV1,
  readTeamProjectStatusV5,
} from "./project-completion-continuity.mjs";
import {
  formatTeamProjectSuccessorHumanV1,
  successorTeamProjectV1,
} from "./team-project-successor.mjs";
import {
  captureTargetWorkspaceSnapshotV1,
  importExternalDeliveryV1,
} from "./project-external-delivery.mjs";
import {
  formatTeamDeliveryRecommendationHumanV2,
  formatTeamDeliveryStatusHumanV3,
  formatTeamPacketValidationHumanV1,
  readTeamDeliveryStatusV3,
  recommendTeamDeliveryV2,
  validateTeamPacketFileV1,
} from "./team-delivery.mjs";

const TOP_LEVEL_HELP = `OwlRunKit ${CORE_VERSION}

Usage:
  npx --no-install owlrunkit <command> [options]

Start here:
  npx --no-install owlrunkit bootstrap --workspace . --exact owlrunkit@${CORE_VERSION} --dry-run
  npx --no-install owlrunkit mode recommend --workspace .
  npx --no-install owlrunkit doctor --workspace .
  npx --no-install owlrunkit profiles detect --workspace . --dry-run
  npx --no-install owlrunkit adopt --workspace . --exact owlrunkit@${CORE_VERSION}
Quick Verification
  npx --no-install owlrunkit quick-verify --workspace . -- <command> [args...]
  npx --no-install owlrunkit quick-reuse --workspace . --base-receipt <receipt> --allow-path <path> --dry-run|--apply -- <delta-command>
  npx --no-install owlrunkit quick-runtime-verify --workspace . --receipt <runtime-transition.json>
  Low-risk, source-bound reusable evidence without writer leases or acceptance.

Formal Delivery
  npx --no-install owlrunkit formal <start|preflight|check|attach-evidence|finish> --workspace . --run-id <id> [...]
  Use for multi-writer, permissions, security, funds, irreversible change,
  uncertain rollback, schema/data migration, or explicit Formal acceptance.
Frozen dirty source
  npx --no-install owlrunkit candidate <freeze|verify|materialize> --workspace . [...]

Two-stage deployment
  npx --no-install owlrunkit deployment prepare --workspace . --run-id <accepted-run> --artifact <file> --media-type <type> --owner-decision <decision-v1.json> --output <receipt>
  npx --no-install owlrunkit deployment execute --workspace . [--resume] --prepare <receipt> --owner-decision <decision-v1.json> --owner-authority <signed-v2.json> --manifest <remote.json>

Fleet and status
  npx --no-install owlrunkit fleet <register-root|inspect-registry> [options]
  npx --no-install owlrunkit fleet replace-registry --request <file> --receipt <file> [--dry-run]
  npx --no-install owlrunkit fleet rollback-registry --receipt <file> --rollback-receipt <file>
  npx --no-install owlrunkit fleet skill-plan --skill-root <directory> --archive-root <directory>
  npx --no-install owlrunkit fleet discover; npx --no-install owlrunkit status --workspace .
  npx --no-install owlrunkit hook recovery --workspace . --json
Agent team projects
  npx --no-install owlrunkit project <init|assign|checkpoint|handoff|reject-and-return|reopen-upstream|transfer|work-item revise-scope|work-item require-evidence|reconcile|delivery record|decision|verification|capture|target-snapshot|import-delivery|status|takeover|successor|successor scaffold> [options]
  npx --no-install owlrunkit team <recommend|status|packet validate> [options]
  Durable project truth plus read-only Team recommendation and packet validation. No Agent dispatch.
Core successor: npx --no-install owlrunkit core-successor <plan|apply|resume> --workspace . [...]
Other onboarding commands:
  npx --no-install owlrunkit profiles validate --workspace .; npx --no-install owlrunkit profiles impact --workspace . --changed <path>
  npx --no-install owlrunkit inspect --workspace . --json
Formal accepted does not grant Git or release authority; Quick cannot become Formal.
`;

const COMMAND_HELP = Object.freeze({
  init: `Usage:
  npx --no-install owlrunkit init --workspace <directory> [--json]

Initializes the project-owned RunKit Core and control directory. For a complete
first-time onboarding transaction, use bootstrap after installing the exact
project-local package. Initialization grants no Git, release, deployment, or
business authority.
`,
  bootstrap: `Usage:
  npx --no-install owlrunkit bootstrap --workspace <directory>
    --exact owlrunkit@${CORE_VERSION} (--dry-run | --apply)
    [--skill-root <installed-skill-directory>] [--json]

Preflights or atomically completes Core initialization, profile reconciliation,
validation, exact registry adoption, and doctor readback. Failed apply restores
the governed preimage and retains a failure receipt. Shared Skill drift is
diagnosed only; bootstrap never silently refreshes user or fleet Skills and
grants no Git, release, deployment, production, or business authority.
`,
  inspect: `Usage:
  npx --no-install owlrunkit inspect --workspace <directory> [--json]
  npx --no-install owlrunkit inspect --workspace <directory> --json --compact
  npx --no-install owlrunkit inspect --workspace <directory> --history [--json]
  npx --no-install owlrunkit inspect --workspace <directory> --run-id <id> [--verbose] [--json]

--compact returns only current project truth, progress, dominant gap, owner,
separate lifecycle/project/maintenance actions, actionable warning groups,
advisories, execution counts, and the authority boundary.
It never grants Git, release, deployment, production, or business authority.
`,
  hook: `Usage:
  npx --no-install owlrunkit hook recovery --workspace <directory> --json

Returns a deterministic, read-only, strictly bounded recovery projection for
SessionStart(source=compact). Project text remains escaped untrusted data.
The consumer must compare its current Goal/Done-when with projectId and the
objective digest/preview before considering nextAction. This command never
changes project, execution, lease, assurance, Agent, Git, release, deployment,
production, or business state.
`,
  "hook recovery": `Usage:
  npx --no-install owlrunkit hook recovery --workspace <directory> --json

Returns a deterministic, read-only, strictly bounded recovery projection for
SessionStart(source=compact). Project text remains escaped untrusted data.
The consumer must compare its current Goal/Done-when with projectId and the
objective digest/preview before considering nextAction. This command never
changes project, execution, lease, assurance, Agent, Git, release, deployment,
production, or business state.
`,

  doctor: `Usage:
  npx --no-install owlrunkit doctor --workspace <directory>
    [--registry <url>] [--timeout-ms <milliseconds>]
    [--skill-root <installed-skill-directory>] [--json]

Checks the project package, Core, registry, profiles, adoption, lifecycle, and
process-level shared Skill independently. Shared Skill drift is diagnostic and
non-blocking; it never changes project authority.
`,
  adopt: `Usage:
  npx --no-install owlrunkit adopt --workspace <directory> --exact owlrunkit@${CORE_VERSION}
    [--registry <url>] [--timeout-ms <milliseconds>] [--json]

Verifies the exact registry release against the project-local install and writes
project-owned adoption evidence. It grants no Git or release authority.
`,
  assurance: `Usage:
  npx --no-install owlrunkit assurance route --workspace <directory> --request <risk-facts.json>

Selects none, Quick, or Formal from structured risk facts. It does not grant
repository, release, deployment, or destructive authority.
`,
  "assurance route": `Usage:
  npx --no-install owlrunkit assurance route --workspace <directory> --request <risk-facts.json>

Required:
  --request <file>       Structured assurance risk facts.
`,
  mode: `Usage:
  npx --no-install owlrunkit mode recommend --workspace <directory> [risk facts]
  npx --no-install owlrunkit mode status --workspace <directory> [--json]

Selects continuity and assurance independently. Recommendation and status are
read-only and grant no Git, release, deployment, production, or business authority.
`,
  "mode recommend": `Usage:
  npx --no-install owlrunkit mode recommend --workspace <directory>
    [--requested-mode auto|off|light|managed|formal]
    [--needs-evidence] [--exact-command-count <count>] [--writer-count <count>]
    [--cross-session] [--long-running] [--interruption-recovery]
    [--may-mutate-project] [--external-side-effects]
    [--irreversible] [--rollback-uncertain]
    [--permission-sensitive] [--security-sensitive] [--funds-at-risk]
    [--schema-or-data-migration] [--formal-acceptance]
    [--risk-category <${RUNKIT_RISK_CATEGORIES.join("|")}>] [--json]

Returns one user mode plus the independent continuity and assurance selections.
Persisted mode preferences are not part of this release.
`,
  "mode status": `Usage:
  npx --no-install owlrunkit mode status --workspace <directory> [--json]

Reads the current mode preference source without creating project state.
`,
  team: `Usage:
  npx --no-install owlrunkit team recommend --workspace <directory> [--json]
  npx --no-install owlrunkit team status --workspace <directory> [--json]
  npx --no-install owlrunkit team packet validate --workspace <directory>
    --packet <packet.json> [--json]

Projects existing Project Driver truth into a read-only Team Delivery view and
validates portable Team packets. It never dispatches an Agent or grants Git,
release, deployment, production, business, automation, or money authority.
`,
  "team recommend": `Usage:
  npx --no-install owlrunkit team recommend --workspace <directory> [--json]

Recommends Team coordination only when current Project Driver facts require it.
Single ordinary lanes and uninitialized projects remain off. This is read-only.
`,
  "team status": `Usage:
  npx --no-install owlrunkit team status --workspace <directory> [--json]

Reads a Team Delivery projection from Project Driver. No second graph is stored.
`,
  "project reconcile": `Usage:
  npx --no-install owlrunkit project reconcile --workspace <directory>
    --reconciliation-id <id> --at <ISO-UTC> --gate-id <id> --title <text>
    --required-for <source|integration|materialization|deployment|live_readback|product_acceptance>
    --gate-status <pending|passed|blocked|deferred> --owner-agent <id>
    --source-adapter <id> --source-ref <ref> --source-sha256 <sha256:hex>
    --summary <text> --evidence <ref> [--evidence <ref> ...] [--json]

Records one domain-adapter-produced ExternalGateV1 observation. RunKit validates
the typed source binding but does not parse domain contracts. It grants no Git,
release, deployment, production, business, or Agent-dispatch authority;
authorizationGranted remains false.
`,
  "project delivery record": `Usage:
  npx --no-install owlrunkit project delivery record --workspace <directory>
    --record-id <id> --at <ISO-UTC>
    --stage <source|integration|materialization|deployment|live_readback|product_acceptance>
    --stage-status <stage-specific-outcome> --owner-agent <id> --summary <text>
    --evidence <ref> [--evidence <ref> ...]
    [--external-gate <id> ...] [--json]

Records one evidence-bound delivery lifecycle fact. The command never performs
the underlying integration, materialization, deployment, readback, or product acceptance and
grants no authority for those actions; authorizationGranted remains false.
`,
  "project work-item require-evidence": `Usage:
  npx --no-install owlrunkit project work-item require-evidence --workspace <directory>
    --policy-id <id> --at <ISO-UTC> --work-item <id> --owner-agent <id>
    --requirement <none|quick> --reason <text>
    --evidence <ref> [--evidence <ref> ...] [--json]

Records an explicit WorkItem evidence requirement without selecting or raising
assurance automatically. Existing WorkItems remain requirement=none until this
typed action is invoked; authorizationGranted remains false.
`,
  "team packet validate": `Usage:
  npx --no-install owlrunkit team packet validate --workspace <directory>
    --packet <packet.json> [--json]

Validates a TeamTaskPacketV2, TeamAcceptancePacketV2, or
CandidateTransferPacketV1 against current project truth without writing state.
`,
  "quick-attest": `Usage:
  npx --no-install owlrunkit quick-attest --workspace <directory> --receipt <receipt.json> [--json]

Attests one Quick Receipt against its bound materials and current workspace.
It never grants repository or business authority.
`,
  "quick-verify": `Usage:
  npx --no-install owlrunkit quick-verify --workspace <directory>
    [--foreign-workspace <frozen-git-worktree>]
    [--isolate] [--dependency-root <directory>] [--bind-ignored <relative-path> ...]
    [--stdin-file <file>] [--capture-runtime] [--attest] [--json]
    -- <executable> [args...]

Runs one exact command, saves source-bound stdout/stderr and a Quick receipt,
and returns a bounded head/tail output summary. --stdin-file copies and hash-binds
up to 1 MiB of exact stdin bytes in the receipt store. --attest immediately
attests the saved receipt without merging Quick and attestation semantics.
--isolate runs a Git-visible source copy in a disposable cache environment.
--dependency-root binds and projects an existing dependency environment without
installing anything. Ignored workspace bytes are bound only by explicit,
repeatable --bind-ignored literal paths.
--foreign-workspace keeps the exact project-local CLI and receipt store in the
controller --workspace, copies the foreign source into a disposable consumer,
and binds its canonical candidate and whole-tree before/after identities. It
never initializes or writes RunKit state in the foreign worktree.
--capture-runtime sets OWLRUNKIT_RUNTIME_REPORT for the exact command and binds
one strict command-reported external transition without conflating it with
workspace mutation. Missing or inconsistent runtime truth fails closed while
retaining the ordinary Quick receipt.
Quick evidence is not Formal acceptance and grants no repository or business authority.
`,
  "quick-runtime-verify": `Usage:
  npx --no-install owlrunkit quick-runtime-verify --workspace <directory>
    --receipt <runtime-transition.json> [--json]

Verifies the companion runtime-transition receipt, Quick receipt, command report,
and bound material bytes. It does not independently re-observe the external
runtime and grants no Git, release, deployment, production, or business authority.
`,
  "quick-metrics": `Usage:
  npx --no-install owlrunkit quick-metrics --workspace <directory> [--local] [--verbose] [--json]

Returns aggregate local-only Quick counts with no telemetry or network access.
--verbose additionally lists the receipt paths used for the aggregation.
`,
  efficiency: `Usage:
  npx --no-install owlrunkit efficiency status --workspace <directory> [--verbose] [--json]
  npx --no-install owlrunkit efficiency record --workspace <directory>
    --event-id <id> --at <ISO-UTC>
    --kind workflow_started|false_block_confirmed|manual_intervention|acceptable_result_reached
    --workflow-id <id> --summary <text> [--evidence <ref>...] [--json]

Reads project-local evidence only. False blocks and manual interventions are
counted only when explicitly recorded; receipt counts are not a value metric.
It grants no Git, release, deployment, production, or business authorization.
`,
  "efficiency record": `Usage:
  npx --no-install owlrunkit efficiency record --workspace <directory>
    --event-id <id> --at <ISO-UTC>
    --kind workflow_started|false_block_confirmed|manual_intervention|acceptable_result_reached
    --workflow-id <id> --summary <text> [--evidence <ref>...] [--json]

Creates one immutable, project-local observation. Recording friction grants no
Git, release, deployment, production, or business authorization.
`,
  "efficiency status": `Usage:
  npx --no-install owlrunkit efficiency status --workspace <directory> [--verbose] [--json]

Reports local evidence about RunKit friction without telemetry or network use.
It grants no Git, release, deployment, production, or business authorization.
`,
  "quick-reuse": `Usage:
  npx --no-install owlrunkit quick-reuse --workspace <directory>
    --base-receipt <receipt.json> --allow-path <literal-path> [--allow-path <literal-path> ...]
    (--dry-run | --apply) [--stdin-file <file>] [--json]
    -- <exact-delta-command> [args...]

Verifies that every current candidate delta is explicitly allowed. --dry-run
runs no command and writes no receipt. --apply runs only the exact delta gate
through Quick and records an additive evidence-reuse receipt. Reuse remains
non-Formal and grants no Git, release, deployment, production, or business authority.
`,
  fleet: `Usage:
  npx --no-install owlrunkit fleet register-root --fleet-root <directory>
  npx --no-install owlrunkit fleet inspect-registry [--registry <file>]
  npx --no-install owlrunkit fleet replace-registry --request <file> --receipt <file> [--registry <file>] [--dry-run]
  npx --no-install owlrunkit fleet rollback-registry --receipt <file> --rollback-receipt <file> [--registry <file>]
  npx --no-install owlrunkit fleet discover [--fleet-root <directory>] [--fleet-manifest <file>]
  npx --no-install owlrunkit fleet skill-plan --skill-root <directory> --archive-root <directory>
`,
  "fleet register-root": `Usage:
  npx --no-install owlrunkit fleet register-root --fleet-root <directory>

Registers one durable fleet coverage root for later no-argument discovery.
`,
  "fleet inspect-registry": `Usage:
  npx --no-install owlrunkit fleet inspect-registry [--registry <file>]

Reads the exact registry bytes, hashes, roots, and membership without mutation.
`,
  "fleet replace-registry": `Usage:
  npx --no-install owlrunkit fleet replace-registry --request <file> --receipt <file>
    [--registry <file>] [--dry-run]

Atomically replaces a registry from an exact preimage and evidence-bound fleet
membership. Coverage reduction requires explicit exclusion evidence.
`,
  "fleet rollback-registry": `Usage:
  npx --no-install owlrunkit fleet rollback-registry --receipt <replacement-receipt.json>
    --rollback-receipt <file> [--registry <file>]

Restores the exact preimage recorded by a replacement receipt.
`,
  "fleet discover": `Usage:
  npx --no-install owlrunkit fleet discover [--fleet-root <directory>] [--fleet-manifest <file>]
    [--workspace-root <directory>]

With no source option, discovers the complete fleet inside registered roots.
`,
  "fleet skill-plan": `Usage:
  npx --no-install owlrunkit fleet skill-plan --skill-root <installed-skill-directory>
    --archive-root <skill-archive-directory>
    [--workspace-root <directory> ... | --fleet-root <directory> ... |
     --fleet-manifest <file> | --registry <file>] [--json]

Reads the shared Skill and complete fleet, then reports affected projects,
active execution or lease blockers, and copyable dry-run, install, and rollback
commands. It never updates the Skill or any project.
`,
  profiles: `Usage:
  npx --no-install owlrunkit profiles detect --workspace <directory> [--dry-run | --apply]
  npx --no-install owlrunkit profiles reconcile --workspace <directory> (--dry-run | --apply)
  npx --no-install owlrunkit profiles validate --workspace <directory>
  npx --no-install owlrunkit profiles impact --workspace <directory> --changed <path>
`,
  "profiles detect": `Usage:
  npx --no-install owlrunkit profiles detect --workspace <directory> [--dry-run | --apply]

--dry-run reports deterministic candidates. --apply atomically adopts only a
high-confidence unambiguous profile.
`,
  "profiles reconcile": `Usage:
  npx --no-install owlrunkit profiles reconcile --workspace <directory> (--dry-run | --apply)

--dry-run previews deterministic additions and command updates without writing.
--apply atomically updates profiles.json and writes a hash-bound migration receipt.
`,
  formal: `Usage:
  npx --no-install owlrunkit formal start --workspace <directory> --run-id <id> [...]
  npx --no-install owlrunkit formal preflight --workspace <directory> --envelope <file>
  npx --no-install owlrunkit formal check --workspace <directory> --run-id <id> -- <command>
  npx --no-install owlrunkit formal attach-evidence --workspace <directory> --run-id <id> [...]
  npx --no-install owlrunkit formal finish --workspace <directory> --run-id <id>
`,
  "formal start": `Usage:
  npx --no-install owlrunkit formal start --workspace <directory> --run-id <id>
    --goal <goal.json> --work-item <id> --owned-path <path>

Creates the execution and exact writer lease.
`,
  "formal preflight": `Usage:
  npx --no-install owlrunkit formal preflight --workspace <directory>
    --envelope <verification-envelope.json> [--json]

Reads the envelope, enforcement backend, known subprocess requirements, temporary
directory needs, and protected RunKit runtime scan conflicts without executing
the command or writing Formal evidence. It grants no authorization.
`,
  "formal check": `Usage:
  npx --no-install owlrunkit formal check --workspace <directory> --run-id <id>
    (--work-item <id> | --from-lease <id>) --check-id <id>
    --envelope <verification-envelope.json>
  npx --no-install owlrunkit formal check --workspace <directory> --run-id <id>
    (--work-item <id> | --from-lease <id>) --check-id <id>
    --cwd <directory> -- <built-in-command> [args...]

Verification Envelopes admit real project commands only when file, network,
process, environment, output, timeout, and cleanup constraints are enforced.
`,
  "formal attach-evidence": `Usage:
  npx --no-install owlrunkit formal attach-evidence --workspace <directory>
    --run-id <id> --evidence-id <id> --kind supplemental-local|networked
    --receipt <quick-receipt.json> [--json]

Attests one passing Quick receipt and binds it to the current Formal source
candidate as non-gating supplemental evidence. It cannot replace a Formal check
or grant Git, release, deployment, production, or business authorization.
`,
  "formal finish": `Usage:
  npx --no-install owlrunkit formal finish --workspace <directory> --run-id <id>
    [--decision accepted|rejected|blocked] [--finalize-id <id>]

Runs the final source, evidence, permission, closeout, and lease-release path.
`,
  candidate: `Usage:
  npx --no-install owlrunkit candidate freeze --workspace <directory> --run-id <id>
    --from-lease <id> --candidate-id <id>
  npx --no-install owlrunkit candidate verify --workspace <directory> --candidate <file>
  npx --no-install owlrunkit candidate materialize --workspace <directory> --candidate <file>
    --target-workspace <directory>
`,
  "candidate freeze": `Usage:
  npx --no-install owlrunkit candidate freeze --workspace <directory> --run-id <id>
    --from-lease <id> --candidate-id <id>

Freezes the exact dirty source manifest, including deletions and renames.
`,
  "candidate verify": `Usage:
  npx --no-install owlrunkit candidate verify --workspace <directory> --candidate <file>
`,
  "candidate materialize": `Usage:
  npx --no-install owlrunkit candidate materialize --workspace <directory> --candidate <file>
    --target-workspace <directory>
`,
  deployment: `Usage:
  npx --no-install owlrunkit deployment prepare --workspace <directory> --run-id <accepted-run>
    --artifact <file> --media-type <type> --owner-decision <decision-v1.json> --output <receipt>
  npx --no-install owlrunkit deployment execute --workspace <directory> --prepare <receipt>
    --owner-decision <decision-v1.json> --owner-authority <signed-v2.json> --manifest <remote.json> [--resume]
`,
  "deployment prepare": `Usage:
  npx --no-install owlrunkit deployment prepare --workspace <directory> --run-id <accepted-run>
    --artifact <file> --media-type <type> --owner-decision <decision-v1.json> --output <receipt>
`,
  "deployment execute": `Usage:
  npx --no-install owlrunkit deployment execute --workspace <directory> --prepare <receipt>
    --owner-decision <decision-v1.json> --owner-authority <signed-v2.json> --manifest <remote.json> [--resume]

The default happy path creates and closes the deployment child, goal, lease,
profile, preflight, lineage, and result. --request is an advanced legacy path.
`,
  "core-successor": `Usage:
  npx --no-install owlrunkit core-successor plan --workspace <directory> --plan-id <id> [...]
  npx --no-install owlrunkit core-successor apply --workspace <directory> --plan <file>
    --owner-authority <signed-v2.json> --receipt-id <id>
  npx --no-install owlrunkit core-successor resume --workspace <directory> --plan <file>
    --owner-authority <signed-v2.json> [...]
`,
  "core-successor plan": `Usage:
  npx --no-install owlrunkit core-successor plan --workspace <directory> --plan-id <id>
    --run-id <id> --from-lease <id> --candidate-id <id>
    [--fleet-root <directory> | --fleet-manifest <file>]
`,
  "core-successor apply": `Usage:
  npx --no-install owlrunkit core-successor apply --workspace <directory> --plan <file>
    --owner-authority <signed-v2.json> --receipt-id <id>
`,
  "core-successor resume": `Usage:
  npx --no-install owlrunkit core-successor resume --workspace <directory> --plan <file>
    --owner-authority <signed-v2.json> [--from-receipt <file>]
`,
  status: `Usage:
  npx --no-install owlrunkit status --workspace <directory> [--json]

Shows completed milestones, current state, remaining gates, and the next allowed
action without granting any authority.
`,
  project: `Usage:
  npx --no-install owlrunkit project init --workspace <directory> --definition <project.json>
  npx --no-install owlrunkit project assign --workspace <directory> --assignment-id <id> --at <ISO-UTC> --work-item <id> --agent <id>
    [--supersedes <current-assignment-id>] [--execution-run-id <id> --execution-work-item <id>] [--json]
  npx --no-install owlrunkit project handoff --workspace <directory> --handoff-id <id> --at <ISO-UTC>
    --assignment-id <current> --work-item <id> --from-agent <id> --to-agent <id>
    --summary <text> --next <text> --evidence <ref> [--evidence <ref> ...] [--json]
  npx --no-install owlrunkit project reject-and-return --workspace <directory> --rework-id <id> --at <ISO-UTC>
    --work-item <failed-id> --reviewer-agent <id> --to-agent <id>
    --reason <text> --next <text> --evidence <ref> [--evidence <ref> ...] [--json]
  npx --no-install owlrunkit project reopen-upstream --workspace <directory> --reopen-id <id> --at <ISO-UTC>
    --upstream-work-item <completed-id> --trigger-work-item <downstream-id>
    --reviewer-agent <id> --to-agent <id> --reason <text> --next <text>
    --evidence <ref> [--evidence <ref> ...] [--json]
  npx --no-install owlrunkit project transfer --workspace <directory> --transfer-id <id> --at <ISO-UTC>
    --assignment-id <current> --work-item <id> --from-agent <id> --to-agent <id>
    --state <active|waiting_dependency|waiting_decision|verifying|ready_to_integrate>
    --summary <text> [--completed-units <nonnegative-int>]
    --evidence <ref> [--evidence <ref> ...] [--blocker <ref> ...]
    [--decision <id> ...] --next <text> [--source-fingerprint <sha256>] [--json]
  npx --no-install owlrunkit project decision --workspace <directory> --open --decision-id <id> --at <ISO-UTC>
    --title <text> --question <text> --owner-agent <id>
    [--blocking-work-item <id> ...] --option <text> [--option <text> ...] [--json]
  npx --no-install owlrunkit project decision --workspace <directory> --resolve --decision-id <id> --at <ISO-UTC>
    --resolution <text> --rationale <text> --evidence <ref> [--evidence <ref> ...] [--json]
  npx --no-install owlrunkit project checkpoint --workspace <directory> --checkpoint-id <id> --at <ISO-UTC>
    --assignment-id <current> --work-item <id>
    --state <active|waiting_dependency|waiting_decision|verifying|ready_to_integrate|completed|failed>
    --summary <text> [--completed-units <nonnegative-int>]
    [--evidence <ref> ...] [--blocker <ref> ...] [--decision <id> ...]
    [--next <text>] [--source-fingerprint <sha256>]
    [--from-quick-receipt <receipt.json>] [--json]
  npx --no-install owlrunkit project verification --workspace <directory> --defer --verification-id <id> --at <ISO-UTC>
    --work-item <id> --owner-agent <id> --check <check-id> [--check <check-id> ...]
    --reason <text> --due-gate <gate-id> [--json]
  npx --no-install owlrunkit project verification --workspace <directory> --close --verification-id <id> --at <ISO-UTC>
    --disposition <verified|no_longer_required> --summary <text>
    [--evidence <ref> ...] [--decision <resolved-decision-id> ...] [--json]
  npx --no-install owlrunkit project integrate --workspace <directory> --gate <gate-id> --at <ISO-UTC>
    --summary <text> --evidence <ref> [--evidence <ref> ...] [--json]
  npx --no-install owlrunkit project <checkpoint|handoff|decision|verification|integrate|capture> --workspace <directory> --request <event.json>
  npx --no-install owlrunkit project target-snapshot --workspace <controller> --snapshot-id <id> --at <ISO-UTC> --work-item <id> --target-workspace <frozen-worktree> --dry-run|--apply
  npx --no-install owlrunkit project import-delivery --workspace <controller> --delivery-id <id> --at <ISO-UTC> --assignment-id <current> --work-item <id> --producer <id> --target-workspace <frozen-worktree> --packet <delivery-packet.json> --dry-run|--apply
  npx --no-install owlrunkit project status --workspace <directory> [--json]
  npx --no-install owlrunkit project takeover --workspace <directory> --agent <id> [--json]
  npx --no-install owlrunkit project successor --workspace <directory> --transition-id <id> --at <ISO-UTC>
    --definition <project.json> --reason <text> [--json]
  npx --no-install owlrunkit project successor scaffold --workspace <directory>
    --from-workspace <git-worktree> --dry-run [--json]

Project status is derived from durable work items, Agent assignments,
dependencies, decisions, checkpoints, integration gates, and evidence refs.
No self-reported percentage is accepted.
`,
  "project checkpoint": `Usage:
  npx --no-install owlrunkit project checkpoint --workspace <directory> --checkpoint-id <id> --at <ISO-UTC>
    --assignment-id <current> --work-item <id>
    --state <active|waiting_dependency|waiting_decision|verifying|ready_to_integrate|completed|failed>
    --summary <text> [--completed-units <nonnegative-int>]
    [--evidence <ref> ...] [--blocker <ref> ...] [--decision <id> ...]
    [--next <text>] [--source-fingerprint <sha256>] [--json]

Measured WorkItems require --completed-units on every checkpoint. A completed
checkpoint must use the WorkItem's declared total. Example:
  npx --no-install owlrunkit project checkpoint --workspace . --checkpoint-id checkpoint-x --at 2026-08-11T00:00:00.000Z --assignment-id assign-x --work-item x --state completed --summary 'Completed x.' --completed-units 5 --evidence receipt:quick

--from-quick-receipt re-attests and atomically binds one current GO Quick
receipt. It is required only when an explicit WorkItem evidence policy says so.
`,
  "project init": `Usage:
  npx --no-install owlrunkit project init --workspace <directory>
    --definition <project-definition.json> [--json]

Creates one project-owned definition and empty immutable event journal. It does
not grant Git, release, deployment, production, or business authorization.
`,
  "project assign": `Usage:
  npx --no-install owlrunkit project assign --workspace <directory>
    --assignment-id <id> --at <ISO-UTC> --work-item <id> --agent <id>
    [--supersedes <current-assignment-id>]
    [--execution-run-id <id> --execution-work-item <id>] [--json]

Assigns one current WorkItem owner without granting Git, release, deployment,
production, business, or other authorization.
`,
  "project handoff": `Usage:
  npx --no-install owlrunkit project handoff --workspace <directory>
    --handoff-id <id> --at <ISO-UTC> --assignment-id <current>
    --work-item <id> --from-agent <id> --to-agent <id>
    --summary <text> --next <text> --evidence <ref> [--evidence <ref> ...] [--json]

Records an immutable handoff without assigning successor authority or granting
Git, release, deployment, production, or business authorization.
`,
  "project decision": `Usage:
  npx --no-install owlrunkit project decision --workspace <directory>
    --open --decision-id <id> --at <ISO-UTC> --title <text> --question <text>
    --owner-agent <id> [--blocking-work-item <id> ...]
    --option <text> [--option <text> ...] [--json]
  npx --no-install owlrunkit project decision --workspace <directory>
    --resolve --decision-id <id> --at <ISO-UTC> --resolution <text>
    --rationale <text> --evidence <ref> [--evidence <ref> ...] [--json]

Opens or resolves one durable project decision. Resolution records truth but
does not grant Git, release, deployment, production, or business authorization.
`,
  "project verification": `Usage:
  npx --no-install owlrunkit project verification --workspace <directory>
    --defer --verification-id <id> --at <ISO-UTC> --work-item <id>
    --owner-agent <id> --check <check-id> [--check <check-id> ...]
    --reason <text> --due-gate <gate-id> [--json]
  npx --no-install owlrunkit project verification --workspace <directory>
    --close --verification-id <id> --at <ISO-UTC>
    --disposition <verified|no_longer_required> --summary <text>
    [--evidence <ref> ...] [--decision <resolved-decision-id> ...] [--json]

Records an intentionally deferred check or closes it with evidence. It does not
execute the check and grants no additional authorization.
`,
  "project integrate": `Usage:
  npx --no-install owlrunkit project integrate --workspace <directory>
    --gate <gate-id> --at <ISO-UTC> --summary <text>
    --evidence <ref> [--evidence <ref> ...] [--json]

Records one passed integration gate after its dependencies and deferred checks
are satisfied. It does not perform Git integration or grant release authority.
`,
  "project capture": `Usage:
  npx --no-install owlrunkit project capture --workspace <directory>
    --request <legacy-event.json> [--json]

Compatibility-only raw event capture. External source delivery must use
project import-delivery. This action grants no repository or business authority.
`,
  "project reject-and-return": `Usage:
  npx --no-install owlrunkit project reject-and-return --workspace <directory> --rework-id <id> --at <ISO-UTC>
    --work-item <failed-id> --reviewer-agent <id> --to-agent <id>
    --reason <text> --next <text> --evidence <ref> [--evidence <ref> ...] [--json]

Atomically records the rejection and opens a new assigned rework attempt. The
failed attempt remains immutable and evidence-linked. This action does not
  grant Git, release, deployment, production, or business authority.
  `,
  "project reopen-upstream": `Usage:
  npx --no-install owlrunkit project reopen-upstream --workspace <directory>
    --reopen-id <id> --at <ISO-UTC> --upstream-work-item <completed-id>
    --trigger-work-item <transitive-downstream-id> --reviewer-agent <id>
    --to-agent <id> --reason <text> --next <text>
    --evidence <ref> [--evidence <ref> ...] [--json]

Invalidates stale completion truth for the upstream WorkItem and every transitive
downstream WorkItem, then creates a new upstream assignment. Passed integration
gates remain immutable. No Git, release, deployment, production, or business
authority is granted.
`,
  "project transfer": `Usage:
  npx --no-install owlrunkit project transfer --workspace <directory>
    --transfer-id <id> --at <ISO-UTC> --assignment-id <current>
    --work-item <id> --from-agent <id> --to-agent <id>
    --state <active|waiting_dependency|waiting_decision|verifying|ready_to_integrate>
    --summary <text> [--completed-units <nonnegative-int>]
    --evidence <ref> [--evidence <ref> ...] [--blocker <ref> ...]
    [--decision <id> ...] --next <text> [--source-fingerprint <sha256>] [--json]

Atomically records checkpoint, handoff, and successor-assignment facts inside one
immutable Event V4 envelope. Terminal WorkItems cannot transfer. No Git, release,
deployment, production, or business authority is granted.
`,
  "project work-item revise-scope": `Usage:
  npx --no-install owlrunkit project work-item revise-scope --workspace <directory>
    --revision-id <id> --at <ISO-UTC> --assignment-id <current>
    --work-item <id> --owner-agent <current-owner>
    [--owned-path <path> ...]
    [--measurable-unit <unit> --measurable-total <positive-int> | --unmeasured]
    --reason <text> [--evidence <ref> ...] [--json]

Records an immutable Event V5 that supersedes the WorkItem's prior scope. Omitted
ownedPaths or measurable fields retain their current values. The event never
rewrites the project definition and grants no Git, release, deployment,
production, or business authority.
`,
  "project target-snapshot": `Usage:
  npx --no-install owlrunkit project target-snapshot --workspace <controller>
    --snapshot-id <id> --at <ISO-UTC> --work-item <id>
    --target-workspace <frozen-worktree> [--allowed-path <path> ...]
    --dry-run|--apply [--json]

Captures target HEAD and the visible dirty overlay into the controller project.
It does not write the target worktree or grant Git, release, deployment,
production, business, or other authorization.
`,
  "project import-delivery": `Usage:
  npx --no-install owlrunkit project import-delivery --workspace <controller>
    --delivery-id <id> --at <ISO-UTC> --assignment-id <current>
    --work-item <id> --producer <id> --target-workspace <frozen-worktree>
    --packet <delivery-packet.json> [--entry-snapshot <id>]
    --dry-run|--apply [--json]

Verifies the external DeliveryPacket against the read-only target and records
candidate identity in Project Driver only with --apply. Without an entry
snapshot it reports candidate_only and does not claim entry-to-candidate proof.
No Git, release, deployment, production, business, or other authorization is granted.
`,
  "project status": `Usage:
  npx --no-install owlrunkit project status --workspace <directory> [--json]
`,
  "project takeover": `Usage:
  npx --no-install owlrunkit project takeover --workspace <directory> --agent <id> [--json]

Builds a read-only blank-session recovery packet for one Agent.
`,
  "project successor": `Usage:
  npx --no-install owlrunkit project successor --workspace <directory> --transition-id <id> --at <ISO-UTC>
    --definition <project.json> --reason <text> [--json]

Archives one derived-completed active project and installs one fresh active
project with no inherited events. The receipt grants no repository or release authority.
`,
  "project successor scaffold": `Usage:
  npx --no-install owlrunkit project successor scaffold --workspace <directory>
    --from-workspace <git-worktree> --dry-run [--json]

Reads one completed Project Driver ledger, its latest explicitly imported source
delivery baseline, and the exact current Git worktree. It reports terminal,
baseline-missing, or unmodeled-drift truth plus review-only path lanes. It does
not create a project, append an event, infer an objective, dispatch an Agent, or
grant Git, release, deployment, production, or business authority.
`,
});

function withHumanOutput(result, humanOutput) {
  Object.defineProperty(result, "humanOutput", {
    configurable: false,
    enumerable: false,
    value: humanOutput,
    writable: false,
  });
  return result;
}

function presentQuickOutcome(result, json) {
  const presented = {
    ...result,
    outcome: projectQuickOutcomeV1(result),
    authorizationGranted: false,
  };
  return json === true
    ? presented
    : withHumanOutput(presented, formatQuickOutcomeHumanV1(presented.outcome));
}

function shellCommandToken(value) {
  const text = String(value);
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(text)
    ? text
    : `'${text.replaceAll("'", `'"'"'`)}'`;
}

function correctedCheckpointCommand(argv, completedUnits) {
  const corrected = [...argv];
  const jsonIndex = corrected.indexOf("--json");
  corrected.splice(
    jsonIndex === -1 ? corrected.length : jsonIndex,
    0,
    "--completed-units",
    String(completedUnits),
  );
  return `npx --no-install owlrunkit ${corrected.map(shellCommandToken).join(" ")}`;
}

function formatTeamProjectAssignmentHuman(result) {
  const disposition = result.resumed ? "Resumed" : "Assigned";
  const nextAction = result.nextAction === null
    ? "none"
    : String(result.nextAction).replace(/\s+/gu, " ").trim();
  return [
    `${disposition} WorkItem ${result.workItemId} to Agent ${result.agentId}.`,
    `Project next: ${nextAction}${result.nextActorId ? ` (owner ${result.nextActorId})` : ""}`,
    `Assignment: ${result.assignmentId}`,
    "",
  ].join("\n");
}

function formatTeamProjectHandoffHuman(result) {
  const disposition = result.resumed ? "Resumed" : "Handed off";
  const targetNextAction = result.targetNextAction === null
    ? "none"
    : String(result.targetNextAction).replace(/\s+/gu, " ").trim();
  const projectNextAction = result.nextAction === null
    ? "none"
    : String(result.nextAction).replace(/\s+/gu, " ").trim();
  return [
    `${disposition} WorkItem ${result.workItemId} from Agent ${result.fromAgentId} to Agent ${result.toAgentId}.`,
    `Target next: ${targetNextAction}`,
    `Project next: ${projectNextAction}${result.nextActorId ? ` (owner ${result.nextActorId})` : ""}`,
    `Handoff: ${result.handoffId}`,
    "",
  ].join("\n");
}

function formatTeamProjectReworkHuman(result) {
  const disposition = result.resumed ? "Resumed" : "Returned";
  const nextAction = result.nextAction === null
    ? "none"
    : String(result.nextAction).replace(/\s+/gu, " ").trim();
  return [
    `${disposition} failed WorkItem ${result.workItemId} to Agent ${result.toAgentId} for rework attempt ${result.reworkAttempt}.`,
    `Failed checkpoint preserved: ${result.failedCheckpointEventId}`,
    `Next: ${nextAction}`,
    `Rework assignment: ${result.assignmentId}`,
    "",
  ].join("\n");
}

function formatTeamProjectUpstreamReopenHuman(result) {
  const disposition = result.resumed ? "Resumed" : "Reopened";
  return [
    `${disposition} upstream WorkItem ${result.upstreamWorkItemId} for Agent ${result.toAgentId}.`,
    `Invalidated completion: ${result.invalidatedWorkItemIds.join(", ")}`,
    `Project next: ${result.nextAction ?? "none"}${result.nextActorId ? ` (owner ${result.nextActorId})` : ""}`,
    "Git/release/deployment/business authority: not granted.",
    "",
  ].join("\n");
}

function formatTeamProjectTransferHuman(result) {
  const disposition = result.resumed ? "Resumed" : "Transferred";
  return [
    `${disposition} WorkItem ${result.workItemId} from Agent ${result.fromAgentId} to Agent ${result.toAgentId}.`,
    `New assignment: ${result.assignmentId}; immutable facts: ${result.factRefs.length}`,
    `Project next: ${result.nextAction ?? "none"}${result.nextActorId ? ` (owner ${result.nextActorId})` : ""}`,
    "Git/release/deployment/business authority: not granted.",
    "",
  ].join("\n");
}

function formatTargetSnapshotHuman(result) {
  return [
    result.persisted
      ? `Captured target snapshot ${result.snapshotId}.`
      : `Previewed target snapshot ${result.snapshotId}; nothing persisted.`,
    `Target: ${result.targetWorkspaceRef}`,
    `HEAD: ${result.targetHead}`,
    `Allowed paths: ${result.allowedPaths.join(", ")}`,
    "Target write: no; authorization granted: no.",
    "",
  ].join("\n");
}

function formatExternalDeliveryHuman(result) {
  if (result.status === "external_delivery_rejected") {
    return [
      `Rejected external delivery ${result.deliveryId}.`,
      `Out-of-scope source: ${result.overlay?.outOfScopeSourcePaths?.join(", ") || "none"}`,
      "Nothing was added to Project Driver; authorization granted: no.",
      "",
    ].join("\n");
  }
  return [
    result.persisted
      ? `Imported external delivery ${result.deliveryId}.`
      : `Previewed external delivery ${result.deliveryId}; nothing persisted.`,
    `Candidate: ${result.deliveryCandidateFingerprint}`,
    `Overlay: ${result.overlay.status}`,
    `Tool cache changes: ${result.overlay.toolCachePaths.join(", ") || "none"}`,
    `Dependency environment changes: ${result.overlay.dependencyEnvironmentPaths.join(", ") || "none"}`,
    `Not proven: ${result.notProven.join(" ")}`,
    "Target write: no; authorization granted: no.",
    "",
  ].join("\n");
}

function formatTeamProjectDecisionHuman(result) {
  const disposition = result.resumed
    ? "Resumed"
    : result.operation === "opened" ? "Opened" : "Resolved";
  const owner = result.ownerAgentId ? ` for Agent ${result.ownerAgentId}` : "";
  const nextAction = result.nextAction === null
    ? "none"
    : String(result.nextAction).replace(/\s+/gu, " ").trim();
  return [
    `${disposition} decision ${result.decisionId}${owner}.`,
    `Project next: ${nextAction}${result.nextActorId ? ` (owner ${result.nextActorId})` : ""}`,
    `Decision: ${result.decisionId}`,
    "",
  ].join("\n");
}

function formatTeamProjectVerificationHuman(result) {
  const disposition = result.resumed
    ? "Resumed"
    : result.operation === "deferred" ? "Deferred" : "Closed";
  const nextAction = result.nextAction === null
    ? "none"
    : String(result.nextAction).replace(/\s+/gu, " ").trim();
  return [
    `${disposition} project verification ${result.verificationId}: ${result.verificationStatus}.`,
    `Due gate: ${result.dueGateId}; gate state: ${result.gateStatus}.`,
    `Project state: ${result.overall}; next: ${nextAction}${result.nextActorId ? ` (owner ${result.nextActorId})` : ""}`,
    "No verification command, Git, or release action was performed.",
    "",
  ].join("\n");
}

function formatTeamProjectIntegrationHuman(result) {
  const disposition = result.resumed ? "Resumed" : "Passed";
  const nextAction = result.nextAction === null
    ? "none"
    : String(result.nextAction).replace(/\s+/gu, " ").trim();
  return [
    `${disposition} project integration gate ${result.gateId}.`,
    `Work ledger: ${result.overall}; delivery: ${result.deliveryDisposition}; next: ${nextAction}${result.nextActorId ? ` (owner ${result.nextActorId})` : ""}`,
    "Git/release not performed.",
    "",
  ].join("\n");
}

function formatTeamProjectCheckpointHuman(result) {
  const disposition = result.resumed ? "Resumed" : "Recorded";
  const nextAction = result.nextAction === null
    ? "none"
    : String(result.nextAction).replace(/\s+/gu, " ").trim();
  return [
    `${disposition} checkpoint ${result.checkpointId} for WorkItem ${result.workItemId}: ${result.state}.`,
    `Project state: ${result.overall}; next: ${nextAction}${result.nextActorId ? ` (owner ${result.nextActorId})` : ""}`,
    ...(result.warnings?.length > 0
      ? [`Warning: ${result.warnings.map(row => row.code).join(", ")}.`]
      : []),
    "",
  ].join("\n");
}

function profilesReadiness(root) {
  if (!root) return { valid: false, launcherWarnings: [] };
  try {
    const validation = validateProfiles({ workspaceRoot: root });
    const launchers = readProfileLauncherReadiness({ workspaceRoot: root });
    return {
      valid: validation.valid === true && launchers.status === "ok",
      launcherWarnings: launchers.launcherWarnings,
    };
  } catch {
    return { valid: false, launcherWarnings: [] };
  }
}

function onboardingProjection(root, recovery = null) {
  const profiles = profilesReadiness(root);
  const adoption = root
    ? readAdoptionReadiness({ workspaceRoot: root })
    : { status: "missing" };
  const profilesReady = profiles.valid;
  const adoptionReady = adoption.status === "ok";
  const maintenanceNextAction = profiles.launcherWarnings.length > 0
    ? "review_profile_launchers"
    : null;
  if (profilesReady && adoptionReady) {
    return {
      ...(maintenanceNextAction
        ? {
            status: "completed_with_maintenance_warnings",
            maintenanceNextAction,
          }
        : {}),
      nextAllowedAction: recovery?.nextAllowedAction ?? "plan_new_execution",
      completed: true,
      steps: [],
    };
  }
  const steps = [
    {
      id: "doctor",
      command: "npx --no-install owlrunkit doctor --workspace .",
    },
    ...(!profilesReady
      ? [{
          id: "profiles_detect",
          command: "npx --no-install owlrunkit profiles detect --workspace . --dry-run",
        }]
      : []),
    ...(!adoptionReady
      ? [{
          id: "adopt_or_start",
          command: `npx --no-install owlrunkit adopt --workspace . --exact owlrunkit@${CORE_VERSION} or npx --no-install owlrunkit start`,
        }]
      : []),
  ];
  return {
    nextAllowedAction: "run_onboarding_diagnostics",
    ...(maintenanceNextAction ? { maintenanceNextAction } : {}),
    completed: false,
    steps,
  };
}

function parseOptions(values, { multi = [], boolean = [] } = {}) {
  const options = {};
  const multiNames = new Set(multi);
  const booleanNames = new Set(boolean);
  for (let index = 0; index < values.length;) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error("Options must use --name flags.");
    const name = key.slice(2);
    if (booleanNames.has(name)) {
      if (name in options) throw new Error(`Duplicate option: ${key}`);
      options[name] = true;
      index += 1;
      continue;
    }
    const value = values[index + 1];
    if (value === undefined) throw new Error("Options must be --name value pairs.");
    if (multiNames.has(name)) {
      if (!(name in options)) options[name] = [];
      options[name].push(value);
    } else {
      if (name in options) throw new Error(`Duplicate option: ${key}`);
      options[name] = value;
    }
    index += 2;
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} is required.`);
  return value;
}

function assertOnlyOptions(options, allowedNames) {
  const allowed = new Set(allowedNames);
  const unsupported = Object.keys(options)
    .filter(name => !allowed.has(name))
    .sort();
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported option${unsupported.length === 1 ? "" : "s"}: `
      + unsupported.map(name => `--${name}`).join(", "),
    );
  }
}

function parseCanonicalNonnegativeSafeInteger(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`--${label} must be a canonical non-negative safe integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${label} must be a canonical non-negative safe integer.`);
  }
  return parsed;
}

function readWorkspaceArtifact(root, value, label) {
  const relativePath = safeRelativePath(value, label);
  return readJson(realpathSync(path.join(root, relativePath)));
}

function writeWorkspaceArtifact(root, value, label, artifact) {
  const relativePath = safeRelativePath(value, label);
  const outputPath = path.join(root, relativePath);
  writeJsonExclusiveAtomically(outputPath, artifact);
  return relativeToWorkspace(root, outputPath);
}

function writeOrVerifyWorkspaceArtifact(root, value, label, artifact) {
  const relativePath = safeRelativePath(value, label);
  const outputPath = path.join(root, relativePath);
  const expectedBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  if (!pathEntryExists(outputPath)) {
    writeJsonExclusiveAtomically(outputPath, artifact);
    return relativeToWorkspace(root, outputPath);
  }
  const stat = lstatSync(outputPath);
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || realpathSync(outputPath) !== outputPath
    || !readFileSync(outputPath).equals(expectedBytes)
  ) {
    throw new Error(`${label} existing artifact does not match exact bytes.`);
  }
  return relativeToWorkspace(root, outputPath);
}

function safeRunId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === "." || value === "..") {
    throw new Error("run-id must use letters, digits, dot, underscore, or hyphen without path separators.");
  }
  return value;
}

function workspace(options) {
  return realpathSync(requireOption(options, "workspace"));
}

function runtimePath(root, ...segments) {
  return path.resolve(root, RUNTIME_ROOT, ...segments);
}

function pathEntryExists(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactRegularFile(filePath, expectedSha256, label) {
  const resolved = realpathSync(filePath);
  if (resolved !== filePath) {
    throw new Error(`${label} must already use its canonical real path.`);
  }
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  if (sha256(readFileSync(resolved)) !== expectedSha256) {
    throw new Error(`${label} hash mismatch.`);
  }
  return resolved;
}

function declaredAdapterIdentity(adapter) {
  return {
    adapterId: adapter.adapterId,
    version: adapter.version,
    executable: adapter.executable,
    sha256: adapter.sha256,
  };
}

function createDeclaredRemoteAdapter(manifest, workspaceRoot) {
  const { normalized } = validateRemoteDeploymentManifest(manifest);
  const declaration = normalized.adapter;
  if (declaration.kind !== "builtin_ssh") {
    exactRegularFile(
      declaration.executable,
      declaration.sha256,
      "Remote deployment adapter executable",
    );
    return createRemoteProcessAdapterV1({
      identity: declaredAdapterIdentity(declaration),
      workspaceRoot,
    });
  }
  const builtInIdentity = builtInSshRemoteAdapterIdentityV1();
  if (
    JSON.stringify(declaredAdapterIdentity(declaration))
    !== JSON.stringify(builtInIdentity)
  ) {
    throw new Error(
      "Built-in SSH adapter declaration does not match this exact OwlRunKit Core.",
    );
  }
  exactRegularFile(
    declaration.executable,
    declaration.sha256,
    "Built-in SSH adapter module",
  );
  const knownHostsPath = exactRegularFile(
    declaration.knownHostsPath,
    normalized.target.hostKeySha256,
    "Built-in SSH known_hosts file",
  );
  const sshExecutable = exactRegularFile(
    declaration.sshExecutable,
    declaration.sshExecutableSha256,
    "Built-in SSH executable",
  );
  const credential = declaration.authentication.mode === "agent"
    ? {
        ref: normalized.credentialRef,
        mode: "agent",
      }
    : {
        ref: normalized.credentialRef,
        mode: "identity_file",
        identityFile: {
          path: exactRegularFile(
            declaration.authentication.identityFile.path,
            declaration.authentication.identityFile.sha256,
            "Built-in SSH identity file",
          ),
          sha256: declaration.authentication.identityFile.sha256,
        },
      };
  return createSshRemoteAdapterV1({
    target: normalized.target,
    credential,
    knownHostsPath,
    workspaceRoot,
    remoteHelper: declaration.remoteHelper,
    stageContracts: declaration.stageContracts,
    sshExecutable,
    sshExecutableSha256: declaration.sshExecutableSha256,
  });
}

function writeJson(filePath, value, flag = "wx") {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag });
}

function appendEvent(executionRoot, event) {
  appendFileSync(path.join(executionRoot, "events.jsonl"), `${JSON.stringify(event)}\n`);
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function inspectDirectory(root, directory, label, issues) {
  try {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      issues.push(`${label} must be a real directory, not a symlink: ${relativePath(root, directory)}`);
      return false;
    }
    const realRoot = realpathSync(root);
    const realDirectory = realpathSync(directory);
    if (realDirectory !== path.resolve(directory) || !withinRoot(realRoot, realDirectory)) {
      issues.push(`${label} must remain inside the project without symlink ancestors: ${relativePath(root, directory)}`);
      return false;
    }
    return true;
  } catch {
    issues.push(`${label} is unreadable: ${relativePath(root, directory)}`);
    return false;
  }
}

function invalidOpenExecution(runId, issues) {
  return {
    runId,
    lifecycle: "unknown",
    historical: false,
    enginePin: { status: "invalid_artifact", exitCode: 2, issues: [...issues] },
    recovery: {
      lease: { status: "invalid", workItemIds: [], activeWorkItemIds: [], releasedWorkItemIds: [], issues: [...issues] },
      delivery: { status: "invalid", issues: [...issues] },
      verification: { status: "invalid", issues: [...issues] },
      evidenceTrustLevel: "invalid",
      nextAllowedAction: "repair_execution_artifacts",
      issues: [...issues],
    },
  };
}

function findNamedFiles(root, searchRoot, name, label, issues) {
  if (!pathEntryExists(searchRoot)) return [];
  if (!inspectDirectory(root, searchRoot, `${label} directory`, issues)) return [];
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareCodeUnits(left.name, right.name))) {
      const entryPath = path.join(directory, entry.name);
      const stat = lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        issues.push(`${label} artifact must not be a symlink: ${relativePath(root, entryPath)}`);
      } else if (stat.isDirectory()) {
        if (inspectDirectory(root, entryPath, `${label} directory`, issues)) visit(entryPath);
      } else if (stat.isFile() && entry.name === name) {
        found.push(entryPath);
      } else if (!stat.isFile()) {
        issues.push(`${label} artifact must be a regular file: ${relativePath(root, entryPath)}`);
      }
    }
  };
  visit(searchRoot);
  return found;
}

function inspectFlatJsonFiles(root, directory, directoryLabel, artifactLabel) {
  if (!pathEntryExists(directory)) return { files: [], issues: [] };
  const issues = [];
  if (!inspectDirectory(root, directory, directoryLabel, issues)) return { files: [], issues };
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareCodeUnits(left.name, right.name))) {
    const entryPath = path.join(directory, entry.name);
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      issues.push(`${artifactLabel} must be a regular file, not a symlink: ${relativePath(root, entryPath)}`);
    } else if (stat.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    } else if (!stat.isFile()) {
      issues.push(`${artifactLabel} must be a regular file: ${relativePath(root, entryPath)}`);
    }
  }
  return { files, issues };
}

function readJsonForInspection(root, filePath, label, issues) {
  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      issues.push(`${label} must be a regular file, not a symlink: ${relativePath(root, filePath)}`);
      return null;
    }
    const realRoot = realpathSync(root);
    const realFile = realpathSync(filePath);
    if (realFile !== path.resolve(filePath) || !withinRoot(realRoot, realFile)) {
      issues.push(`${label} must remain inside the project without symlink ancestors: ${relativePath(root, filePath)}`);
      return null;
    }
    return readJson(realFile);
  } catch {
    issues.push(`${label} must contain valid JSON: ${relativePath(root, filePath)}`);
    return null;
  }
}

function inspectActiveLeases(root, executionRoot) {
  const leasesRoot = path.join(executionRoot, "leases");
  if (!pathEntryExists(leasesRoot)) {
    return { status: "none", workItemIds: [], activeWorkItemIds: [], releasedWorkItemIds: [], issues: [] };
  }
  const issues = [];
  if (!inspectDirectory(root, leasesRoot, "Lease directory", issues)) {
    return { status: "invalid", workItemIds: [], activeWorkItemIds: [], releasedWorkItemIds: [], issues };
  }
  const files = [];
  for (const entry of readdirSync(leasesRoot, { withFileTypes: true }).sort((left, right) => compareCodeUnits(left.name, right.name))) {
    const entryPath = path.join(leasesRoot, entry.name);
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      issues.push(`Lease artifact must be a regular file, not a symlink: ${relativePath(root, entryPath)}`);
    } else if (stat.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    } else if (!stat.isFile()) {
      issues.push(`Lease artifact must be a regular file: ${relativePath(root, entryPath)}`);
    }
  }
  if (files.length === 0) {
    return {
      status: issues.length > 0 ? "invalid" : "none",
      workItemIds: [],
      activeWorkItemIds: [],
      releasedWorkItemIds: [],
      issues,
    };
  }
  const leases = files.map((filePath) => readJsonForInspection(root, filePath, "lease", issues)).filter(Boolean);
  for (const lease of leases) {
    if (lease.schemaVersion !== "OwlCodaRunKitWorkerLeaseV1") issues.push("lease schemaVersion is invalid");
    if (typeof lease.workItemId !== "string" || lease.workItemId.length === 0) issues.push("lease workItemId is required");
    if (!Number.isInteger(lease.attempt) || lease.attempt < 1) issues.push("lease attempt must be a positive integer");
    try {
      validateLeaseOwnedPaths(lease.ownedPaths);
    } catch (error) {
      issues.push(`lease ownedPaths are invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!new Set(["active", "released"]).has(lease.state)) issues.push("lease state must be active or released");
  }
  const workItemIds = leases.map((lease) => lease.workItemId).filter((value) => typeof value === "string").sort();
  if (new Set(workItemIds).size !== workItemIds.length) issues.push("lease workItemId values must be unique");
  const activeWorkItemIds = leases.filter((lease) => lease.state === "active").map((lease) => lease.workItemId).sort();
  const releasedWorkItemIds = leases.filter((lease) => lease.state === "released").map((lease) => lease.workItemId).sort();
  return {
    status: issues.length > 0 ? "invalid" : activeWorkItemIds.length > 0 ? "active" : "released",
    workItemIds,
    activeWorkItemIds,
    releasedWorkItemIds,
    issues,
  };
}

function inspectActiveVerification(root, executionRoot, runId) {
  const receiptsRoot = path.join(executionRoot, "verification-receipts");
  const issues = [];
  const lineagePaths = findNamedFiles(
    root,
    receiptsRoot,
    "receipt-lineage.json",
    "Verification receipt",
    issues,
  );
  if (issues.length > 0) return { status: "invalid", issues };
  if (lineagePaths.length === 0) return { status: "missing", issues: [] };
  if (lineagePaths.length > 1) {
    return { status: "invalid", issues: ["multiple receipt lineage files require explicit repair"] };
  }
  const entries = readJsonForInspection(root, lineagePaths[0], "receipt lineage", issues);
  if (!entries) return { status: "invalid", issues };
  const lineage = validateReceiptLineage(Array.isArray(entries) ? entries : entries.receipts);
  if (!lineage.valid || !lineage.active) {
    return { status: "invalid", issues: lineage.issues?.map((item) => item.message ?? String(item)) ?? ["receipt lineage is invalid"] };
  }
  if (lineage.active.receipt.runId !== runId) {
    return { status: "invalid", issues: ["active receipt runId does not match the execution"] };
  }
  const matchingGates = [];
  const gateIssues = [];
  for (const gatePath of findNamedFiles(
    root,
    receiptsRoot,
    "verification-gate-input.json",
    "Verification receipt",
    gateIssues,
  )) {
    const gateInput = readJsonForInspection(root, gatePath, "verification gate input", gateIssues);
    if (!gateInput) continue;
    const gate = validateVerificationReceiptGate(gateInput);
    if (gate.accepted && gate.activeReceiptSha256 === lineage.active.receiptSha256) {
      matchingGates.push({ gatePath, gate });
    }
  }
  if (matchingGates.length !== 1) {
    return {
      status: "invalid",
      activeReceiptSha256: lineage.active.receiptSha256,
      issues: [
        ...gateIssues,
        matchingGates.length === 0
          ? "active receipt does not have one accepted verification gate"
          : "active receipt has multiple accepted verification gates",
      ],
    };
  }
  const { gatePath, gate } = matchingGates[0];
  return {
    status: "passed",
    decision: gate.decision,
    activeReceiptSha256: gate.activeReceiptSha256,
    sourceFingerprint: gate.sourceFingerprint,
    receiptId: lineage.active.receipt.receiptId,
    gateInputPath: relativePath(root, gatePath),
    issues: [],
  };
}

function inspectActiveDelivery(root, executionRoot, runId, preferredFingerprint) {
  const packetsRoot = path.join(executionRoot, "delivery-packets");
  const listing = inspectFlatJsonFiles(root, packetsRoot, "Delivery packet directory", "Delivery packet artifact");
  const packetPaths = listing.files;
  if (listing.issues.length > 0) {
    return { status: "invalid", packetPaths: [], stalePacketPaths: [], issues: listing.issues };
  }
  if (packetPaths.length === 0) return { status: "missing", packetPaths: [], stalePacketPaths: [], issues: [] };
  const issues = [];
  const fresh = [];
  const stalePacketPaths = [];
  for (const packetPath of packetPaths) {
    const packet = readJsonForInspection(root, packetPath, "delivery packet", issues);
    if (!packet) continue;
    if (packet.runId !== runId) {
      issues.push(`delivery packet runId does not match the execution: ${relativePath(root, packetPath)}`);
      continue;
    }
    const gate = verifyDeliveryPacket({ workspaceRoot: root, packet });
    if (gate.status === "valid") {
      fresh.push({ path: packetPath, sourceFingerprint: gate.recomputedFingerprint });
    } else if (gate.status === "invalidated_by_concurrent_write") {
      stalePacketPaths.push(relativePath(root, packetPath));
    } else {
      issues.push(...(gate.issues ?? []).map((item) => `${relativePath(root, packetPath)}: ${item.message ?? item}`));
    }
  }
  const matching = collapseByteIdenticalDeliveryCandidates(preferredFingerprint
    ? fresh.filter((item) => item.sourceFingerprint === preferredFingerprint)
    : fresh);
  if (matching.length === 1) {
    return {
      status: "fresh",
      packetPaths: packetPaths.map((item) => relativePath(root, item)),
      selectedPacketPath: relativePath(root, matching[0].path),
      sourceFingerprint: matching[0].sourceFingerprint,
      stalePacketPaths,
      issues,
    };
  }
  if (fresh.length === 0 && stalePacketPaths.length > 0 && issues.length === 0) {
    return { status: "stale", packetPaths: packetPaths.map((item) => relativePath(root, item)), stalePacketPaths, issues: [] };
  }
  return {
    status: "invalid",
    packetPaths: packetPaths.map((item) => relativePath(root, item)),
    stalePacketPaths,
    issues: [
      ...issues,
      preferredFingerprint && matching.length === 0
        ? "no fresh delivery packet matches the active verification receipt"
        : "multiple fresh delivery packets require explicit selection",
    ],
  };
}

function inspectResourcePreflights(root, executionRoot, runId) {
  const resourceRoot = path.join(executionRoot, "resource-preflights");
  const listing = inspectFlatJsonFiles(
    root,
    resourceRoot,
    "Resource preflight directory",
    "Resource preflight artifact",
  );
  if (listing.issues.length > 0) return { status: "invalid", selected: null, issues: listing.issues };
  if (listing.files.length === 0) return { status: "none", selected: null, issues: [] };
  const summaries = [];
  const issues = [];
  for (const artifactPath of listing.files) {
    const artifact = readJsonForInspection(root, artifactPath, "resource preflight", issues);
    if (!artifact) continue;
    try {
      const summary = summarizeResourcePreflight(artifact, runId);
      const bindingIssues = inspectResourceVerificationPlanBinding(root, executionRoot, runId, artifact);
      if (bindingIssues.length > 0) {
        issues.push(...bindingIssues.map(issue => `${relativePath(root, artifactPath)}: ${issue}`));
        continue;
      }
      summaries.push({
        ...summary,
        artifactPath: relativePath(root, artifactPath),
      });
    } catch (error) {
      issues.push(`${relativePath(root, artifactPath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const sequences = summaries.map(summary => summary.sequence);
  if (new Set(sequences).size !== sequences.length) issues.push("resource preflight sequences must be unique");
  if (issues.length > 0) return { status: "invalid", selected: null, issues };
  const selected = [...summaries].sort((left, right) => right.sequence - left.sequence)[0];
  const expired = selected.validUntil !== null && Date.now() > new Date(selected.validUntil).getTime();
  return {
    status: expired ? "expired" : "current",
    selected,
    artifactPaths: summaries.sort((left, right) => left.sequence - right.sequence).map(summary => summary.artifactPath),
    issues: [],
  };
}

function inspectResourceVerificationPlanBinding(root, executionRoot, runId, artifact) {
  const planPath = path.resolve(root, artifact.verificationPlan.path);
  const expectedPlanRoot = path.join(executionRoot, "verification-plans");
  if (!withinRoot(expectedPlanRoot, planPath)) {
    return ["resource preflight verification plan must remain inside this execution"];
  }
  const issues = [];
  const plan = readJsonForInspection(root, planPath, "resource preflight verification plan", issues);
  if (!plan) return issues;
  if (sha256(readFileSync(planPath)) !== artifact.verificationPlan.sha256) {
    issues.push("resource preflight verification plan hash does not match the bound SHA-256");
  }
  if (plan.schemaVersion !== "OwlCodaRunKitVerificationPlanV1"
    || plan.runId !== runId
    || plan.planId !== artifact.verificationPlan.planId
    || plan.authorizationGranted !== false
    || !plan.evidence
    || !Array.isArray(plan.evidence.reusableReceiptIds)) {
    issues.push("resource preflight verification plan identity or authority boundary is invalid");
    return issues;
  }
  const planReceipts = [...plan.evidence.reusableReceiptIds].sort(compareCodeUnits);
  if (planReceipts.some(receiptId => typeof receiptId !== "string")
    || new Set(planReceipts).size !== planReceipts.length
    || JSON.stringify(planReceipts) !== JSON.stringify(artifact.receiptReuse.reusableReceiptIds)) {
    issues.push("resource preflight reusable receipts do not match the bound verification plan");
  }
  return issues;
}

function activeRecovery(root, executionRoot, runId, enginePin) {
  const lease = inspectActiveLeases(root, executionRoot);
  const verification = inspectActiveVerification(root, executionRoot, runId);
  const delivery = inspectActiveDelivery(root, executionRoot, runId, verification.sourceFingerprint);
  const resourcePreflight = inspectResourcePreflights(root, executionRoot, runId);
  const issues = [
    ...lease.issues,
    ...delivery.issues,
    ...verification.issues,
    ...(resourcePreflight.status === "invalid" ? resourcePreflight.issues : []),
  ];
  if (enginePin.status !== "valid") issues.push(...enginePin.issues);
  if (verification.status === "passed" && lease.status === "none") {
    issues.push("passed verification requires a recorded writer lease before closeout");
  }
  let evidenceTrustLevel = "planned";
  let nextAllowedAction = "acquire_writer_lease";
  if (issues.length > 0 || new Set(["invalid", "stale"]).has(delivery.status) || verification.status === "invalid") {
    evidenceTrustLevel = "invalid";
    nextAllowedAction = delivery.status === "stale" ? "replace_delivery_packet" : "repair_execution_artifacts";
  } else if (verification.status === "passed") {
    evidenceTrustLevel = "verification_passed";
    nextAllowedAction = lease.status === "active" ? "release_writer_lease" : "close_execution";
  } else if (delivery.status === "fresh") {
    evidenceTrustLevel = "delivery_fresh";
    nextAllowedAction = "run_stage_verification";
  } else if (resourcePreflight.status === "expired") {
    evidenceTrustLevel = "work_in_progress";
    nextAllowedAction = "run_resource_preflight";
  } else if (resourcePreflight.status === "current" && resourcePreflight.selected) {
    evidenceTrustLevel = "work_in_progress";
    nextAllowedAction = resourcePreflight.selected.nextAllowedAction;
  } else if (lease.status === "active") {
    evidenceTrustLevel = "work_in_progress";
    nextAllowedAction = "continue_feature_work";
  } else if (lease.status === "released") {
    evidenceTrustLevel = "work_in_progress";
    nextAllowedAction = "prepare_delivery_packet";
  }
  return { lease, delivery, verification, resourcePreflight, evidenceTrustLevel, nextAllowedAction, issues };
}

function closedRecovery(receipt, closeout) {
  if (closeout.status !== "valid") {
    return {
      lease: { status: "invalid", workItemIds: [], activeWorkItemIds: [], releasedWorkItemIds: [], issues: closeout.issues },
      delivery: { status: "invalid", issues: closeout.issues },
      verification: { status: "invalid", issues: closeout.issues },
      evidenceTrustLevel: "invalid",
      nextAllowedAction: "repair_execution_artifacts",
      issues: closeout.issues,
    };
  }
  const payload = receipt.artifact.payload;
  const verification = payload.verification;
  return {
    lease: verification
      ? { status: "released", workItemIds: [...verification.releasedLeaseIds], activeWorkItemIds: [], releasedWorkItemIds: [...verification.releasedLeaseIds], issues: [] }
      : { status: "not_required", workItemIds: [], activeWorkItemIds: [], releasedWorkItemIds: [], issues: [] },
    delivery: verification
      ? { status: "historical", sourceFingerprint: verification.sourceFingerprint, issues: [] }
      : { status: "not_applicable", issues: [] },
    verification: verification
      ? {
          status: "passed",
          decision: verification.gateDecision,
          activeReceiptSha256: verification.activeReceiptSha256,
          sourceFingerprint: verification.sourceFingerprint,
          issues: [],
        }
      : { status: "not_applicable", issues: [] },
    evidenceTrustLevel: payload.decision === "accepted" ? "closed_accepted" : "closed_nonaccepted",
    nextAllowedAction: "plan_new_execution",
    issues: [],
  };
}

function closeoutGateRejected(runId, decision, issues) {
  return {
    status: "closeout_gate_rejected",
    exitCode: 2,
    runId,
    decision,
    authorizationGranted: false,
    issues,
  };
}

async function initialize(options) {
  const root = workspace(options);
  const initialized = await initializeProjectRunKit({ workspaceRoot: root });
  const result = {
    ...initialized,
    onboarding: onboardingProjection(root),
    nextAllowedAction: "run_onboarding_diagnostics",
  };
  if (options.json === true) return result;
  return withHumanOutput(
    result,
    [
      `Initialized OwlRunKit ${result.core.coreVersion} in ${result.runtimeRoot}`,
      "",
      "Next:",
      "1. npx --no-install owlrunkit doctor --workspace .",
      "2. npx --no-install owlrunkit profiles detect --workspace . --dry-run",
      `3. npx --no-install owlrunkit adopt --workspace . --exact owlrunkit@${CORE_VERSION} or npx --no-install owlrunkit start`,
      "",
    ].join("\n"),
  );
}

function plan(options) {
  const root = workspace(options);
  const runId = safeRunId(requireOption(options, "run-id"));
  const goalPath = realpathSync(requireOption(options, "goal"));
  const config = readJson(runtimePath(root, "config.json"));
  const pinGate = validateExecutionPin({ expected: config.core, actual: currentCoreIdentity() });
  if (pinGate.status !== "valid") return pinGate;
  const executionRoot = runtimePath(root, "executions", runId);
  if (existsSync(executionRoot)) throw new Error(`run id already exists: ${runId}`);
  mkdirSync(path.join(executionRoot, "leases"), { recursive: true });
  mkdirSync(path.join(executionRoot, "delivery-packets"));
  mkdirSync(path.join(executionRoot, "verification-receipts"));
  const enginePin = currentCoreIdentity();
  const goal = readJson(goalPath);
  const goalContractPath = path.join(executionRoot, "goal-contract.json");
  writeJson(path.join(executionRoot, "engine-pin.json"), enginePin);
  writeJson(goalContractPath, goal);
  writeJson(path.join(executionRoot, "execution-plan.json"), {
    schemaVersion: "OwlCodaRunKitExecutionPlanV1",
    runId,
    state: "planned",
    enginePin,
    goalContractSha256: sha256(readFileSync(goalContractPath)),
    authorizationGranted: false,
  });
  appendEvent(executionRoot, { sequence: 1, type: "execution_planned", runId, authorizationGranted: false });
  return { status: "planned", exitCode: 0, runId, authorizationGranted: false, enginePin };
}

function startExecution(options) {
  const root = workspace(options);
  const runId = safeRunId(requireOption(options, "run-id"));
  const workItemId = requireOption(options, "work-item");
  const ownedPaths = options["owned-path"] ?? [];
  const executionRoot = runtimePath(root, "executions", runId);
  return withControlTransaction(root, () => {
    if (existsSync(executionRoot)) throw new Error(`run id already exists: ${runId}`);
    try {
      const planned = plan(options);
      if (planned.status !== "planned") return planned;
      const lease = acquireLeaseWithinControlTransaction({
        workspaceRoot: root,
        runId,
        workItemId,
        ownedPaths,
      });
      if (lease.status !== "lease_acquired") {
        rmSync(executionRoot, { recursive: true, force: true });
        return lease;
      }
      return {
        status: "started",
        exitCode: 0,
        runId,
        leasePath: lease.leasePath,
        enginePin: planned.enginePin,
        authorizationGranted: false,
      };
    } catch (error) {
      if (existsSync(executionRoot)) rmSync(executionRoot, { recursive: true, force: true });
      throw error;
    }
  });
}

function inspect(options) {
  const root = workspace(options);
  const requestedRunId = options["run-id"] === undefined
    ? null
    : safeRunId(requireOption(options, "run-id"));
  if (options.history && requestedRunId) throw new Error("inspect --history cannot be combined with --run-id.");
  if (options.verbose && !requestedRunId) throw new Error("inspect --verbose requires --run-id.");
  if (options.history && options.verbose) throw new Error("inspect --history cannot be combined with --verbose.");
  if (options.compact && options.json !== true) throw new Error("inspect --compact requires --json.");
  if (options.compact && (options.history || options.verbose || requestedRunId)) {
    throw new Error("inspect --compact cannot be combined with --history, --verbose, or --run-id.");
  }
  const controlIssues = [];
  const configPath = runtimePath(root, "config.json");
  const candidateConfig = readJsonForInspection(root, configPath, "Project config", controlIssues);
  const configGate = candidateConfig
    ? validateProjectConfigV2(candidateConfig)
    : { valid: false, issues: [] };
  if (!configGate.valid) controlIssues.push(...configGate.issues);
  const config = controlIssues.length === 0 ? candidateConfig : null;
  const current = currentCoreIdentity();
  const sharedControl = inspectProjectControlState({
    workspaceRoot: root,
    currentCore: current,
  });
  const configCore = config
    ? validateExecutionPin({ expected: config.core, actual: current })
    : { status: "invalid_config", exitCode: 2, issues: [...controlIssues] };
  const executionsRoot = runtimePath(root, "executions");
  const executionEntries = pathEntryExists(executionsRoot) && inspectDirectory(root, executionsRoot, "Executions directory", controlIssues)
    ? readdirSync(executionsRoot, { withFileTypes: true }).sort((left, right) => compareCodeUnits(left.name, right.name))
    : [];
  const runIds = executionEntries.map((entry) => entry.name);
  const inspectedExecutions = executionEntries.map((entry) => {
    const runId = entry.name;
    const executionRoot = runtimePath(root, "executions", runId);
    const entryIssues = [];
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      entryIssues.push(`Execution must be a real directory, not a symlink: ${relativePath(root, executionRoot)}`);
      return invalidOpenExecution(runId, entryIssues);
    }
    if (!inspectDirectory(root, executionRoot, "Execution directory", entryIssues)) {
      return invalidOpenExecution(runId, entryIssues);
    }
    const inspectionIssues = [];
    const pin = readJsonForInspection(root, path.join(executionRoot, "engine-pin.json"), "engine pin", inspectionIssues);
    if (!pin) {
      const enginePin = { status: "invalid_artifact", exitCode: 2, issues: inspectionIssues };
      return {
        runId,
        lifecycle: "unknown",
        historical: false,
        enginePin,
        recovery: activeRecovery(root, executionRoot, runId, enginePin),
      };
    }
    const currentPinGate = validateExecutionPin({ expected: pin, actual: current });
    const closeoutPath = path.join(executionRoot, "closeout-receipt.json");
    if (!pathEntryExists(closeoutPath)) {
      return {
        runId,
        lifecycle: "active",
        historical: currentPinGate.status !== "valid",
        enginePin: currentPinGate,
        recovery: activeRecovery(root, executionRoot, runId, currentPinGate),
      };
    }

    const receipt = readJsonForInspection(root, closeoutPath, "closeout receipt", inspectionIssues);
    if (!receipt) {
      const closeout = { status: "invalid", issues: inspectionIssues };
      return {
        runId,
        lifecycle: "closed",
        historical: currentPinGate.status !== "valid",
        enginePin: { status: "invalid_closeout", exitCode: 2, issues: inspectionIssues },
        closeout,
        recovery: closedRecovery({ artifact: { payload: {} } }, closeout),
      };
    }
    const artifactGate = validateCoreArtifact(receipt.artifact);
    const issues = [...artifactGate.issues];
    if (artifactGate.valid && receipt.acceptanceSha256 !== artifactGate.acceptanceSha256) {
      issues.push("closeout acceptanceSha256 does not match the artifact");
    }
    if (artifactGate.valid && receipt.artifactSha256 !== artifactGate.artifactSha256) {
      issues.push("closeout artifactSha256 does not match the artifact");
    }
    if (artifactGate.valid && receipt.artifact.payload.runId !== runId) {
      issues.push("closeout runId does not match the execution directory");
    }
    if (artifactGate.valid && !new Set(["accepted", "rejected", "blocked"]).has(receipt.artifact.payload.decision)) {
      issues.push("closeout decision is invalid");
    }
    if (artifactGate.valid && receipt.artifact.payload.authorizationGranted !== false) {
      issues.push("closeout authorizationGranted must be false");
    }
    if (artifactGate.valid) issues.push(...acceptedCloseoutVerificationIssues(receipt.artifact));
    const enginePin = artifactGate.valid
      ? validateExecutionPin({ expected: pin, actual: receipt.artifact.core })
      : { status: "invalid_closeout", exitCode: 2, issues: [...artifactGate.issues] };
    if (enginePin.status !== "valid") issues.push(...enginePin.issues);
    const closeout = issues.length === 0
      ? {
          status: "valid",
          decision: receipt.artifact.payload.decision,
          authorizationGranted: false,
        }
      : { status: "invalid", issues };
    return {
      runId,
      lifecycle: "closed",
      historical: currentPinGate.status !== "valid",
      enginePin,
      closeout,
      recovery: {
        ...closedRecovery(receipt, closeout),
        resourcePreflight: inspectResourcePreflights(root, executionRoot, runId),
      },
    };
  });
  const sharedByRunId = new Map(
    sharedControl.executions.map((execution) => [execution.runId, execution]),
  );
  const lifecycleParityIssues = [];
  const executions = inspectedExecutions.map((execution) => {
    const shared = sharedByRunId.get(execution.runId);
    if (!shared) {
      lifecycleParityIssues.push(
        `Shared lifecycle state is missing execution: ${execution.runId}`,
      );
      return execution;
    }
    return {
      ...execution,
      lifecycle: shared.lifecycle,
      historical: shared.historical,
      closeout: {
        ...execution.closeout,
        ...(shared.closeout.statusCode === undefined
          ? {}
          : {
            statusCode: shared.closeout.statusCode,
            businessGoalIncomplete:
              shared.closeout.businessGoalIncomplete,
            replacementPlanRequired:
              shared.closeout.replacementPlanRequired,
            nextAllowedAction: shared.closeout.nextAllowedAction,
          }),
      },
      recovery: {
        ...execution.recovery,
        lease: structuredClone(shared.lease),
      },
      controlState: {
        lifecycle: shared.lifecycle,
        historical: shared.historical,
        closeout: structuredClone(shared.closeout),
        lease: structuredClone(shared.lease),
      },
    };
  });
  const invalidClosedIssues = executions
    .filter((execution) => execution.lifecycle === "closed" && execution.closeout?.status === "invalid")
    .flatMap((execution) => execution.closeout.issues ?? []);
  const recoveryControlIssues = [
    ...controlIssues,
    ...invalidClosedIssues,
    ...sharedControl.issues,
    ...lifecycleParityIssues,
  ];
  const activeRunIds = [...sharedControl.activeRunIds];
  const selectedRun = activeRunIds.length === 1
    ? executions.find((execution) => execution.runId === activeRunIds[0])
    : null;
  let recovery = activeRunIds.length === 0 && recoveryControlIssues.length > 0
    ? {
        state: "invalid_control_truth",
        activeRunIds,
        selectedRunId: null,
        nextAllowedAction: "repair_execution_artifacts",
        authorizationGranted: false,
      }
    : activeRunIds.length === 0
    ? {
        state: "no_active_execution",
        activeRunIds,
        selectedRunId: null,
        nextAllowedAction: "plan_new_execution",
        authorizationGranted: false,
      }
    : activeRunIds.length === 1
      ? {
          state: "single_active_execution",
          activeRunIds,
          selectedRunId: activeRunIds[0],
          nextAllowedAction: selectedRun.recovery.nextAllowedAction,
          authorizationGranted: false,
        }
      : {
          state: "multiple_active_executions",
          activeRunIds,
          selectedRunId: null,
          nextAllowedAction: "select_active_execution",
          authorizationGranted: false,
        };
  if (sharedControl.status === "invalid") {
    recovery = structuredClone(sharedControl.recovery);
  } else if (recoveryControlIssues.length > 0 && activeRunIds.length > 0) {
    recovery = { ...recovery, nextAllowedAction: "repair_execution_artifacts" };
  }
  const result = {
    status: "inspected",
    exitCode: configCore.status !== "valid" || recoveryControlIssues.length > 0 || executions.some(
      (execution) => execution.enginePin.status !== "valid"
        || execution.closeout?.status === "invalid"
        || execution.recovery?.evidenceTrustLevel === "invalid",
    ) || activeRunIds.length > 1 ? 2 : 0,
    runtimeRoot: RUNTIME_ROOT,
    config,
    configCore,
    controlState: sharedControl,
    controlIssues: recoveryControlIssues,
    runIds,
    executions,
    recovery,
  };
  if (requestedRunId && !executions.some(execution => execution.runId === requestedRunId)) {
    throw new Error(`Execution was not found: ${requestedRunId}`);
  }
  const onboarding = onboardingProjection(root, recovery);
  const projectDefinitionPath = runtimePath(root, "project", "definition.json");
  const projectDriver = pathEntryExists(projectDefinitionPath)
    ? readTeamProjectStatusV5({ workspaceRoot: root })
    : null;
  const localMaintenance = options.compact === true
    ? inspectLocalMaintenanceV1({
        workspaceRoot: root,
        packageRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
        sharedSkillRoot: process.env.OWLCODA_RUNKIT_PROCESS_SKILL_ROOT,
      })
    : null;
  const summary = buildInspectSummary(result, {
    maintenanceNextAction: onboarding.maintenanceNextAction ?? null,
    projectDriver,
  });
  const view = options.history
    ? { mode: "history" }
    : requestedRunId
      ? {
          mode: "execution",
          runId: requestedRunId,
          verbose: options.verbose === true,
          execution: executions.find(execution => execution.runId === requestedRunId),
        }
      : { mode: "summary" };
  const inspected = {
    ...result,
    summary,
    view,
    onboarding,
    ...(localMaintenance === null ? {} : { localMaintenance }),
    ...(projectDriver === null ? {} : { projectDriver }),
  };
  return options.compact === true ? buildInspectCompactV2(inspected) : inspected;
}

function closeout(options) {
  const root = workspace(options);
  const runId = safeRunId(requireOption(options, "run-id"));
  const decision = requireOption(options, "decision");
  if (!new Set(["accepted", "rejected", "blocked"]).has(decision)) throw new Error("decision must be accepted, rejected, or blocked.");
  if (decision === "accepted" && !options["gate-input"]) {
    return closeoutGateRejected(runId, decision, [
      "A verification gate input is required for accepted closeout.",
    ]);
  }
  const executionRoot = runtimePath(root, "executions", runId);
  const pin = readJson(path.join(executionRoot, "engine-pin.json"));
  const pinGate = validateExecutionPin({ expected: pin, actual: currentCoreIdentity() });
  if (pinGate.status !== "valid") return pinGate;
  let acceptedVerification = null;
  if (decision === "accepted") {
    const gateInputPath = realpathSync(options["gate-input"]);
    const gateInputBytes = readFileSync(gateInputPath);
    const gateInput = JSON.parse(gateInputBytes.toString("utf8"));
    const gate = validateVerificationReceiptGate(gateInput);
    if (!gate.accepted) {
      return closeoutGateRejected(
        runId,
        decision,
        gate.issues.length > 0
          ? gate.issues.map((item) => item.message)
          : ["The verification gate input was not accepted."],
      );
    }
    if (gate.contractVersion !== "0.2") {
      return closeoutGateRejected(runId, decision, [
        "Accepted closeout requires a Contract v0.2 gate input.",
      ]);
    }
    if (gate.lineage.active.receipt.runId !== runId) {
      return closeoutGateRejected(runId, decision, [
        "The active receipt runId must match the current execution.",
      ]);
    }
    const leases = listLeaseArtifacts({ workspaceRoot: root, executionRoot });
    if (leases.length === 0) {
      return closeoutGateRejected(runId, decision, [
        "At least one released lease is required for accepted closeout.",
      ]);
    }
    if (leases.some((lease) => lease.state !== "released")) {
      return closeoutGateRejected(runId, decision, [
        "Accepted closeout is not allowed while an active lease remains.",
      ]);
    }
    const releasedLeaseIds = leases.map((lease) => lease.workItemId);
    if (releasedLeaseIds.some((workItemId) => typeof workItemId !== "string" || workItemId.length === 0)
      || new Set(releasedLeaseIds).size !== releasedLeaseIds.length) {
      return closeoutGateRejected(runId, decision, [
        "Released leases must have unique non-empty workItemId values.",
      ]);
    }
    releasedLeaseIds.sort();
    acceptedVerification = {
      contractVersion: "0.2",
      gateDecision: gate.decision,
      gateInputSha256: sha256(gateInputBytes),
      activeReceiptSha256: gate.activeReceiptSha256,
      sourceFingerprint: gate.sourceFingerprint,
      verificationContextFingerprint: gate.verificationContextFingerprint,
      selectedProfileIds: [...gate.selectedProfileIds],
      ...(gate.lineage.active.receipt.sourceArtifact === undefined
        ? {}
        : {
          sourceArtifact: structuredClone(
            gate.lineage.active.receipt.sourceArtifact,
          ),
        }),
      leaseState: "released",
      releasedLeaseIds,
    };
  }
  const formalEvidenceSummary = options["formal-evidence-summary"] ?? null;
  if (
    formalEvidenceSummary !== null
    && (
      decision !== "accepted"
      || formalEvidenceSummary.status !== "formal_evidence_summarized"
      || typeof formalEvidenceSummary.evidenceSummaryPath !== "string"
      || !/^[a-f0-9]{64}$/u.test(
        formalEvidenceSummary.evidenceSummarySha256 ?? "",
      )
    )
  ) {
    throw new Error("Formal evidence summary binding is invalid for closeout.");
  }
  const created = createCoreArtifact({
    core: pin,
    producer: { adapterKind: "codex", adapterVersion: "0.1.0" },
    payload: {
      runId,
      decision,
      authorizationGranted: false,
      ...(acceptedVerification ? { verification: acceptedVerification } : {}),
    },
    extensions: {
      "dev.owlcoda.adapter.codex": {},
      ...(formalEvidenceSummary === null
        ? {}
        : {
          "dev.owlcoda.formal-evidence": {
            schemaVersion: "OwlCodaRunKitFormalEvidenceCloseoutBindingV1",
            summaryPath: formalEvidenceSummary.evidenceSummaryPath,
            summarySha256: formalEvidenceSummary.evidenceSummarySha256,
            formalCheckCount: formalEvidenceSummary.formalCheckCount,
            supplementalEvidenceCount:
              formalEvidenceSummary.supplementalEvidenceCount,
            staleSupplementalEvidenceCount:
              formalEvidenceSummary.staleSupplementalEvidenceCount,
            authorizationGranted: false,
          },
        }),
    },
  });
  const closeoutPath = path.join(executionRoot, "closeout-receipt.json");
  writeJsonExclusiveAtomically(closeoutPath, created);
  const eventsPath = path.join(executionRoot, "events.jsonl");
  const sequence = readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).length + 1;
  try {
    appendEvent(executionRoot, { sequence, type: "execution_closed", runId, decision, artifactSha256: created.artifactSha256 });
  } catch (error) {
    rmSync(closeoutPath, { force: true });
    throw error;
  }
  return { status: "closed", exitCode: 0, runId, decision, authorizationGranted: false, ...created };
}

function finishExecutionWithinControlTransaction(options, {
  formalEvidenceSummary = null,
} = {}) {
  const root = workspace(options);
  const runId = safeRunId(requireOption(options, "run-id"));
  const decision = requireOption(options, "decision");
  if (!new Set(["accepted", "rejected", "blocked"]).has(decision)) {
    throw new Error("decision must be accepted, rejected, or blocked.");
  }
  const executionRoot = runtimePath(root, "executions", runId);
    const closeoutPath = path.join(executionRoot, "closeout-receipt.json");
    if (pathEntryExists(closeoutPath)) {
      if (lstatSync(closeoutPath).isSymbolicLink()) {
        throw new Error("Closeout receipt must not be a symlink.");
      }
      throw new Error(`Execution is already closed: ${runId}`);
    }
    const gate = decision === "accepted" ? activeAcceptedGate({ workspaceRoot: root, runId }) : null;
    if (gate && gate.status !== "valid") return gate;
    const activeLeaseIds = listLeaseArtifacts({ workspaceRoot: root, executionRoot })
      .filter(lease => lease.state === "active")
      .map(lease => lease.workItemId)
      .sort();
    const releasedLeaseIds = [];
    const rollbackReleasedLeases = () => {
      for (const workItemId of [...releasedLeaseIds].reverse()) {
        const restored = restoreLeaseWithinControlTransaction({
          workspaceRoot: root,
          runId,
          workItemId,
        });
        if (restored.status !== "lease_restored") {
          throw new Error(`Could not restore lease after failed finish: ${workItemId}`);
        }
      }
    };
    let closed;
    try {
      for (const workItemId of activeLeaseIds) {
        const released = releaseLeaseWithinControlTransaction({
          workspaceRoot: root,
          runId,
          workItemId,
        });
        if (released.status !== "lease_released") {
          rollbackReleasedLeases();
          return released;
        }
        releasedLeaseIds.push(workItemId);
      }
      closed = closeout({
        ...options,
        ...(gate ? { "gate-input": gate.gateInputPath } : {}),
        ...(formalEvidenceSummary === null
          ? {}
          : { "formal-evidence-summary": formalEvidenceSummary }),
      });
      if (closed.status !== "closed") {
        rollbackReleasedLeases();
        return closed;
      }
    } catch (error) {
      if (!pathEntryExists(closeoutPath)) rollbackReleasedLeases();
      throw error;
    }
    return {
      status: "finished",
      exitCode: 0,
      runId,
      decision,
      releasedLeaseIds,
      activeReceiptSha256: gate?.activeReceiptSha256 ?? null,
      closeoutArtifactSha256: closed.artifactSha256,
      authorizationGranted: false,
    };
}

function finishExecution(options) {
  const root = workspace(options);
  return withControlTransaction(
    root,
    () => finishExecutionWithinControlTransaction(options),
  );
}

function requestCommand(options, handler) {
  const root = workspace(options);
  const runId = safeRunId(requireOption(options, "run-id"));
  const requestPath = realpathSync(requireOption(options, "request"));
  return handler({ workspaceRoot: root, runId, request: readJson(requestPath) });
}

export async function runCli(argv = process.argv.slice(2), runtimeHooks = {}) {
  try {
    const [command, ...rest] = argv;
    if (command === "--help" || command === "-h") {
      return withHumanOutput({
        status: "help",
        exitCode: 0,
        authorizationGranted: false,
      }, TOP_LEVEL_HELP);
    }
    if (command === "--version" || command === "-v") {
      return withHumanOutput({
        status: "version",
        exitCode: 0,
        version: CORE_VERSION,
        authorizationGranted: false,
      }, `owlrunkit ${CORE_VERSION}\n`);
    }
    const separatorIndex = rest.indexOf("--");
    const acceptsExactCommand = command === "verify"
      || command === "quick-verify"
      || command === "quick-reuse"
      || (command === "formal" && rest[0] === "check");
    if (separatorIndex >= 0 && !acceptsExactCommand) {
      throw new Error("Only verify, quick-verify, quick-reuse, and formal check accept an exact command after --.");
    }
    const optionValues = separatorIndex >= 0 ? rest.slice(0, separatorIndex) : rest;
    const commandArgv = separatorIndex >= 0 ? rest.slice(separatorIndex + 1) : [];
    const nested = new Set([
      "assurance",
      "candidate",
      "core-successor",
      "delivery",
      "deployment",
      "efficiency",
      "fleet",
      "formal",
      "hook",
      "lease",
      "mode",
      "profiles",
      "project",
      "team",
    ]).has(command);
    let [action, ...nestedOptions] = nested ? optionValues : [null, ...optionValues];
    if (command === "project" && action === "work-item"
      && nestedOptions[0] === "revise-scope") {
      action = "work-item revise-scope";
      nestedOptions = nestedOptions.slice(1);
    }
    if (command === "project" && action === "work-item"
      && nestedOptions[0] === "require-evidence") {
      action = "work-item require-evidence";
      nestedOptions = nestedOptions.slice(1);
    }
    if (command === "project" && action === "delivery"
      && nestedOptions[0] === "record") {
      action = "delivery record";
      nestedOptions = nestedOptions.slice(1);
    }
    if (command === "project" && action === "successor"
      && nestedOptions[0] === "scaffold") {
      action = "successor scaffold";
      nestedOptions = nestedOptions.slice(1);
    }
    if (command === "team" && action === "packet"
      && nestedOptions[0] === "validate") {
      action = "packet validate";
      nestedOptions = nestedOptions.slice(1);
    }
    const helpRequested = optionValues.includes("--help")
      || optionValues.includes("-h");
    if (helpRequested) {
      const normalizedAction = action === "--help" || action === "-h"
        ? null
        : action;
      const help = COMMAND_HELP[
        normalizedAction ? `${command} ${normalizedAction}` : command
      ];
      if (help) {
        return withHumanOutput({
          status: "help",
          exitCode: 0,
          authorizationGranted: false,
        }, help);
      }
    }
    const options = parseOptions(nested ? nestedOptions : optionValues, {
      multi: command === "mode"
        ? ["risk-category"]
        : command === "quick-verify"
          ? ["bind-ignored"]
        : command === "quick-reuse"
          ? ["allow-path"]
        : command === "profiles" && action === "impact"
        ? ["changed"]
        : (command === "fleet" && new Set(["discover", "skill-plan"]).has(action))
          || (command === "core-successor" && action === "plan")
          ? ["fleet-root", "workspace-root"]
        : (command === "lease" && action === "acquire")
          || command === "start"
          || (command === "formal" && action === "start")
          ? ["owned-path"]
        : command === "project" && action === "target-snapshot"
          ? ["allowed-path"]
        : command === "project" && action === "handoff"
          ? ["evidence"]
        : command === "project" && action === "reject-and-return"
          ? ["evidence"]
        : command === "project" && action === "reopen-upstream"
          ? ["evidence"]
        : command === "project" && action === "transfer"
          ? ["evidence", "blocker", "decision"]
        : command === "project" && action === "integrate"
          ? ["evidence"]
        : command === "project" && action === "verification"
          ? ["check", "evidence", "decision"]
        : command === "project" && action === "checkpoint"
          ? ["evidence", "blocker", "decision"]
        : command === "project" && action === "decision"
          ? ["blocking-work-item", "option", "evidence"]
        : command === "project" && action === "work-item revise-scope"
          ? ["owned-path", "evidence"]
        : command === "project" && action === "work-item require-evidence"
          ? ["evidence"]
        : command === "project" && action === "reconcile"
          ? ["evidence"]
        : command === "project" && action === "delivery record"
          ? ["evidence", "external-gate"]
        : command === "efficiency" && action === "record"
          ? ["evidence"]
          : [],
      boolean: command === "mode" && action === "recommend"
        ? [
            "json",
            "needs-evidence",
            "may-mutate-project",
            "external-side-effects",
            "cross-session",
            "long-running",
            "interruption-recovery",
            "dirty-parallel-workspace",
            "irreversible",
            "rollback-uncertain",
            "permission-sensitive",
            "security-sensitive",
            "funds-at-risk",
            "schema-or-data-migration",
            "formal-acceptance",
          ]
        : command === "mode" && action === "status"
          ? ["json"]
        : command === "team"
          ? ["json"]
        : command === "hook"
          ? ["json"]
        : command === "inspect"
        ? ["json", "compact", "verbose", "history"]
        : command === "init"
          ? ["json"]
        : command === "bootstrap"
          ? ["json", "dry-run", "apply"]
        : command === "formal" && new Set(["preflight", "attach-evidence"]).has(action)
          ? ["json"]
        : command === "project" && action === "decision"
          ? ["json", "open", "resolve"]
        : command === "project" && action === "verification"
          ? ["json", "defer", "close"]
        : command === "project" && action === "work-item revise-scope"
          ? ["json", "unmeasured"]
        : command === "project" && action === "work-item require-evidence"
          ? ["json"]
        : command === "project" && new Set(["init", "assign", "handoff", "reject-and-return", "reopen-upstream", "transfer", "checkpoint", "integrate", "capture", "reconcile", "delivery record", "status", "takeover", "successor"]).has(action)
          ? ["json"]
        : command === "project" && action === "successor scaffold"
          ? ["json", "dry-run"]
        : command === "project" && new Set(["target-snapshot", "import-delivery"]).has(action)
          ? ["json", "dry-run", "apply"]
          : command === "doctor" || command === "adopt" || command === "status"
            ? ["json"]
        : command === "profiles"
            ? ["json", "dry-run", "apply"]
        : command === "fleet" && action === "skill-plan"
          ? ["json"]
        : command === "fleet" && action === "replace-registry"
          ? ["dry-run"]
        : command === "candidate"
          ? ["delivery-v1"]
        : command === "core-successor" && action === "resume"
          ? ["adopt-orphan-success-receipts"]
        : command === "deployment" && action === "execute"
          ? ["resume"]
        : command === "quick-verify"
          ? ["json", "attest", "isolate", "capture-runtime"]
        : command === "quick-reuse"
          ? ["json", "dry-run", "apply"]
        : command === "quick-runtime-verify"
          ? ["json"]
        : command === "quick-attest"
          ? ["json"]
        : command === "quick-metrics"
          ? ["json", "local", "verbose"]
        : command === "efficiency" && action === "record"
          ? ["json"]
        : command === "efficiency" && action === "status"
          ? ["json", "verbose"]
          : [],
    });
    if (command === "init") return await initialize(options);
    if (command === "bootstrap") {
      if (options.apply === true && options["dry-run"] === true) {
        throw new Error("bootstrap accepts either --apply or --dry-run, not both.");
      }
      if (options.apply !== true && options["dry-run"] !== true) {
        throw new Error("bootstrap requires --dry-run or --apply.");
      }
      const input = {
        workspaceRoot: requireOption(options, "workspace"),
        exactSpec: requireOption(options, "exact"),
        ...(options["skill-root"] === undefined
          ? {}
          : { skillRoot: options["skill-root"] }),
      };
      const result = options.apply === true
        ? await applyOnboardingBootstrapV1(input)
        : await planOnboardingBootstrapV1(input);
      return options.json === true
        ? result
        : withHumanOutput(result, formatOnboardingBootstrapHumanV1(result));
    }
    if (command === "doctor") {
      assertOnlyOptions(options, [
        "workspace", "registry", "timeout-ms", "skill-root", "json",
      ]);
      const timeoutMs = options["timeout-ms"] === undefined
        ? 1_500
        : Number.parseInt(options["timeout-ms"], 10);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 10_000) {
        throw new Error("--timeout-ms must be an integer from 25 to 10000.");
      }
      const report = await runDoctorV3({
        workspaceRoot: requireOption(options, "workspace"),
        sharedSkillRoot: options["skill-root"],
        discoverSharedSkill: true,
        registryUrl: options.registry ?? OFFICIAL_NPM_REGISTRY,
        timeoutMs,
        ...(options["skill-root"] === undefined
          ? {}
          : { skillRoot: options["skill-root"] }),
      });
      report.exitCode = report.status === "ready" ? 0 : 2;
      return options.json === true
        ? report
        : withHumanOutput(report, formatDoctorHuman(report));
    }
    if (command === "adopt") {
      const result = await runRegistryAdoption({
        workspaceRoot: requireOption(options, "workspace"),
        exactSpec: requireOption(options, "exact"),
      });
      result.exitCode = result.status === "adopted" ? 0 : 2;
      return options.json === true
        ? result
        : withHumanOutput(result, formatAdoptionHuman(result));
    }
    if (command === "assurance") {
      if (action !== "route") {
        throw new Error("Usage: npx --no-install owlrunkit assurance route --request <risk-facts.json>");
      }
      const requestPath = realpathSync(requireOption(options, "request"));
      return routeRunKitAssuranceV2(readJson(requestPath));
    }
    if (command === "mode") {
      const root = workspace(options);
      if (action === "recommend") {
        assertOnlyOptions(options, [
          "workspace",
          "requested-mode",
          "needs-evidence",
          "exact-command-count",
          "writer-count",
          "may-mutate-project",
          "external-side-effects",
          "cross-session",
          "long-running",
          "interruption-recovery",
          "dirty-parallel-workspace",
          "irreversible",
          "rollback-uncertain",
          "permission-sensitive",
          "security-sensitive",
          "funds-at-risk",
          "schema-or-data-migration",
          "formal-acceptance",
          "risk-category",
          "json",
        ]);
        const recommendation = recommendUsageModeV2({
          workspaceRoot: root,
          projectDriverPresent: existsSync(path.join(
            root,
            ".owlcoda/runkit/project/definition.json",
          )),
          requestedMode: options["requested-mode"] ?? "auto",
          needsDurableEvidence: options["needs-evidence"] === true,
          exactCommandCount: parseCanonicalNonnegativeSafeInteger(
            options["exact-command-count"] ?? "0",
            "exact-command-count",
          ),
          writerCount: parseCanonicalNonnegativeSafeInteger(
            options["writer-count"] ?? "1",
            "writer-count",
          ),
          mayMutateProject: options["may-mutate-project"] === true,
          externalSideEffects: options["external-side-effects"] === true,
          crossSession: options["cross-session"] === true,
          longRunning: options["long-running"] === true,
          interruptionRecovery: options["interruption-recovery"] === true,
          dirtyParallelWorkspace: options["dirty-parallel-workspace"] === true,
          irreversibleChange: options.irreversible === true,
          rollbackUncertain: options["rollback-uncertain"] === true,
          permissionSensitive: options["permission-sensitive"] === true,
          securitySensitive: options["security-sensitive"] === true,
          fundsAtRisk: options["funds-at-risk"] === true,
          schemaOrDataMigration: options["schema-or-data-migration"] === true,
          needsFormalAcceptance: options["formal-acceptance"] === true,
          riskCategories: options["risk-category"] ?? [],
        });
        return options.json === true
          ? recommendation
          : withHumanOutput(recommendation, formatUsageModeHumanV2(recommendation));
      }
      if (action === "status") {
        assertOnlyOptions(options, ["workspace", "json"]);
        const recommendation = recommendUsageModeV2({
          workspaceRoot: root,
          projectDriverPresent: existsSync(path.join(
            root,
            ".owlcoda/runkit/project/definition.json",
          )),
          requestedMode: "auto",
          needsDurableEvidence: false,
          exactCommandCount: 0,
          writerCount: 1,
          mayMutateProject: false,
          externalSideEffects: false,
          crossSession: false,
          longRunning: false,
          interruptionRecovery: false,
          dirtyParallelWorkspace: false,
          irreversibleChange: false,
          rollbackUncertain: false,
          permissionSensitive: false,
          securitySensitive: false,
          fundsAtRisk: false,
          schemaOrDataMigration: false,
          needsFormalAcceptance: false,
          riskCategories: [],
        });
        const status = {
          ...recommendation,
          status: "mode_status",
          preferenceSource: "default_auto",
          persistedPreference: null,
        };
        return options.json === true
          ? status
          : withHumanOutput(status, formatUsageModeHumanV2(status));
      }
      throw new Error("Usage: npx --no-install owlrunkit mode <recommend|status> --workspace <directory>");
    }
    if (command === "team") {
      const root = workspace(options);
      if (action === "recommend") {
        assertOnlyOptions(options, ["workspace", "json"]);
        const recommendation = recommendTeamDeliveryV2({ workspaceRoot: root });
        return options.json === true
          ? recommendation
          : withHumanOutput(
              recommendation,
              formatTeamDeliveryRecommendationHumanV2(recommendation),
            );
      }
      if (action === "status") {
        assertOnlyOptions(options, ["workspace", "json"]);
        const status = readTeamDeliveryStatusV3({ workspaceRoot: root });
        return options.json === true
          ? status
          : withHumanOutput(status, formatTeamDeliveryStatusHumanV3(status));
      }
      if (action === "packet validate") {
        assertOnlyOptions(options, ["workspace", "packet", "json"]);
        const validation = validateTeamPacketFileV1({
          workspaceRoot: root,
          packetPath: requireOption(options, "packet"),
        });
        return options.json === true
          ? validation
          : withHumanOutput(validation, formatTeamPacketValidationHumanV1(validation));
      }
      throw new Error(
        "Usage: npx --no-install owlrunkit team <recommend|status|packet validate> --workspace <directory>",
      );
    }
    if (command === "fleet") {
      if (action === "skill-plan") {
        assertOnlyOptions(options, [
          "skill-root",
          "archive-root",
          "workspace-root",
          "fleet-root",
          "fleet-manifest",
          "registry",
          "json",
        ]);
        const plan = await planFleetSkillUpgradeV1({
          repositoryRoot: path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../..",
          ),
          targetRoot: requireOption(options, "skill-root"),
          archiveRoot: requireOption(options, "archive-root"),
          workspaceRoots: options["workspace-root"] ?? null,
          fleetRoots: options["fleet-root"] ?? null,
          fleetManifestPath: options["fleet-manifest"] ?? null,
          fleetRegistryPath: options.registry ?? null,
        });
        const result = { ...plan, exitCode: plan.status === "ready" ? 0 : 2 };
        return options.json === true
          ? result
          : withHumanOutput(result, formatFleetSkillUpgradePlanHumanV1(plan));
      }
      if (action === "register-root") {
        const registered = await registerFleetCoverageRoot({
          fleetRoot: requireOption(options, "fleet-root"),
          fleetRegistryPath: options.registry,
        });
        return {
          ...registered,
          exitCode: 0,
        };
      }
      if (action === "inspect-registry") {
        return {
          ...await inspectFleetRegistry({
            fleetRegistryPath: options.registry,
          }),
          exitCode: 0,
        };
      }
      if (action === "replace-registry") {
        return {
          ...await replaceFleetRegistry({
            replacementRequestPath: requireOption(options, "request"),
            receiptPath: options.receipt,
            dryRun: options["dry-run"] === true,
            fleetRegistryPath: options.registry,
          }),
          exitCode: 0,
        };
      }
      if (action === "rollback-registry") {
        return {
          ...await rollbackFleetRegistry({
            replacementReceiptPath: requireOption(options, "receipt"),
            rollbackReceiptPath: requireOption(options, "rollback-receipt"),
            fleetRegistryPath: options.registry,
          }),
          exitCode: 0,
        };
      }
      if (action !== "discover") {
        throw new Error("Usage: npx --no-install owlrunkit fleet <register-root|inspect-registry|replace-registry|rollback-registry|discover|skill-plan>");
      }
      const discovered = await discoverFleet({
        fleetRoots: options["fleet-root"] ?? null,
        fleetManifestPath: options["fleet-manifest"] ?? null,
        workspaceRoots: options["workspace-root"] ?? null,
        fleetRegistryPath: options.registry ?? null,
      });
      return {
        ...discovered,
        status: discovered.complete ? "discovered" : "incomplete",
        exitCode: discovered.complete ? 0 : 2,
      };
    }
    if (command === "core-successor") {
      const root = workspace(options);
      if (action === "plan") {
        const fleetDiscoveryRequest = options["fleet-manifest"]
          ? { fleetManifestPath: options["fleet-manifest"] }
          : options["fleet-root"]
            ? { fleetRoots: options["fleet-root"] }
            : options["workspace-root"]
              ? { workspaceRoots: options["workspace-root"] }
              : {};
        return await createCoreSuccessorPlanFromFleetV1({
          controllerWorkspaceRoot: root,
          planId: requireOption(options, "plan-id"),
          ...(options.output ? { planPath: options.output } : {}),
          sourceCandidateRequest: {
            runId: safeRunId(requireOption(options, "run-id")),
            workItemId: requireOption(options, "from-lease"),
            candidateId: requireOption(options, "candidate-id"),
          },
          fleetDiscoveryRequest,
        });
      }
      if (action === "apply") {
        return await applyCoreSuccessorPlanV1({
          controllerWorkspaceRoot: root,
          planPath: requireOption(options, "plan"),
          receiptId: requireOption(options, "receipt-id"),
          ...(options.output ? { receiptPath: options.output } : {}),
          ownerAuthority: readJson(
            realpathSync(requireOption(options, "owner-authority")),
          ),
        });
      }
      if (action === "resume") {
        const planPath = requireOption(options, "plan");
        const adoptOrphans = options["adopt-orphan-success-receipts"] === true;
        const receiptId = adoptOrphans
          ? requireOption(options, "receipt-id")
          : null;
        return await resumeCoreSuccessorPlanV1({
          controllerWorkspaceRoot: root,
          planPath,
          ...(options["from-receipt"]
            ? { fromReceiptPath: options["from-receipt"] }
            : {}),
          ...(adoptOrphans
            ? {
                receiptId,
                adoptOrphanSuccessReceipts: true,
                ...(options.output ? { receiptPath: options.output } : {}),
              }
            : {}),
          ownerAuthority: readJson(
            realpathSync(requireOption(options, "owner-authority")),
          ),
        });
      }
      throw new Error(
        "Usage: npx --no-install owlrunkit core-successor <plan|apply|resume> [options]",
      );
    }
    if (command === "deployment") {
      const root = workspace(options);
      if (action === "prepare") {
        let ownerDecision = null;
        if (!options.request) {
          const decisionRelativePath = safeRelativePath(
            requireOption(options, "owner-decision"),
            "deployment Owner decision",
          );
          const decisionPath = realpathSync(
            path.join(root, decisionRelativePath),
          );
          if (decisionPath !== path.resolve(root, decisionRelativePath)) {
            throw new Error(
              "Deployment Owner decision must be a regular workspace file without symlink traversal.",
            );
          }
          ownerDecision = readJson(decisionPath);
        }
        const receipt = options.request
          ? createDeploymentPrepareReceipt(
              readJson(realpathSync(requireOption(options, "request"))),
            )
          : createDeploymentPrepareReceiptFromClosedRun({
              workspaceRoot: root,
              prepareRunId: safeRunId(requireOption(options, "run-id")),
              artifactPath: requireOption(options, "artifact"),
              mediaType: requireOption(options, "media-type"),
              ownerDecision,
            });
        const receiptPath = writeWorkspaceArtifact(
          root,
          requireOption(options, "output"),
          "deployment prepare output",
          receipt,
        );
        return {
          status: "deployment_prepared",
          exitCode: 0,
          receiptPath,
          receiptSha256: receipt.receiptSha256,
          authorizationGranted: false,
        };
      }
      if (action === "execute") {
        const prepareReceipt = readWorkspaceArtifact(
          root,
          requireOption(options, "prepare"),
          "deployment prepare receipt",
        );
        const manifestPath = realpathSync(requireOption(options, "manifest"));
        const manifestBytes = readFileSync(manifestPath);
        const manifest = JSON.parse(manifestBytes.toString("utf8"));
        const automatic = options.request === undefined;
        const resuming = options.resume === true;
        if (resuming && !automatic) {
          throw new Error(
            "deployment execute --resume cannot be combined with --request.",
          );
        }
        let generated = null;
        let executeRequest;
        if (automatic) {
          const authorityRelativePath = safeRelativePath(
            requireOption(options, "owner-authority"),
            "deployment Owner authority",
          );
          const authorityPath = realpathSync(
            path.join(root, authorityRelativePath),
          );
          if (authorityPath !== path.resolve(root, authorityRelativePath)) {
            throw new Error(
              "Deployment Owner authority must be a regular workspace file without symlink traversal.",
            );
          }
          const ownerAuthority = {
            path: authorityRelativePath,
            sha256: sha256(readFileSync(authorityPath)),
          };
          const decisionRelativePath = safeRelativePath(
            requireOption(options, "owner-decision"),
            "deployment Owner decision",
          );
          const decisionPath = realpathSync(
            path.join(root, decisionRelativePath),
          );
          if (decisionPath !== path.resolve(root, decisionRelativePath)) {
            throw new Error(
              "Deployment Owner decision must be a regular workspace file without symlink traversal.",
            );
          }
          const ownerDecision = {
            path: decisionRelativePath,
            sha256: sha256(readFileSync(decisionPath)),
          };
          if (resuming) {
            const runId = safeRunId(manifest.deploymentId);
            const deploymentRoot = `${RUNTIME_ROOT}/deployments/${runId}`;
            const executeRequestPath = `${deploymentRoot}/execute-request.json`;
            const existingRequest = readWorkspaceArtifact(
              root,
              executeRequestPath,
              "deployment execute request",
            );
            if (
              existingRequest.executeRunId !== runId
              || JSON.stringify(existingRequest.ownerAuthority)
                !== JSON.stringify(ownerAuthority)
              || existingRequest.ownerDecision?.path
                !== ownerDecision.path
            ) {
              throw new Error(
                "Deployment resume Owner authority or child request drifted.",
              );
            }
            generated = {
              runId,
              executeRequest: existingRequest,
              executeRequestPath,
              lineagePath: `${deploymentRoot}/lineage.json`,
              resultPath: `${deploymentRoot}/result.json`,
            };
          } else {
            generated = createDeploymentExecuteChildRun({
              workspaceRoot: root,
              prepareReceipt,
              remoteManifest: manifest,
              ownerAuthority,
              ownerDecision,
            });
          }
          executeRequest = generated.executeRequest;
        } else {
          executeRequest = readJson(
            realpathSync(requireOption(options, "request")),
          );
        }
        const lineageOutput = automatic
          ? generated.lineagePath
          : requireOption(options, "lineage-output");
        const resultOutput = automatic
          ? generated.resultPath
          : requireOption(options, "output");
        let detectedSupersession = null;
        try {
          if (automatic) {
            const initialDecisionState = inspectDeploymentOwnerDecisionStateV1({
              workspaceRoot: root,
              descriptor: executeRequest.ownerDecision,
              expectedDecisionSha256:
                prepareReceipt.ownerDecision?.decisionSha256,
            });
            if (initialDecisionState.status === "superseded") {
              detectedSupersession = {
                priorDecision: {
                  decisionSha256:
                    prepareReceipt.ownerDecision.decisionSha256,
                },
                replacementDecision: initialDecisionState.decision,
              };
              const error = new Error("owner_decision_superseded");
              error.code = "owner_decision_superseded";
              error.replacementDecision = initialDecisionState.decision;
              throw error;
            }
          }
          const lineage = createDeploymentExecuteLineageFromActiveRun({
            workspaceRoot: root,
            prepareReceipt,
            executeRequest,
            remoteManifest: manifest,
            remoteManifestBytes: manifestBytes,
            verifyOwnerAuthority:
              runtimeHooks.verifyOwnerDeploymentAuthority,
          });
          const lineagePath = resuming
            ? writeOrVerifyWorkspaceArtifact(
                root,
                lineageOutput,
                "deployment lineage output",
                lineage,
              )
            : writeWorkspaceArtifact(
                root,
                lineageOutput,
                "deployment lineage output",
                lineage,
              );
          if (
            manifest.deploymentLineageSha256 !== null
            && manifest.deploymentLineageSha256 !== lineage.lineageSha256
          ) {
            throw new Error("Remote deployment manifest lineage does not match the execute lineage.");
          }
          const boundManifest = {
            ...manifest,
            deploymentLineageSha256: lineage.lineageSha256,
          };
          if (
            JSON.stringify(boundManifest.target) !== JSON.stringify(lineage.target.value)
            || JSON.stringify(boundManifest.artifact) !== JSON.stringify(lineage.parent.artifact)
          ) {
            throw new Error("Remote deployment manifest target or artifact does not match the execute lineage.");
          }
          const remoteAdapter = createDeclaredRemoteAdapter(
            boundManifest,
            root,
          );
          const executeRequestPath = automatic
            ? path.join(root, generated.executeRequestPath)
            : realpathSync(requireOption(options, "request"));
          const stageJournal = createRemoteDeploymentStageJournalV1({
            journalRoot: path.join(
              root,
              RUNTIME_ROOT,
              "deployments",
              executeRequest.executeRunId,
              "stage-journal",
            ),
            binding: {
              deploymentId: executeRequest.executeRunId,
              deploymentLineageSha256: lineage.lineageSha256,
              remoteManifestSha256: sha256(manifestBytes),
              executeRequestSha256: sha256(readFileSync(executeRequestPath)),
              adapterIdentity: remoteAdapter.identity,
            },
          });
          const result = await executeRemoteDeployment({
            manifest: boundManifest,
            adapter: remoteAdapter,
            permissions: lineage.permissions,
            stageJournal,
            beforeStageGuard() {
              const decisionState = inspectDeploymentOwnerDecisionStateV1({
                workspaceRoot: root,
                descriptor: executeRequest.ownerDecision,
                expectedDecisionSha256:
                  lineage.ownerDecision.decisionSha256,
              });
              if (decisionState.status === "superseded") {
                detectedSupersession = {
                  priorDecision: {
                    decisionSha256:
                      lineage.ownerDecision.decisionSha256,
                  },
                  replacementDecision: decisionState.decision,
                };
                const error = new Error("owner_decision_superseded");
                error.code = "owner_decision_superseded";
                throw error;
              }
              const currentLineage = createDeploymentExecuteLineageFromActiveRun({
                workspaceRoot: root,
                prepareReceipt,
                executeRequest,
                remoteManifest: manifest,
                remoteManifestBytes: manifestBytes,
                verifyOwnerAuthority:
                  runtimeHooks.verifyOwnerDeploymentAuthority,
              });
              if (currentLineage.lineageSha256 !== lineage.lineageSha256) {
                throw new Error(
                  "Deployment child control state drifted during remote execution.",
                );
              }
            },
          });
          if (result.status === "reconciliation_required") {
            return {
              ...result,
              exitCode: 2,
              runId: executeRequest.executeRunId,
              executeRequestPath: generated?.executeRequestPath ?? null,
              lineagePath,
              resultPath: null,
              stageJournalPath: relativePath(root, stageJournal.journalRoot),
              closeoutDecision: null,
              childRemainsActive: true,
            };
          }
          if (automatic && result.status === "deployed") {
            const finalLineage = createDeploymentExecuteLineageFromActiveRun({
              workspaceRoot: root,
              prepareReceipt,
              executeRequest,
              remoteManifest: manifest,
              remoteManifestBytes: manifestBytes,
              verifyOwnerAuthority:
                runtimeHooks.verifyOwnerDeploymentAuthority,
            });
            if (finalLineage.lineageSha256 !== lineage.lineageSha256) {
              throw new Error(
                "Deployment child control state drifted before closeout.",
              );
            }
          }
          const resultPath = resuming
            ? writeOrVerifyWorkspaceArtifact(
                root,
                resultOutput,
                "remote deployment result output",
                result,
              )
            : writeWorkspaceArtifact(
                root,
                resultOutput,
                "remote deployment result output",
                result,
              );
          const closeout = automatic
            ? closeDeploymentExecuteChildRun({
                workspaceRoot: root,
                prepareReceipt,
                executeRequest,
                result,
                resultPath,
                ...(detectedSupersession === null
                  ? {}
                  : { supersession: detectedSupersession }),
              })
            : null;
          return {
            ...result,
            exitCode: result.status === "deployed" ? 0 : 2,
            runId: executeRequest.executeRunId,
            executeRequestPath: generated?.executeRequestPath ?? null,
            lineagePath,
            resultPath,
            ...(closeout ?? {}),
          };
        } catch (error) {
          if (!automatic) throw error;
          if (
            error?.code === "owner_decision_superseded"
            && detectedSupersession !== null
          ) {
            const result = {
              schemaVersion: "OwlCodaRunKitDeploymentWorkflowFailureV1",
              deploymentId: executeRequest.executeRunId,
              status: "failed",
              completedStages: [],
              stoppedAtStage: "control_preflight",
              failureCode: "owner_decision_superseded",
              authorizationGranted: false,
            };
            const resultPath = resuming
              ? writeOrVerifyWorkspaceArtifact(
                root,
                resultOutput,
                "remote deployment result output",
                result,
              )
              : writeWorkspaceArtifact(
                root,
                resultOutput,
                "remote deployment result output",
                result,
              );
            const closeout = closeDeploymentExecuteChildRun({
              workspaceRoot: root,
              prepareReceipt,
              executeRequest,
              result,
              resultPath,
              supersession: detectedSupersession,
            });
            return {
              ...result,
              exitCode: 2,
              runId: executeRequest.executeRunId,
              executeRequestPath: generated.executeRequestPath,
              lineagePath: generated.lineagePath,
              resultPath,
              issues: [error.message],
              ...closeout,
            };
          }
          if (resuming) {
            return {
              schemaVersion: "OwlCodaRunKitDeploymentWorkflowFailureV1",
              deploymentId: executeRequest.executeRunId,
              status: "failed",
              completedStages: [],
              stoppedAtStage: "control_preflight",
              failureCode: "deployment_resume_control_preflight_failed",
              exitCode: 2,
              runId: executeRequest.executeRunId,
              executeRequestPath: generated.executeRequestPath,
              lineagePath: generated.lineagePath,
              resultPath: null,
              closeoutDecision: null,
              childRemainsActive: true,
              issues: [error instanceof Error ? error.message : String(error)],
              authorizationGranted: false,
            };
          }
          const result = {
            schemaVersion: "OwlCodaRunKitDeploymentWorkflowFailureV1",
            deploymentId: executeRequest.executeRunId,
            status: "failed",
            completedStages: [],
            stoppedAtStage: "control_preflight",
            failureCode: "deployment_control_preflight_failed",
            authorizationGranted: false,
          };
          const resultPath = writeWorkspaceArtifact(
            root,
            resultOutput,
            "remote deployment result output",
            result,
          );
          const closeout = closeDeploymentExecuteChildRun({
            workspaceRoot: root,
            prepareReceipt,
            executeRequest,
            result,
            resultPath,
          });
          return {
            ...result,
            exitCode: 2,
            runId: executeRequest.executeRunId,
            executeRequestPath: generated.executeRequestPath,
            lineagePath: generated.lineagePath,
            resultPath,
            issues: [error instanceof Error ? error.message : String(error)],
            ...closeout,
          };
        }
      }
      throw new Error("Usage: npx --no-install owlrunkit deployment <prepare|execute> [options]");
    }
    if (command === "formal") {
      const allowedFormalOptions = {
        start: ["workspace", "run-id", "goal", "work-item", "owned-path"],
        preflight: ["workspace", "envelope", "json"],
        check: ["workspace", "run-id", "work-item", "from-lease", "check-id", "envelope", "cwd"],
        "attach-evidence": ["workspace", "run-id", "evidence-id", "kind", "receipt", "json"],
        finish: ["workspace", "run-id", "decision", "finalize-id"],
      };
      if (!Object.hasOwn(allowedFormalOptions, action)) {
        throw new Error("Usage: npx --no-install owlrunkit formal <start|preflight|check|attach-evidence|finish> [options]");
      }
      assertOnlyOptions(options, allowedFormalOptions[action]);
      if (action === "start") {
        return startExecution({
          ...options,
          "work-item": options["work-item"] ?? "delivery",
        });
      }
      if (action === "preflight") {
        const root = workspace(options);
        const envelope = readJson(realpathSync(requireOption(options, "envelope")));
        const preflight = preflightFormalEnvelopeV1({
          workspaceRoot: root,
          envelope,
        });
        return options.json === true
          ? preflight
          : withHumanOutput(
              preflight,
              formatFormalEnvelopePreflightHumanV1(preflight),
            );
      }
      if (action === "check") {
        const workItemId = options["work-item"] ?? options["from-lease"] ?? "delivery";
        if (
          options["work-item"] !== undefined
          && options["from-lease"] !== undefined
          && options["work-item"] !== options["from-lease"]
        ) {
          throw new Error("formal check work-item and legacy from-lease must match.");
        }
        if (options.envelope !== undefined) {
          if (commandArgv.length > 0) {
            throw new Error("formal check accepts either --envelope or an exact built-in command, not both.");
          }
          if (options.cwd !== undefined) {
            throw new Error("formal check --cwd is only valid with an exact built-in command.");
          }
          const root = workspace(options);
          const envelope = readJson(realpathSync(requireOption(options, "envelope")));
          return await recordFormalEnvelopeCheckV1({
            workspaceRoot: root,
            runId: safeRunId(requireOption(options, "run-id")),
            workItemId,
            checkId: requireOption(options, "check-id"),
            envelope,
          });
        }
        return recordFormalCheckV1({
          workspaceRoot: workspace(options),
          runId: safeRunId(requireOption(options, "run-id")),
          workItemId,
          checkId: requireOption(options, "check-id"),
          cwd: options.cwd ?? ".",
          commandArgv,
        });
      }
      if (action === "attach-evidence") {
        return attachFormalSupplementalEvidenceV1({
          workspaceRoot: workspace(options),
          runId: safeRunId(requireOption(options, "run-id")),
          evidenceId: requireOption(options, "evidence-id"),
          kind: requireOption(options, "kind"),
          receiptPath: requireOption(options, "receipt"),
        });
      }
      if (action === "finish") {
        const decision = options.decision ?? "accepted";
        if (!new Set(["accepted", "rejected", "blocked"]).has(decision)) {
          throw new Error("decision must be accepted, rejected, or blocked.");
        }
        const root = workspace(options);
        const runId = safeRunId(requireOption(options, "run-id"));
        const finalizeId = options["finalize-id"] ?? "formal-final";
        const resumed = resumeCompletedFormalFinishV1({
          workspaceRoot: root,
          runId,
          finalizeId,
          decision,
        });
        if (resumed !== null) {
          const evidenceSummary = decision === "accepted"
              ? reattestFormalEvidenceSummaryV1({
                workspaceRoot: root,
                runId,
                summaryId: `${finalizeId}-evidence`,
              })
            : null;
          if (
            resumed.formalEvidenceBinding !== null
            && (
              evidenceSummary === null
              || evidenceSummary.evidenceSummaryPath
                !== resumed.formalEvidenceBinding.summaryPath
              || evidenceSummary.evidenceSummarySha256
                !== resumed.formalEvidenceBinding.summarySha256
              || evidenceSummary.formalCheckCount
                !== resumed.formalEvidenceBinding.formalCheckCount
              || evidenceSummary.supplementalEvidenceCount
                !== resumed.formalEvidenceBinding.supplementalEvidenceCount
              || evidenceSummary.staleSupplementalEvidenceCount
                !== resumed.formalEvidenceBinding.staleSupplementalEvidenceCount
            )
          ) {
            throw new Error(
              "Existing closeout does not match its Formal evidence summary.",
            );
          }
          const { formalEvidenceBinding: _formalEvidenceBinding, ...resumedResult } = resumed;
          return {
            ...resumedResult,
            supplementalEvidenceCount:
              evidenceSummary?.supplementalEvidenceCount ?? 0,
            staleSupplementalEvidenceCount:
              evidenceSummary?.staleSupplementalEvidenceCount ?? 0,
            evidenceSummaryPath: evidenceSummary?.evidenceSummaryPath,
            evidenceSummarySha256: evidenceSummary?.evidenceSummarySha256,
          };
        }
        return withControlTransaction(root, () => {
          let finalized = null;
          let evidenceSummary = null;
          if (decision === "accepted") {
            finalized = finalizeFormalChecksWithinControlTransaction({
              workspaceRoot: root,
              runId,
              finalizeId,
            });
            if (finalized.status !== "accepted_passed") return finalized;
            evidenceSummary = summarizeFormalEvidenceWithinControlTransaction({
              workspaceRoot: root,
              runId,
              summaryId: `${finalizeId}-evidence`,
            });
            if (evidenceSummary.status !== "formal_evidence_summarized") {
              return evidenceSummary;
            }
          }
          const finished = finishExecutionWithinControlTransaction({
            ...options,
            decision,
          }, { formalEvidenceSummary: evidenceSummary });
          if (finished.status !== "finished") return finished;
          return {
            status: "formal_finished",
            exitCode: 0,
            runId: finished.runId,
            decision,
            snapshotCount: finalized?.snapshotCount ?? 0,
            staleCheckCount: finalized?.staleCheckCount ?? 0,
            supplementalEvidenceCount:
              evidenceSummary?.supplementalEvidenceCount ?? 0,
            staleSupplementalEvidenceCount:
              evidenceSummary?.staleSupplementalEvidenceCount ?? 0,
            evidenceSummaryPath: evidenceSummary?.evidenceSummaryPath ?? null,
            evidenceSummarySha256:
              evidenceSummary?.evidenceSummarySha256 ?? null,
            sourceFingerprint: finalized?.sourceFingerprint ?? null,
            activeReceiptSha256: finished.activeReceiptSha256,
            closeoutArtifactSha256: finished.closeoutArtifactSha256,
            releasedLeaseIds: finished.releasedLeaseIds,
            authorizationGranted: false,
          };
        });
      }
      throw new Error("Usage: npx --no-install owlrunkit formal <start|preflight|check|attach-evidence|finish> [options]");
    }
    if (command === "candidate") {
      if (action === "freeze") {
        const freezeCandidate = options["delivery-v1"] === true
          ? freezeSourceCandidateV1
          : freezeSourceCandidateV2;
        return freezeCandidate({
          workspaceRoot: workspace(options),
          runId: safeRunId(requireOption(options, "run-id")),
          workItemId: requireOption(options, "from-lease"),
          candidateId: requireOption(options, "candidate-id"),
        });
      }
      if (action === "verify") {
        const root = workspace(options);
        const candidatePath = requireOption(options, "candidate");
        const candidate = readWorkspaceArtifact(
          root,
          candidatePath,
          "source candidate",
        );
        if (candidate.schemaVersion === "OwlCodaRunKitSourceCandidateV2") {
          return verifySourceCandidateV2({
            workspaceRoot: root,
            candidatePath,
          });
        }
        return verifySourceCandidateV1({
          workspaceRoot: root,
          candidatePath,
        });
      }
      if (action === "materialize") {
        return materializeSourceCandidateV2({
          workspaceRoot: workspace(options),
          candidatePath: requireOption(options, "candidate"),
          targetWorkspaceRoot: requireOption(options, "target-workspace"),
        });
      }
      throw new Error("Usage: npx --no-install owlrunkit candidate <freeze|verify|materialize> [options]");
    }
    if (command === "start") return startExecution(options);
    if (command === "plan") {
      const root = workspace(options);
      return withControlTransaction(root, () => plan(options));
    }
    if (command === "hook") {
      if (action !== "recovery") {
        throw new Error("Usage: npx --no-install owlrunkit hook recovery --workspace <directory> --json");
      }
      assertOnlyOptions(options, ["workspace", "json"]);
      return buildHookRecoveryV1({
        workspaceRoot: requireOption(options, "workspace"),
      });
    }
    if (command === "inspect") return inspect(options);
    if (command === "status") {
      const inspected = inspect({ ...options, json: true });
      const status = deriveHumanStatusFromInspectV1(inspected);
      return options.json === true
        ? { ...status, exitCode: status.overall === "blocked" ? 2 : 0 }
        : withHumanOutput(
            { ...status, exitCode: status.overall === "blocked" ? 2 : 0 },
            [
              status.headline,
              `Stage: ${status.stage}`,
              `Completed: ${status.completedSteps.length > 0 ? status.completedSteps.join(", ") : "none"}`,
              `Source/data readiness: ${status.milestones.sourceData.status}`,
              `Release package: ${status.milestones.releasePackage.status}`,
              `Remote/VM write: ${status.milestones.remoteVmWrite.status}`,
              `Remaining gates: ${status.remainingGateCount}`,
              `Next: ${status.nextAllowedAction}`,
              "",
            ].join("\n"),
          );
    }
    if (command === "project") {
      const allowedProjectOptions = {
        init: ["workspace", "definition", "json"],
        assign: [
          "workspace", "request", "assignment-id", "at", "work-item", "agent",
          "supersedes", "execution-run-id", "execution-work-item", "json",
        ],
        handoff: [
          "workspace", "request", "handoff-id", "at", "assignment-id", "work-item",
          "from-agent", "to-agent", "summary", "next", "evidence", "json",
        ],
        "reject-and-return": [
          "workspace", "rework-id", "at", "work-item", "reviewer-agent",
          "to-agent", "reason", "next", "evidence", "json",
        ],
        "reopen-upstream": [
          "workspace", "reopen-id", "at", "upstream-work-item", "trigger-work-item",
          "reviewer-agent", "to-agent", "reason", "next", "evidence", "json",
        ],
        transfer: [
          "workspace", "transfer-id", "at", "assignment-id", "work-item",
          "from-agent", "to-agent", "state", "summary", "completed-units",
          "evidence", "blocker", "decision", "next", "source-fingerprint", "json",
        ],
        "work-item revise-scope": [
          "workspace", "revision-id", "at", "assignment-id", "work-item",
          "owner-agent", "owned-path", "measurable-unit", "measurable-total",
          "unmeasured", "reason", "evidence", "json",
        ],
        "work-item require-evidence": [
          "workspace", "policy-id", "at", "work-item", "owner-agent",
          "requirement", "reason", "evidence", "json",
        ],
        reconcile: [
          "workspace", "reconciliation-id", "at", "gate-id", "title",
          "required-for", "gate-status", "owner-agent", "source-adapter",
          "source-ref", "source-sha256", "summary", "evidence", "json",
        ],
        "delivery record": [
          "workspace", "record-id", "at", "stage", "stage-status",
          "owner-agent", "summary", "evidence", "external-gate", "json",
        ],
        decision: [
          "workspace", "request", "open", "resolve", "decision-id", "at", "title",
          "question", "owner-agent", "blocking-work-item", "option", "resolution",
          "rationale", "evidence", "json",
        ],
        checkpoint: [
          "workspace", "request", "checkpoint-id", "at", "assignment-id", "work-item",
          "state", "summary", "completed-units", "evidence", "blocker", "decision",
          "next", "source-fingerprint", "from-quick-receipt", "json",
        ],
        verification: [
          "workspace", "request", "defer", "close", "verification-id", "at",
          "work-item", "owner-agent", "check", "reason", "due-gate",
          "disposition", "summary", "evidence", "decision", "json",
        ],
        integrate: ["workspace", "request", "gate", "at", "summary", "evidence", "json"],
        capture: ["workspace", "request", "json"],
        "target-snapshot": [
          "workspace", "snapshot-id", "at", "work-item", "target-workspace",
          "allowed-path", "dry-run", "apply", "json",
        ],
        "import-delivery": [
          "workspace", "delivery-id", "at", "assignment-id", "work-item",
          "producer", "target-workspace", "packet", "entry-snapshot",
          "dry-run", "apply", "json",
        ],
        status: ["workspace", "json"],
        takeover: ["workspace", "agent", "json"],
        successor: ["workspace", "transition-id", "at", "definition", "reason", "json"],
        "successor scaffold": ["workspace", "from-workspace", "dry-run", "json"],
      };
      if (Object.hasOwn(allowedProjectOptions, action)) {
        assertOnlyOptions(options, allowedProjectOptions[action]);
      }
      const root = requireOption(options, "workspace");
      if (action === "init") {
        return initializeTeamProjectV1({
          workspaceRoot: root,
          definition: readJson(realpathSync(requireOption(options, "definition"))),
        });
      }
      if (action === "target-snapshot") {
        if ((options.apply === true) === (options["dry-run"] === true)) {
          throw new Error("project target-snapshot requires exactly one of --dry-run or --apply.");
        }
        const captured = captureTargetWorkspaceSnapshotV1({
          controllerWorkspaceRoot: root,
          snapshotId: requireOption(options, "snapshot-id"),
          occurredAt: requireOption(options, "at"),
          workItemId: requireOption(options, "work-item"),
          targetWorkspaceRoot: requireOption(options, "target-workspace"),
          allowedPaths: options["allowed-path"],
          apply: options.apply === true,
        });
        return options.json === true
          ? captured
          : withHumanOutput(captured, formatTargetSnapshotHuman(captured));
      }
      if (action === "import-delivery") {
        if ((options.apply === true) === (options["dry-run"] === true)) {
          throw new Error("project import-delivery requires exactly one of --dry-run or --apply.");
        }
        const imported = importExternalDeliveryV1({
          controllerWorkspaceRoot: root,
          deliveryId: requireOption(options, "delivery-id"),
          occurredAt: requireOption(options, "at"),
          assignmentId: requireOption(options, "assignment-id"),
          workItemId: requireOption(options, "work-item"),
          producerId: requireOption(options, "producer"),
          targetWorkspaceRoot: requireOption(options, "target-workspace"),
          packetPath: requireOption(options, "packet"),
          entrySnapshotId: options["entry-snapshot"] ?? null,
          apply: options.apply === true,
        });
        return options.json === true
          ? imported
          : withHumanOutput(imported, formatExternalDeliveryHuman(imported));
      }
      if (action === "assign") {
        const directAssignmentFields = [
          "assignment-id",
          "at",
          "work-item",
          "agent",
          "supersedes",
          "execution-run-id",
          "execution-work-item",
        ];
        const hasDirectAssignmentFields = directAssignmentFields.some(
          name => options[name] !== undefined,
        );
        if (options.request !== undefined && hasDirectAssignmentFields) {
          throw new Error("--request cannot be combined with direct assignment fields.");
        }
        if (options.request !== undefined) {
          const requestedEvent = readJson(realpathSync(requireOption(options, "request")));
          if (requestedEvent?.type !== "agent_assigned") {
            throw new Error("Project assign request only accepts type=agent_assigned.");
          }
          return appendTeamProjectEventV1({
            workspaceRoot: root,
            event: requestedEvent,
          });
        }
        const assigned = assignTeamProjectV1({
          workspaceRoot: root,
          assignmentId: options["assignment-id"],
          occurredAt: options.at,
          workItemId: options["work-item"],
          agentId: options.agent,
          supersedesAssignmentId: options.supersedes,
          executionRunId: options["execution-run-id"],
          executionWorkItemId: options["execution-work-item"],
        });
        return options.json === true
          ? assigned
          : withHumanOutput(assigned, formatTeamProjectAssignmentHuman(assigned));
      }
      if (action === "handoff") {
        const directHandoffFields = [
          "handoff-id",
          "at",
          "assignment-id",
          "work-item",
          "from-agent",
          "to-agent",
          "summary",
          "next",
          "evidence",
        ];
        const hasDirectHandoffFields = directHandoffFields.some(
          name => options[name] !== undefined,
        );
        if (options.request !== undefined && hasDirectHandoffFields) {
          throw new Error("--request cannot be combined with direct handoff fields.");
        }
        if (options.request !== undefined) {
          const requestedEvent = readJson(realpathSync(requireOption(options, "request")));
          if (requestedEvent?.type !== "handoff_recorded") {
            throw new Error("Project handoff request only accepts type=handoff_recorded.");
          }
          return appendTeamProjectEventV1({
            workspaceRoot: root,
            event: requestedEvent,
          });
        }
        const handedOff = handoffTeamProjectV1({
          workspaceRoot: root,
          handoffId: options["handoff-id"],
          occurredAt: options.at,
          assignmentId: options["assignment-id"],
          workItemId: options["work-item"],
          fromAgentId: options["from-agent"],
          toAgentId: options["to-agent"],
          summary: options.summary,
          nextAction: options.next,
          evidenceRefs: options.evidence,
        });
        return options.json === true
          ? handedOff
          : withHumanOutput(handedOff, formatTeamProjectHandoffHuman(handedOff));
      }
      if (action === "reject-and-return") {
        const returned = rejectAndReturnTeamProjectV1({
          workspaceRoot: root,
          reworkId: requireOption(options, "rework-id"),
          occurredAt: requireOption(options, "at"),
          workItemId: requireOption(options, "work-item"),
          reviewerAgentId: requireOption(options, "reviewer-agent"),
          toAgentId: requireOption(options, "to-agent"),
          reason: requireOption(options, "reason"),
          nextAction: requireOption(options, "next"),
          evidenceRefs: options.evidence ?? [],
        });
        return options.json === true
          ? returned
          : withHumanOutput(returned, formatTeamProjectReworkHuman(returned));
      }
      if (action === "reopen-upstream") {
        const evidenceRefs = options.evidence ?? [];
        if (evidenceRefs.length === 0) {
          throw new Error("Project reopen-upstream requires at least one --evidence.");
        }
        const reopened = reopenUpstreamTeamProjectV1({
          workspaceRoot: root,
          reopenId: requireOption(options, "reopen-id"),
          occurredAt: requireOption(options, "at"),
          upstreamWorkItemId: requireOption(options, "upstream-work-item"),
          triggerWorkItemId: requireOption(options, "trigger-work-item"),
          reviewerAgentId: requireOption(options, "reviewer-agent"),
          toAgentId: requireOption(options, "to-agent"),
          reason: requireOption(options, "reason"),
          nextAction: requireOption(options, "next"),
          evidenceRefs,
        });
        return options.json === true
          ? reopened
          : withHumanOutput(reopened, formatTeamProjectUpstreamReopenHuman(reopened));
      }
      if (action === "transfer") {
        const evidenceRefs = options.evidence ?? [];
        if (evidenceRefs.length === 0) {
          throw new Error("Project transfer requires at least one --evidence.");
        }
        const transferred = transferTeamProjectV1({
          workspaceRoot: root,
          transferId: requireOption(options, "transfer-id"),
          occurredAt: requireOption(options, "at"),
          assignmentId: requireOption(options, "assignment-id"),
          workItemId: requireOption(options, "work-item"),
          fromAgentId: requireOption(options, "from-agent"),
          toAgentId: requireOption(options, "to-agent"),
          state: requireOption(options, "state"),
          summary: requireOption(options, "summary"),
          completedUnits: options["completed-units"] === undefined
            ? undefined
            : Number(options["completed-units"]),
          evidenceRefs,
          blockerRefs: options.blocker ?? [],
          decisionRefs: options.decision ?? [],
          nextAction: requireOption(options, "next"),
          sourceFingerprint: options["source-fingerprint"],
        });
        return options.json === true
          ? transferred
          : withHumanOutput(transferred, formatTeamProjectTransferHuman(transferred));
      }
      if (action === "work-item revise-scope") {
        const currentStatus = readTeamProjectStatusV3({ workspaceRoot: root });
        const workItemId = requireOption(options, "work-item");
        const currentWorkItem = currentStatus.workItems.find(
          row => row.workItemId === workItemId,
        );
        if (!currentWorkItem) throw new Error(`Unknown team project WorkItem: ${workItemId}.`);
        const hasUnit = options["measurable-unit"] !== undefined;
        const hasTotal = options["measurable-total"] !== undefined;
        if (options.unmeasured === true && (hasUnit || hasTotal)) {
          throw new Error("--unmeasured cannot be combined with measurable-unit or measurable-total.");
        }
        if (hasUnit !== hasTotal) {
          throw new Error("measurable-unit and measurable-total must be supplied together.");
        }
        const measurable = options.unmeasured === true
          ? null
          : hasUnit
            ? {
                unit: requireOption(options, "measurable-unit"),
                total: parseCanonicalNonnegativeSafeInteger(
                  requireOption(options, "measurable-total"),
                  "measurable-total",
                ),
              }
            : currentWorkItem.measurable;
        if (measurable?.total === 0) {
          throw new Error("measurable-total must be a positive safe integer.");
        }
        const revised = reviseTeamProjectWorkItemScopeV1({
          workspaceRoot: root,
          revisionId: requireOption(options, "revision-id"),
          occurredAt: requireOption(options, "at"),
          assignmentId: requireOption(options, "assignment-id"),
          workItemId,
          ownerAgentId: requireOption(options, "owner-agent"),
          ownedPaths: options["owned-path"] ?? currentWorkItem.ownedPaths,
          measurable,
          reason: requireOption(options, "reason"),
          evidenceRefs: options.evidence ?? [],
        });
        return options.json === true
          ? revised
          : withHumanOutput(revised, [
              `Revised WorkItem ${revised.workItemId} scope as ${revised.revisionId}.`,
              `Owned paths: ${revised.ownedPaths.join(", ")}.`,
              "Project definition remains immutable; no Git or release authority was granted.",
              "",
            ].join("\n"));
      }
      if (action === "work-item require-evidence") {
        const evidenceRefs = options.evidence ?? [];
        if (evidenceRefs.length === 0) {
          throw new Error("WorkItem evidence requirement requires at least one --evidence.");
        }
        const policy = setWorkItemEvidenceRequirementV1({
          workspaceRoot: root,
          policyId: requireOption(options, "policy-id"),
          occurredAt: requireOption(options, "at"),
          workItemId: requireOption(options, "work-item"),
          ownerAgentId: requireOption(options, "owner-agent"),
          requirement: requireOption(options, "requirement"),
          reason: requireOption(options, "reason"),
          evidenceRefs,
        });
        return options.json === true
          ? policy
          : withHumanOutput(policy, [
              `WorkItem ${policy.workItemId} evidence requirement: ${policy.requirement}.`,
              "Assurance was not changed and authority was not granted.",
              "",
            ].join("\n"));
      }
      if (action === "reconcile") {
        const evidenceRefs = options.evidence ?? [];
        if (evidenceRefs.length === 0) {
          throw new Error("Project reconcile requires at least one --evidence.");
        }
        const reconciled = reconcileExternalGateV1({
          workspaceRoot: root,
          reconciliationId: requireOption(options, "reconciliation-id"),
          occurredAt: requireOption(options, "at"),
          gateId: requireOption(options, "gate-id"),
          title: requireOption(options, "title"),
          requiredFor: requireOption(options, "required-for"),
          gateStatus: requireOption(options, "gate-status"),
          ownerAgentId: requireOption(options, "owner-agent"),
          sourceAdapterId: requireOption(options, "source-adapter"),
          sourceRef: requireOption(options, "source-ref"),
          sourceSha256: requireOption(options, "source-sha256"),
          summary: requireOption(options, "summary"),
          evidenceRefs,
        });
        return options.json === true
          ? reconciled
          : withHumanOutput(reconciled, [
              `External Gate ${reconciled.gateId}: ${reconciled.gateStatus}.`,
              `Next: ${reconciled.nextAction ?? "none"}.`,
              "Authority: not granted.",
              "",
            ].join("\n"));
      }
      if (action === "delivery record") {
        const evidenceRefs = options.evidence ?? [];
        if (evidenceRefs.length === 0) {
          throw new Error("Project delivery record requires at least one --evidence.");
        }
        const recorded = recordDeliveryLifecycleV1({
          workspaceRoot: root,
          recordId: requireOption(options, "record-id"),
          occurredAt: requireOption(options, "at"),
          stage: requireOption(options, "stage"),
          stageStatus: requireOption(options, "stage-status"),
          ownerAgentId: requireOption(options, "owner-agent"),
          summary: requireOption(options, "summary"),
          evidenceRefs,
          externalGateIds: options["external-gate"] ?? [],
        });
        return options.json === true
          ? recorded
          : withHumanOutput(recorded, [
              `Delivery stage ${recorded.stage}: ${recorded.stageStatus}.`,
              `Next: ${recorded.nextAction ?? "none"}.`,
              "Authority: not granted.",
              "",
            ].join("\n"));
      }
      if (action === "decision") {
        const directDecisionFields = [
          "open",
          "resolve",
          "decision-id",
          "at",
          "title",
          "question",
          "owner-agent",
          "blocking-work-item",
          "option",
          "resolution",
          "rationale",
          "evidence",
        ];
        const hasDirectDecisionFields = directDecisionFields.some(
          name => options[name] !== undefined,
        );
        if (options.request !== undefined && hasDirectDecisionFields) {
          throw new Error("--request cannot be combined with direct decision fields.");
        }
        if (options.request !== undefined) {
          const requestedEvent = readJson(realpathSync(requireOption(options, "request")));
          if (!new Set(["decision_opened", "decision_resolved"])
            .has(requestedEvent?.type)) {
            throw new Error(
              "Project decision request only accepts type=decision_opened or decision_resolved.",
            );
          }
          return appendTeamProjectEventV1({
            workspaceRoot: root,
            event: requestedEvent,
          });
        }
        if (options.open === options.resolve) {
          throw new Error("Exactly one of --open or --resolve is required.");
        }
        const decisionId = requireOption(options, "decision-id");
        const occurredAt = requireOption(options, "at");
        if (options.open === true) {
          if (options.resolution !== undefined
            || options.rationale !== undefined
            || options.evidence !== undefined) {
            throw new Error("Decision open cannot accept resolution, rationale, or evidence.");
          }
          if ((options.option ?? []).length === 0) {
            throw new Error("Decision open requires at least one --option.");
          }
          const opened = openTeamProjectDecisionV1({
            workspaceRoot: root,
            decisionId,
            occurredAt,
            title: requireOption(options, "title"),
            question: requireOption(options, "question"),
            ownerAgentId: requireOption(options, "owner-agent"),
            blockingWorkItemIds: options["blocking-work-item"] ?? [],
            options: options.option,
          });
          return options.json === true
            ? opened
            : withHumanOutput(opened, formatTeamProjectDecisionHuman(opened));
        }
        if (options.title !== undefined
          || options.question !== undefined
          || options["owner-agent"] !== undefined
          || options["blocking-work-item"] !== undefined
          || options.option !== undefined) {
          throw new Error("Decision resolve cannot accept title, question, owner-agent, blocking-work-item, or option.");
        }
        if ((options.evidence ?? []).length === 0) {
          throw new Error("Decision resolve requires at least one --evidence.");
        }
        const resolved = resolveTeamProjectDecisionV1({
          workspaceRoot: root,
          decisionId,
          occurredAt,
          resolution: requireOption(options, "resolution"),
          rationale: requireOption(options, "rationale"),
          evidenceRefs: options.evidence,
        });
        return options.json === true
          ? resolved
          : withHumanOutput(resolved, formatTeamProjectDecisionHuman(resolved));
      }
      if (action === "verification") {
        const directVerificationFields = [
          "defer",
          "close",
          "verification-id",
          "at",
          "work-item",
          "owner-agent",
          "check",
          "reason",
          "due-gate",
          "disposition",
          "summary",
          "evidence",
          "decision",
        ];
        const hasDirectVerificationFields = directVerificationFields.some(
          name => options[name] !== undefined,
        );
        if (options.request !== undefined && hasDirectVerificationFields) {
          throw new Error("--request cannot be combined with direct verification fields.");
        }
        if (options.request !== undefined) {
          const requestedEvent = readJson(realpathSync(requireOption(options, "request")));
          if (!new Set(["verification_deferred", "verification_closed"])
            .has(requestedEvent?.type)) {
            throw new Error(
              "Project verification request only accepts type=verification_deferred or verification_closed.",
            );
          }
          return appendTeamProjectEventV1({
            workspaceRoot: root,
            event: requestedEvent,
          });
        }
        if (options.defer === options.close) {
          throw new Error("Exactly one of --defer or --close is required.");
        }
        const verificationId = requireOption(options, "verification-id");
        const occurredAt = requireOption(options, "at");
        if (options.defer === true) {
          if (options.disposition !== undefined
            || options.summary !== undefined
            || options.evidence !== undefined
            || options.decision !== undefined) {
            throw new Error(
              "Verification defer cannot accept disposition, summary, evidence, or decision.",
            );
          }
          if ((options.check ?? []).length === 0) {
            throw new Error("Verification defer requires at least one --check.");
          }
          const deferred = deferTeamProjectVerificationV1({
            workspaceRoot: root,
            verificationId,
            occurredAt,
            workItemId: requireOption(options, "work-item"),
            ownerAgentId: requireOption(options, "owner-agent"),
            checkIds: options.check,
            reason: requireOption(options, "reason"),
            dueGateId: requireOption(options, "due-gate"),
          });
          return options.json === true
            ? deferred
            : withHumanOutput(deferred, formatTeamProjectVerificationHuman(deferred));
        }
        if (options["work-item"] !== undefined
          || options["owner-agent"] !== undefined
          || options.check !== undefined
          || options.reason !== undefined
          || options["due-gate"] !== undefined) {
          throw new Error(
            "Verification close cannot accept work-item, owner-agent, check, reason, or due-gate.",
          );
        }
        const closed = closeTeamProjectVerificationV1({
          workspaceRoot: root,
          verificationId,
          occurredAt,
          disposition: requireOption(options, "disposition"),
          summary: requireOption(options, "summary"),
          evidenceRefs: options.evidence ?? [],
          decisionIds: options.decision ?? [],
        });
        return options.json === true
          ? closed
          : withHumanOutput(closed, formatTeamProjectVerificationHuman(closed));
      }
      if (action === "checkpoint") {
        const directCheckpointFields = [
          "checkpoint-id",
          "at",
          "assignment-id",
          "work-item",
          "state",
          "summary",
          "completed-units",
          "evidence",
          "blocker",
          "decision",
          "next",
          "source-fingerprint",
          "from-quick-receipt",
        ];
        const hasDirectCheckpointFields = directCheckpointFields.some(
          name => options[name] !== undefined,
        );
        if (options.request !== undefined && hasDirectCheckpointFields) {
          throw new Error("--request cannot be combined with direct checkpoint fields.");
        }
        if (options.request !== undefined) {
          const requestedEvent = readJson(realpathSync(requireOption(options, "request")));
          if (requestedEvent?.type !== "checkpoint_recorded") {
            throw new Error("Project checkpoint request only accepts type=checkpoint_recorded.");
          }
          return appendTeamProjectEventV1({
            workspaceRoot: root,
            event: requestedEvent,
          });
        }
        const checkpointId = requireOption(options, "checkpoint-id");
        const occurredAt = requireOption(options, "at");
        const assignmentId = requireOption(options, "assignment-id");
        const workItemId = requireOption(options, "work-item");
        const state = requireOption(options, "state");
        const summary = requireOption(options, "summary");
        const completedUnits = options["completed-units"] === undefined
          ? undefined
          : parseCanonicalNonnegativeSafeInteger(options["completed-units"], "completed-units");
        let checkpointed;
        try {
          const checkpointInput = {
            workspaceRoot: root,
            checkpointId,
            occurredAt,
            assignmentId,
            workItemId,
            state,
            summary,
            completedUnits,
            evidenceRefs: options.evidence ?? [],
            blockerRefs: options.blocker ?? [],
            decisionRefs: options.decision ?? [],
            nextAction: options.next ?? null,
            sourceFingerprint: options["source-fingerprint"],
          };
          checkpointed = options["from-quick-receipt"] === undefined
            ? checkpointTeamProjectV1(checkpointInput)
            : checkpointTeamProjectFromQuickReceiptV1({
                ...checkpointInput,
                receiptPath: options["from-quick-receipt"],
              });
        } catch (error) {
          if (error instanceof Error
            && error.message === "Measured work item checkpoint requires completedUnits.") {
            const projectStatus = readTeamProjectStatusV2({ workspaceRoot: root });
            const workItem = projectStatus.workItems.find((row) => row.workItemId === workItemId);
            const suggestedUnits = state === "completed"
              ? workItem?.progress.total
              : workItem?.progress.completed;
            if (Number.isSafeInteger(suggestedUnits)) {
              throw new Error(
                "Measured work item checkpoint requires --completed-units. "
                + `Corrected command: ${correctedCheckpointCommand(argv, suggestedUnits)}`,
              );
            }
          }
          throw error;
        }
        return options.json === true
          ? checkpointed
          : withHumanOutput(checkpointed, formatTeamProjectCheckpointHuman(checkpointed));
      }
      if (action === "integrate") {
        const directIntegrationFields = ["gate", "at", "summary", "evidence"];
        const hasDirectIntegrationFields = directIntegrationFields.some(
          name => options[name] !== undefined,
        );
        if (options.request !== undefined && hasDirectIntegrationFields) {
          throw new Error("--request cannot be combined with direct integrate fields.");
        }
        if (options.request !== undefined) {
          const requestedEvent = readJson(realpathSync(requireOption(options, "request")));
          if (requestedEvent?.type !== "integration_gate_passed") {
            throw new Error("Project integrate request only accepts type=integration_gate_passed.");
          }
          return appendTeamProjectEventV1({
            workspaceRoot: root,
            event: requestedEvent,
          });
        }
        const evidenceRefs = options.evidence ?? [];
        if (evidenceRefs.length === 0) {
          throw new Error("Project integrate requires at least one --evidence.");
        }
        const integrated = integrateTeamProjectV1({
          workspaceRoot: root,
          gateId: requireOption(options, "gate"),
          occurredAt: requireOption(options, "at"),
          summary: requireOption(options, "summary"),
          evidenceRefs,
        });
        return options.json === true
          ? integrated
          : withHumanOutput(integrated, formatTeamProjectIntegrationHuman(integrated));
      }
      if (new Set(["checkpoint", "capture"]).has(action)) {
        const requestedEvent = readJson(realpathSync(requireOption(options, "request")));
        if (requestedEvent?.type === "source_delivery_imported") {
          throw new Error(
            "External source delivery events require verified intake; use project import-delivery.",
          );
        }
        if (new Set([
          "external_gate_reconciled",
          "delivery_lifecycle_recorded",
          "work_item_evidence_requirement_set",
          "checkpoint_receipt_bound",
        ])
          .has(requestedEvent?.type)) {
          throw new Error(
            "Phase 2 facts require typed project reconcile, project delivery record, "
            + "project work-item require-evidence, or project checkpoint intake.",
          );
        }
        return appendTeamProjectEventV1({
          workspaceRoot: root,
          event: requestedEvent,
        });
      }
      if (action === "status") {
        const status = readTeamProjectStatusV5({ workspaceRoot: root });
        return options.json === true
          ? status
          : withHumanOutput(status, formatTeamProjectStatusHumanV2(status));
      }
      if (action === "takeover") {
        const takeover = buildTeamProjectTakeoverV4({
          workspaceRoot: root,
          agentId: requireOption(options, "agent"),
        });
        return options.json === true
          ? takeover
          : withHumanOutput(takeover, formatTeamProjectTakeoverHumanV2(takeover));
      }
      if (action === "successor") {
        const successor = successorTeamProjectV1({
          workspaceRoot: root,
          transitionId: requireOption(options, "transition-id"),
          occurredAt: requireOption(options, "at"),
          definitionPath: requireOption(options, "definition"),
          reason: requireOption(options, "reason"),
          onDurableStep: runtimeHooks.onTeamProjectSuccessorStep,
        });
        return options.json === true
          ? successor
          : withHumanOutput(successor, formatTeamProjectSuccessorHumanV1(successor));
      }
      if (action === "successor scaffold") {
        if (options["dry-run"] !== true) {
          throw new Error("project successor scaffold requires --dry-run.");
        }
        const scaffold = buildSuccessorScaffoldV1({
          workspaceRoot: root,
          fromWorkspaceRoot: requireOption(options, "from-workspace"),
        });
        return options.json === true
          ? scaffold
          : withHumanOutput(scaffold, formatSuccessorScaffoldHumanV1(scaffold));
      }
      throw new Error("Usage: npx --no-install owlrunkit project <init|assign|checkpoint|handoff|reject-and-return|reopen-upstream|transfer|work-item revise-scope|reconcile|delivery record|decision|verification|integrate|capture|target-snapshot|import-delivery|status|takeover|successor|successor scaffold> [options]");
    }
    if (command === "profiles") {
      const root = requireOption(options, "workspace");
      if (action === "detect") {
        if (options.apply === true && options["dry-run"] === true) {
          throw new Error("profiles detect accepts either --apply or --dry-run, not both.");
        }
        if (options["dry-run"] === true) return detectProfilesV3({ workspaceRoot: root });
        const detection = detectProfilesV3({ workspaceRoot: root });
        return options.apply === true
          ? applyDetectedProfilesV3({ workspaceRoot: root, detection })
          : detection;
      }
      if (action === "reconcile") {
        if (options.apply === true && options["dry-run"] === true) {
          throw new Error("profiles reconcile accepts either --apply or --dry-run, not both.");
        }
        if (options.apply !== true && options["dry-run"] !== true) {
          throw new Error("profiles reconcile requires --dry-run or --apply.");
        }
        return reconcileProfilesV2({
          workspaceRoot: root,
          apply: options.apply === true,
        });
      }
      if (action === "validate") return validateProfiles({ workspaceRoot: root });
      if (action === "impact") {
        const changedPaths = options.changed ?? [];
        if (changedPaths.length === 0) throw new Error("profiles impact requires --changed.");
        return resolveProfilesImpact({ workspaceRoot: root, changedPaths });
      }
      throw new Error("Usage: npx --no-install owlrunkit profiles <detect|reconcile|validate|impact> [options]");
    }
    if (command === "lease") {
      const root = workspace(options);
      const runId = safeRunId(requireOption(options, "run-id"));
      if (action === "acquire") {
        return acquireLease({
          workspaceRoot: root,
          runId,
          workItemId: requireOption(options, "work-item"),
          ownedPaths: options["owned-path"] ?? [],
        });
      }
      if (action === "inspect") return inspectLeases({ workspaceRoot: root, runId });
      if (action === "release") {
        return releaseLease({
          workspaceRoot: root,
          runId,
          workItemId: requireOption(options, "work-item"),
        });
      }
      throw new Error("Usage: runkit-cli.mjs lease <acquire|inspect|release> [options]");
    }
    if (command === "delivery") {
      if (action !== "create") throw new Error("Usage: runkit-cli.mjs delivery create [options]");
      const root = workspace(options);
      return createDeliveryFromLease({
        workspaceRoot: root,
        runId: safeRunId(requireOption(options, "run-id")),
        workItemId: requireOption(options, "from-lease"),
        packetId: requireOption(options, "packet-id"),
      });
    }
    if (command === "verify") {
      const root = workspace(options);
      const cwd = options.cwd ?? ".";
      validateLegacyVerificationSideEffectsV1({
        commandArgv,
      });
      return runHighLevelVerify({
        workspaceRoot: root,
        runId: safeRunId(requireOption(options, "run-id")),
        workItemId: requireOption(options, "from-lease"),
        verificationId: requireOption(options, "verification-id"),
        cwd,
        commandArgv,
      });
    }
    if (command === "quick-verify") {
      if (commandArgv.length === 0) {
        throw new Error("Usage: runkit-cli.mjs quick-verify --workspace <path> -- <executable> [args...]");
      }
      const verification = await runQuickVerification({
        workspaceRoot: workspace(options),
        foreignWorkspaceRoot: options["foreign-workspace"],
        commandArgv,
        stdinFile: options["stdin-file"],
        isolate: options.isolate === true,
        dependencyRoot: options["dependency-root"],
        ignoredPaths: options["bind-ignored"] ?? [],
        captureRuntime: options["capture-runtime"] === true,
      });
      if (options.attest !== true || typeof verification.receiptPath !== "string") {
        return presentQuickOutcome(verification, options.json === true);
      }
      const details = attestQuickReceiptDetails({
        receiptPath: verification.receiptPath,
        workspaceRoot: workspace(options),
      });
      return presentQuickOutcome({
        ...verification,
        exitCode: details.exitCode === 0 ? verification.exitCode : details.exitCode,
        attestationDecision: details.attestation.decision,
        attestation: details.attestation,
        nextAllowedAction: verification.status === "quick_verification_runtime_truth_invalid"
          ? verification.nextAllowedAction
          : details.attestation.decision === "GO"
            ? "consume_attestation"
            : "inspect_attestation_issues",
        authorizationGranted: false,
      }, options.json === true);
    }
    if (command === "quick-runtime-verify") {
      return verifyRuntimeTransitionReceipt({
        workspaceRoot: workspace(options),
        receiptPath: requireOption(options, "receipt"),
      });
    }
    if (command === "quick-reuse") {
      if (options.apply === true && options["dry-run"] === true) {
        throw new Error("quick-reuse accepts either --apply or --dry-run, not both.");
      }
      if (options.apply !== true && options["dry-run"] !== true) {
        throw new Error("quick-reuse requires --dry-run or --apply.");
      }
      if (commandArgv.length === 0) {
        throw new Error("quick-reuse requires an exact delta command after --.");
      }
      return runQuickEvidenceReuse({
        workspaceRoot: workspace(options),
        baseReceiptPath: requireOption(options, "base-receipt"),
        allowedPaths: options["allow-path"] ?? [],
        commandArgv,
        stdinFile: options["stdin-file"],
        apply: options.apply === true,
      });
    }
    if (command === "quick-attest") {
      const details = attestQuickReceiptDetails({
        receiptPath: requireOption(options, "receipt"),
        workspaceRoot: workspace(options),
      });
      const attestation = details.attestation;
      return {
        status: "quick_attestation",
        exitCode: details.exitCode,
        receiptPath: realpathSync(requireOption(options, "receipt")),
        receiptSha256: attestation.subjectRef.receiptSha256,
        sourceFingerprint: details.sourceFingerprint,
        attestation,
        nextAllowedAction: attestation.decision === "GO"
          ? "consume_attestation"
          : "inspect_attestation_issues",
        authorizationGranted: false,
      };
    }
    if (command === "quick-metrics") {
      const local = readLocalQuickMetrics(workspace(options), {
        verbose: options.verbose === true,
      });
      return {
        ...local,
        metrics: local.quick,
        networkRequests: 0,
      };
    }
    if (command === "efficiency" && action === "record") {
      return recordEfficiencyEventV1({
        workspaceRoot: workspace(options),
        eventId: requireOption(options, "event-id"),
        occurredAt: requireOption(options, "at"),
        kind: requireOption(options, "kind"),
        workflowId: requireOption(options, "workflow-id"),
        summary: requireOption(options, "summary"),
        evidenceRefs: options.evidence ?? [],
      });
    }
    if (command === "efficiency" && action === "status") {
      const metrics = readEfficiencyMetricsV1({
        workspaceRoot: workspace(options),
        verbose: options.verbose === true,
      });
      return options.json === true
        ? metrics
        : withHumanOutput(metrics, formatEfficiencyMetricsHumanV1(metrics));
    }
    if (command === "repair") {
      return runRepairExecution({
        workspaceRoot: workspace(options),
        runId: safeRunId(requireOption(options, "run-id")),
        onPlan: runtimeHooks.onRepairPlan,
      });
    }
    if (command === "offline-export") {
      return exportOfflineReceipt({
        workspaceRoot: workspace(options),
        receiptPath: requireOption(options, "receipt"),
        outputPath: requireOption(options, "output"),
      });
    }
    if (command === "offline-import") {
      return importOfflineReceipt({
        workspaceRoot: workspace(options),
        bundlePath: requireOption(options, "bundle"),
        storeRoot: requireOption(options, "store"),
      });
    }
    if (command === "coverage-adopt") return requestCommand(options, runCoverageAdoption);
    if (command === "resume") {
      const root = workspace(options);
      const sourceRunId = safeRunId(requireOption(options, "run-id"));
      const requestPath = realpathSync(requireOption(options, "request"));
      return runResumeExecution({ workspaceRoot: root, sourceRunId, request: readJson(requestPath) });
    }
    if (command === "verify-plan") return requestCommand(options, runVerifyPlan);
    if (command === "resource-preflight") {
      const root = workspace(options);
      const runId = safeRunId(requireOption(options, "run-id"));
      const requestPath = realpathSync(requireOption(options, "request"));
      const requestBytes = readFileSync(requestPath);
      return withControlTransaction(root, () => runResourcePreflight({
          workspaceRoot: root,
          runId,
          request: JSON.parse(requestBytes.toString("utf8")),
          requestSha256: sha256(requestBytes),
        }));
    }
    if (command === "snapshot") {
      const root = workspace(options);
      return withControlTransaction(root, () => requestCommand(options, runSnapshot));
    }
    if (command === "visual-smoke") return requestCommand(options, runVisualSmoke);
    if (command === "finalize") {
      const root = workspace(options);
      return withControlTransaction(root, () => requestCommand(options, runFinalize));
    }
    if (command === "ready-for-commit") return requestCommand(options, runReadyForCommit);
    if (command === "closeout") {
      const root = workspace(options);
      return withControlTransaction(root, () => closeout(options));
    }
    if (command === "finish") return finishExecution(options);
    throw new Error("Usage: npx --no-install owlrunkit <bootstrap|init|doctor|adopt|mode|team|hook|assurance|fleet|profiles|project|status|formal|candidate|deployment|core-successor|start|verify|repair|offline-export|offline-import|quick-verify|quick-reuse|quick-runtime-verify|quick-attest|quick-metrics|efficiency|finish|plan|inspect|lease|delivery|coverage-adopt|resume|verify-plan|resource-preflight|snapshot|visual-smoke|finalize|ready-for-commit|closeout> [options]");
  } catch (error) {
    return {
      status: "invalid_input",
      exitCode: 3,
      issues: [error instanceof Error ? error.message : String(error)],
      authorizationGranted: false,
    };
  }
}

if (isDirectExecution(import.meta.url)) {
  const argv = process.argv.slice(2);
  const result = await runCli(argv, {
    onRepairPlan({ plan, planPath, planSha256 }) {
      writeFileSync(
        2,
        `RunKit RepairPlan persisted before replay: ${planPath} sha256:${planSha256}\n${JSON.stringify(plan, null, 2)}\n`,
      );
    },
  });
  const inspectOptions = argv[0] === "inspect" && result.status === "inspected"
    ? parseOptions(argv.slice(1), { boolean: ["json", "compact", "verbose", "history"] })
    : null;
  const humanInspect = inspectOptions !== null && inspectOptions.json !== true;
  const onboardingHumanCommand = new Set(["bootstrap", "init", "doctor", "adopt", "profiles"]).has(argv[0]);
  const interactiveOnboarding = onboardingHumanCommand
    && !argv.includes("--json")
    && process.stdout.isTTY === true;
  process.stdout.write(
    typeof result.humanOutput === "string"
      && (
        result.status === "help"
        || !onboardingHumanCommand
        || interactiveOnboarding
      )
      ? result.humanOutput
      : humanInspect
        ? formatInspectHuman(result)
        : `${JSON.stringify(result)}\n`,
  );
  process.exitCode = result.exitCode;
}
