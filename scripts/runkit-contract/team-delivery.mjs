import { existsSync } from "node:fs";
import path from "node:path";

import {
  decodeUtf8Strict,
  readFileBytesBounded,
} from "../../packages/attest/src/formal.mjs";
import { parseJsonStrict } from "./quick-canonical.mjs";
import {
  normalizeTeamProjectDefinitionV1,
  readTeamProjectStatusV3,
  readTeamProjectStatusV4,
  teamProjectDefinitionBindingV1,
} from "./team-project.mjs";

const AUTHORITY_BOUNDARY = Object.freeze({
  agentDispatch: false,
  git: false,
  release: false,
  deployment: false,
  production: false,
  business: false,
  automation: false,
  money: false,
});

const ACCEPTANCE_LEVELS = new Set(["L0", "L1", "L2", "L3"]);
const SECOND_ORDER_RISKS = new Set(["low", "medium", "high"]);
const JUDGMENT_LEVELS = new Set(["low", "medium", "high"]);
const CONTEXT_DEPTHS = new Set(["local", "cross-module", "product-wide"]);
const SURFACE_WIDTHS = new Set(["narrow", "multi-module", "product-wide"]);
const DETERMINISM_LEVELS = new Set(["deterministic", "mixed", "exploratory"]);
const AUTHORITY_SPANS = new Set(["source-only", "integration", "runtime", "production"]);
const WORKTREE_MODES = new Set(["new_clean_worktree", "existing_dirty_candidate"]);
const ACCEPTANCE_VERDICTS = new Set(["ACCEPT", "REWORK", "BLOCKED"]);
const INDEPENDENCE_STATUSES = new Set([
  "independent",
  "same_family_not_independent",
  "control_tower",
]);
const TRANSFER_LIFECYCLES = new Set([
  "candidate_active",
  "transfer_requested",
  "packet_generated",
  "new_owner_validation",
  "handoff_ack",
  "old_writer_release",
]);

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
const TRANSFER_VERIFICATION_STATUSES = new Set([
  "source_candidate_unverified",
  "source_candidate_verified",
  "accepted",
  "rework_required",
]);
const PACKET_KINDS = new Map([
  ["OwlCodaRunKitTeamTaskPacketV2", "task"],
  ["OwlCodaRunKitTeamAcceptancePacketV2", "acceptance"],
  ["OwlCodaRunKitCandidateTransferPacketV1", "transfer"],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function nullableString(value) {
  return value === null || nonEmptyString(value);
}

function id(value) {
  return nonEmptyString(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function sha256Ref(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function artifactSha256Ref(value) {
  return typeof value === "string" && /^artifact:sha256:[a-f0-9]{64}$/u.test(value);
}

function gitRef(value) {
  return typeof value === "string" && /^git:[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value);
}

function projectTruthHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function absolutePath(value) {
  return nonEmptyString(value)
    && (path.isAbsolute(value) || path.win32.isAbsolute(value));
}

function stringArray(value, { allowEmpty = true } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(nonEmptyString)
    && new Set(value).size === value.length;
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nullableIsoUtc(value) {
  return value === null || (
    typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
  );
}

function sameStringSet(left, right) {
  return stringArray(left)
    && stringArray(right)
    && left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function validAuthorityBoundary(value) {
  return exactKeys(value, Object.keys(AUTHORITY_BOUNDARY))
    && Object.entries(AUTHORITY_BOUNDARY).every(([key, expected]) => value[key] === expected);
}

function commonPacketContractValid(packet, expectedKeys) {
  return exactKeys(packet, expectedKeys)
    && validAuthorityBoundary(packet.authorityBoundary)
    && packet.authorizationGranted === false;
}

function projectBindingValid(value) {
  return exactKeys(value, ["projectId", "projectTruthHash"])
    && id(value.projectId)
    && projectTruthHash(value.projectTruthHash);
}

function actorValid(value) {
  return exactKeys(value, ["executingAgent", "modelFamily", "modelVersion", "role"])
    && id(value.executingAgent)
    && nonEmptyString(value.modelFamily)
    && nonEmptyString(value.modelVersion)
    && nonEmptyString(value.role);
}

function modelIdentityValid(value) {
  return exactKeys(value, ["agent", "modelFamily", "modelVersion"])
    && id(value.agent)
    && nonEmptyString(value.modelFamily)
    && nonEmptyString(value.modelVersion);
}

function taskPacketContractValid(packet) {
  return commonPacketContractValid(packet, [
    "schemaVersion",
    "packetId",
    "projectBinding",
    "gateId",
    "observableSuccess",
    "workItem",
    "actor",
    "risk",
    "acceptance",
    "entry",
    "scope",
    "evidence",
    "verificationCadence",
    "handoff",
    "escalationBudget",
    "stop",
    "authorityBoundary",
    "authorizationGranted",
  ])
    && packet.schemaVersion === "OwlCodaRunKitTeamTaskPacketV2"
    && id(packet.packetId)
    && projectBindingValid(packet.projectBinding)
    && id(packet.gateId)
    && nonEmptyString(packet.observableSuccess)
    && exactKeys(packet.workItem, ["workItemId", "title", "dependencies", "ownedPaths"])
    && id(packet.workItem.workItemId)
    && nonEmptyString(packet.workItem.title)
    && stringArray(packet.workItem.dependencies)
    && stringArray(packet.workItem.ownedPaths, { allowEmpty: false })
    && actorValid(packet.actor)
    && exactKeys(packet.risk, [
      "productJudgment",
      "semanticAmbiguity",
      "contextDepth",
      "surfaceWidth",
      "determinism",
      "secondOrderRisk",
      "authoritySpan",
    ])
    && JUDGMENT_LEVELS.has(packet.risk.productJudgment)
    && JUDGMENT_LEVELS.has(packet.risk.semanticAmbiguity)
    && CONTEXT_DEPTHS.has(packet.risk.contextDepth)
    && SURFACE_WIDTHS.has(packet.risk.surfaceWidth)
    && DETERMINISM_LEVELS.has(packet.risk.determinism)
    && SECOND_ORDER_RISKS.has(packet.risk.secondOrderRisk)
    && AUTHORITY_SPANS.has(packet.risk.authoritySpan)
    && exactKeys(packet.acceptance, [
      "requiredLevel",
      "implementationModelFamily",
      "implementationModelVersion",
      "verificationModelFamily",
      "verificationModelVersion",
      "sameFamilyAllowed",
      "freshAdversarialFamilies",
    ])
    && ACCEPTANCE_LEVELS.has(packet.acceptance.requiredLevel)
    && nonEmptyString(packet.acceptance.implementationModelFamily)
    && nonEmptyString(packet.acceptance.implementationModelVersion)
    && nonEmptyString(packet.acceptance.verificationModelFamily)
    && nonEmptyString(packet.acceptance.verificationModelVersion)
    && typeof packet.acceptance.sameFamilyAllowed === "boolean"
    && stringArray(packet.acceptance.freshAdversarialFamilies)
    && exactKeys(packet.entry, [
      "worktreeMode",
      "worktree",
      "branch",
      "baseSha",
      "candidateIdentity",
      "dirtyStateManifest",
      "soleWriter",
      "upstreamAcceptedPackets",
    ])
    && WORKTREE_MODES.has(packet.entry.worktreeMode)
    && absolutePath(packet.entry.worktree)
    && nonEmptyString(packet.entry.branch)
    && gitRef(packet.entry.baseSha)
    && sha256Ref(packet.entry.candidateIdentity)
    && sha256Ref(packet.entry.dirtyStateManifest)
    && id(packet.entry.soleWriter)
    && stringArray(packet.entry.upstreamAcceptedPackets)
    && exactKeys(packet.scope, [
      "allowedChangedPaths",
      "prohibitedPathsAndActions",
      "protectedArtifactsAndAuthority",
    ])
    && stringArray(packet.scope.allowedChangedPaths, { allowEmpty: false })
    && stringArray(packet.scope.prohibitedPathsAndActions)
    && stringArray(packet.scope.protectedArtifactsAndAuthority)
    && exactKeys(packet.evidence, [
      "positiveEvidence",
      "negativeAndSecondOrderTests",
      "deliveryPacketFields",
    ])
    && stringArray(packet.evidence.positiveEvidence)
    && stringArray(packet.evidence.negativeAndSecondOrderTests)
    && stringArray(packet.evidence.deliveryPacketFields)
    && exactKeys(packet.verificationCadence, [
      "microBatchId",
      "closureHypothesis",
      "includedChanges",
      "implementationSmoke",
      "frozenCandidateFocusedGate",
      "candidateCloseoutChecks",
      "independentAdversarialDelta",
      "deferredTransitionGates",
      "trustedReceipts",
      "receiptInvalidationTriggers",
    ])
    && id(packet.verificationCadence.microBatchId)
    && nonEmptyString(packet.verificationCadence.closureHypothesis)
    && stringArray(packet.verificationCadence.includedChanges)
    && stringArray(packet.verificationCadence.implementationSmoke)
    && stringArray(packet.verificationCadence.frozenCandidateFocusedGate)
    && stringArray(packet.verificationCadence.candidateCloseoutChecks)
    && stringArray(packet.verificationCadence.independentAdversarialDelta)
    && stringArray(packet.verificationCadence.deferredTransitionGates)
    && stringArray(packet.verificationCadence.trustedReceipts)
    && stringArray(packet.verificationCadence.receiptInvalidationTriggers)
    && exactKeys(packet.handoff, ["required", "nextOwner"])
    && typeof packet.handoff.required === "boolean"
    && nullableString(packet.handoff.nextOwner)
    && (!packet.handoff.required || id(packet.handoff.nextOwner))
    && exactKeys(packet.escalationBudget, [
      "implementationAttempts",
      "narrowRework",
      "harnessFailure",
      "controllerIntervention",
      "semanticEscape",
    ])
    && nonnegativeInteger(packet.escalationBudget.implementationAttempts)
    && packet.escalationBudget.implementationAttempts > 0
    && nonnegativeInteger(packet.escalationBudget.narrowRework)
    && nonnegativeInteger(packet.escalationBudget.harnessFailure)
    && nonnegativeInteger(packet.escalationBudget.controllerIntervention)
    && packet.escalationBudget.semanticEscape === 0
    && exactKeys(packet.stop, ["exactStopPoint", "nextGateProhibited"])
    && nonEmptyString(packet.stop.exactStopPoint)
    && nullableString(packet.stop.nextGateProhibited);
}

function findingValid(value) {
  return exactKeys(value, ["severity", "code", "message", "evidenceRefs"])
    && new Set(["critical", "important", "minor", "note"]).has(value.severity)
    && id(value.code)
    && nonEmptyString(value.message)
    && stringArray(value.evidenceRefs);
}

function acceptancePacketContractValid(packet) {
  return commonPacketContractValid(packet, [
    "schemaVersion",
    "packetId",
    "projectBinding",
    "gateId",
    "workItemId",
    "candidateId",
    "taskPacketSha256",
    "implementation",
    "verification",
    "secondOrderRisk",
    "independenceStatus",
    "acceptanceLevel",
    "candidateIdentityBefore",
    "candidateIdentityAfter",
    "freshAdversarialFamilies",
    "coverageLedger",
    "protectedArtifactReadback",
    "productionWriteCount",
    "findings",
    "verdict",
    "allowedNextGate",
    "remainingAcceptanceLevels",
    "authorityBoundary",
    "authorizationGranted",
  ])
    && packet.schemaVersion === "OwlCodaRunKitTeamAcceptancePacketV2"
    && id(packet.packetId)
    && projectBindingValid(packet.projectBinding)
    && id(packet.gateId)
    && id(packet.workItemId)
    && id(packet.candidateId)
    && sha256Ref(packet.taskPacketSha256)
    && modelIdentityValid(packet.implementation)
    && modelIdentityValid(packet.verification)
    && SECOND_ORDER_RISKS.has(packet.secondOrderRisk)
    && INDEPENDENCE_STATUSES.has(packet.independenceStatus)
    && ACCEPTANCE_LEVELS.has(packet.acceptanceLevel)
    && sha256Ref(packet.candidateIdentityBefore)
    && sha256Ref(packet.candidateIdentityAfter)
    && stringArray(packet.freshAdversarialFamilies)
    && exactKeys(packet.coverageLedger, [
      "evidenceReused",
      "checksRunFresh",
      "coveredChecksNotRepeated",
      "receiptInvalidations",
      "deferredTransitionGates",
    ])
    && stringArray(packet.coverageLedger.evidenceReused)
    && stringArray(packet.coverageLedger.checksRunFresh)
    && stringArray(packet.coverageLedger.coveredChecksNotRepeated)
    && stringArray(packet.coverageLedger.receiptInvalidations)
    && stringArray(packet.coverageLedger.deferredTransitionGates)
    && stringArray(packet.protectedArtifactReadback)
    && nonnegativeInteger(packet.productionWriteCount)
    && Array.isArray(packet.findings)
    && packet.findings.every(findingValid)
    && ACCEPTANCE_VERDICTS.has(packet.verdict)
    && nullableString(packet.allowedNextGate)
    && stringArray(packet.remainingAcceptanceLevels)
    && packet.remainingAcceptanceLevels.every(level => ACCEPTANCE_LEVELS.has(level));
}

function handoffAckValid(value) {
  return exactKeys(value, ["status", "agent", "occurredAt", "evidenceRefs"])
    && new Set(["pending", "accepted", "rejected"]).has(value.status)
    && (value.agent === null || id(value.agent))
    && nullableIsoUtc(value.occurredAt)
    && stringArray(value.evidenceRefs)
    && (value.status === "pending"
      ? value.agent === null && value.occurredAt === null && value.evidenceRefs.length === 0
      : value.agent !== null && value.occurredAt !== null);
}

function transferPacketContractValid(packet) {
  return commonPacketContractValid(packet, [
    "schemaVersion",
    "packetId",
    "projectBinding",
    "gateId",
    "workItemId",
    "candidateId",
    "candidateSha256",
    "baseSha",
    "head",
    "branch",
    "worktree",
    "dirtyManifestSha256",
    "patchBundleRef",
    "snapshotRef",
    "reconstructionRefs",
    "protectedArtifacts",
    "previousOwner",
    "nextOwner",
    "lifecycle",
    "handoffAck",
    "verificationStatus",
    "authorityBoundary",
    "authorizationGranted",
  ])
    && packet.schemaVersion === "OwlCodaRunKitCandidateTransferPacketV1"
    && id(packet.packetId)
    && projectBindingValid(packet.projectBinding)
    && id(packet.gateId)
    && id(packet.workItemId)
    && id(packet.candidateId)
    && sha256Ref(packet.candidateSha256)
    && gitRef(packet.baseSha)
    && gitRef(packet.head)
    && nonEmptyString(packet.branch)
    && absolutePath(packet.worktree)
    && sha256Ref(packet.dirtyManifestSha256)
    && (packet.patchBundleRef === null || artifactSha256Ref(packet.patchBundleRef))
    && artifactSha256Ref(packet.snapshotRef)
    && stringArray(packet.reconstructionRefs, { allowEmpty: false })
    && stringArray(packet.protectedArtifacts)
    && id(packet.previousOwner)
    && id(packet.nextOwner)
    && packet.previousOwner !== packet.nextOwner
    && TRANSFER_LIFECYCLES.has(packet.lifecycle)
    && handoffAckValid(packet.handoffAck)
    && TRANSFER_VERIFICATION_STATUSES.has(packet.verificationStatus);
}

function pathPrefix(value) {
  return value.endsWith("/**") ? value.slice(0, -3) : null;
}

function pathCovers(owner, candidate) {
  if (owner === candidate) return true;
  const prefix = pathPrefix(owner);
  if (prefix === null) return false;
  const candidatePrefix = pathPrefix(candidate) ?? candidate;
  return candidatePrefix === prefix || candidatePrefix.startsWith(`${prefix}/`);
}

function conflictsBetween(left, right) {
  const conflicts = [];
  for (const leftPath of left.ownedPaths) {
    for (const rightPath of right.ownedPaths) {
      if (pathCovers(leftPath, rightPath) || pathCovers(rightPath, leftPath)) {
        conflicts.push({
          leftWorkItemId: left.workItemId,
          leftPath,
          rightWorkItemId: right.workItemId,
          rightPath,
        });
      }
    }
  }
  return conflicts;
}

function projectDefinitionPath(root) {
  return path.join(path.resolve(root), ".owlcoda/runkit/project/definition.json");
}

function currentProjectStatus(workspaceRoot) {
  if (!existsSync(projectDefinitionPath(workspaceRoot))) return null;
  return readTeamProjectStatusV3({ workspaceRoot });
}

function currentProjectStatusV2(workspaceRoot) {
  if (!existsSync(projectDefinitionPath(workspaceRoot))) return null;
  return readTeamProjectStatusV4({ workspaceRoot });
}

function readProjectDefinition(workspaceRoot) {
  const { bytes } = readFileBytesBounded(projectDefinitionPath(workspaceRoot));
  return normalizeTeamProjectDefinitionV1(parseJsonStrict(decodeUtf8Strict(bytes)));
}

function laneProjection(project) {
  if (project === null) return [];
  const ready = new Set(project.readyQueue);
  return project.workItems
    .filter(workItem => workItem.status !== "completed")
    .map(workItem => {
      const actionable = ready.has(workItem.workItemId)
        || new Set([
          "active",
          "waiting_decision",
          "verifying",
          "ready_to_integrate",
          "failed",
        ]).has(workItem.status);
      const coordinationFacts = [
        ...(workItem.pendingHandoff ? ["pending_handoff"] : []),
        ...(workItem.rework ? ["rework_active"] : []),
        ...(workItem.latestSourceDelivery ? ["source_delivery_present"] : []),
        ...(workItem.status === "verifying" ? ["independent_verification"] : []),
      ];
      return {
        workItemId: workItem.workItemId,
        title: workItem.title,
        status: workItem.status,
        agentId: workItem.agentId,
        dependencies: [...workItem.dependencies],
        unresolvedDependencies: [...workItem.unresolvedDependencies],
        ownedPaths: [...workItem.ownedPaths],
        actionable,
        parallelEligible: false,
        coordinationFacts,
      };
    });
}

function deriveProjection(project) {
  const lanes = laneProjection(project);
  const actionable = lanes.filter(lane => lane.actionable);
  const pathConflicts = [];
  for (let left = 0; left < actionable.length; left += 1) {
    for (let right = left + 1; right < actionable.length; right += 1) {
      pathConflicts.push(...conflictsBetween(actionable[left], actionable[right]));
    }
  }
  const conflicted = new Set(pathConflicts.flatMap(conflict => [
    conflict.leftWorkItemId,
    conflict.rightWorkItemId,
  ]));
  for (const lane of lanes) {
    lane.parallelEligible = actionable.length > 1
      && lane.actionable
      && !conflicted.has(lane.workItemId);
  }
  const acceptanceGaps = lanes
    .filter(lane => lane.status === "verifying")
    .map(lane => ({
      workItemId: lane.workItemId,
      code: "verification_model_family_unbound",
      message: "Project Driver requires a different verifier Agent; model-family independence remains packet-bound.",
    }));
  const ownerTransitions = lanes
    .filter(lane => lane.coordinationFacts.length > 0)
    .map(lane => ({
      workItemId: lane.workItemId,
      facts: [...lane.coordinationFacts],
    }));
  return { lanes, actionable, pathConflicts, acceptanceGaps, ownerTransitions };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function explicitCandidateInventory(project) {
  if (project === null) return [];
  return [
    ...project.dataCandidates.map(candidate => ({
      laneId: `data-candidate:${candidate.candidateId}`,
      kind: "data_candidate",
      artifactId: candidate.candidateId,
      status: candidate.admissionStatus,
      sourceRef: candidate.sourceRef,
      actionable: candidate.admissionStatus !== "eligible_candidate",
      modeledWorkItemId: null,
      truthRefs: [...candidate.truthRefs],
    })),
    ...project.externalGates.map(gate => ({
      laneId: `external-gate:${gate.gateId}`,
      kind: "external_gate",
      artifactId: gate.gateId,
      status: gate.gateStatus,
      sourceRef: gate.source.ref,
      actionable: gate.blocking,
      modeledWorkItemId: null,
      truthRefs: [...gate.truthRefs],
    })),
  ].sort((left, right) => compareCodeUnits(left.laneId, right.laneId));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function recommendationFromProject(project, workspaceRoot) {
  const projection = deriveProjection(project);
  const activeOwners = uniqueSorted(projection.actionable
    .map(lane => lane.agentId)
    .filter(value => value !== null));
  const reasonCodes = [];
  if (project === null) {
    reasonCodes.push("project_driver_not_initialized");
  } else if (projection.actionable.length === 0) {
    reasonCodes.push("no_actionable_work_items");
  } else if (projection.actionable.length === 1) {
    reasonCodes.push("single_actionable_work_item");
  }
  if (projection.pathConflicts.length > 0) {
    reasonCodes.push("owned_path_conflict_requires_coordination");
  } else if (projection.actionable.length > 1) {
    reasonCodes.push("multiple_independent_actionable_work_items");
  }
  if (activeOwners.length > 1) reasonCodes.push("multiple_active_owners");
  if (projection.acceptanceGaps.length > 0) reasonCodes.push("independent_acceptance_lane");
  if (projection.ownerTransitions.length > 0) reasonCodes.push("candidate_owner_transition");

  const teamRecommended = projection.actionable.length > 1
    || projection.pathConflicts.length > 0
    || activeOwners.length > 1
    || projection.acceptanceGaps.length > 0
    || projection.ownerTransitions.length > 0;
  const hasUnassignedActionable = projection.actionable.some(
    lane => lane.agentId === null,
  );
  const nextCommand = projection.pathConflicts.length > 0
    ? "npx --no-install owlrunkit project work-item revise-scope --help"
    : teamRecommended && hasUnassignedActionable
      ? "npx --no-install owlrunkit project assign --help"
      : teamRecommended && projection.ownerTransitions.length > 0
        ? "npx --no-install owlrunkit project takeover --help"
        : teamRecommended
          ? "npx --no-install owlrunkit team packet validate --help"
      : project === null
        ? null
        : `npx --no-install owlrunkit project status --workspace ${shellQuote(workspaceRoot)}`;

  return {
    schemaVersion: "OwlCodaRunKitTeamRecommendationV1",
    status: "team_delivery_recommended",
    project: project === null
      ? { present: false, projectId: null, projectTruthHash: null, overall: null }
      : {
          present: true,
          projectId: project.projectId,
          projectTruthHash: project.projectTruthHash,
          overall: project.overall,
        },
    recommendedMode: teamRecommended ? "team" : "off",
    continuity: project === null ? "none" : "project_driver",
    coordination: teamRecommended ? "project_driver_team" : "none",
    assurance: {
      changed: false,
      selection: "unchanged",
      reason: "team_delivery_does_not_select_assurance",
    },
    reasonCodes: uniqueSorted(reasonCodes),
    rejectedLighterModes: teamRecommended
      ? [{ mode: "off", reasonCodes: uniqueSorted(reasonCodes) }]
      : [],
    lanes: projection.lanes,
    pathConflicts: projection.pathConflicts,
    acceptanceGaps: projection.acceptanceGaps,
    ownerTransitions: projection.ownerTransitions,
    estimatedOverhead: {
      additionalOperatorSteps: teamRecommended ? 1 : 0,
      potentialPortablePackets: teamRecommended ? projection.actionable.length : 0,
    },
    nextCommand,
    dispatch: {
      mode: "none",
      permitted: false,
      nextCommand: null,
    },
    authorityBoundary: { ...AUTHORITY_BOUNDARY },
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function recommendTeamDeliveryV1({ workspaceRoot } = {}) {
  if (!nonEmptyString(workspaceRoot)) throw new Error("workspaceRoot is required.");
  return recommendationFromProject(currentProjectStatus(workspaceRoot), workspaceRoot);
}

export function recommendTeamDeliveryV2(input = {}) {
  const legacy = recommendTeamDeliveryV1(input);
  const { recommendedMode, ...rest } = legacy;
  return {
    ...rest,
    schemaVersion: "OwlCodaRunKitTeamRecommendationV2",
    teamCoordinationMode: recommendedMode,
  };
}

function teamDeliveryStatusFromProject(project, workspaceRoot) {
  const recommendation = recommendationFromProject(project, workspaceRoot);
  return {
    schemaVersion: "OwlCodaRunKitTeamDeliveryStatusV1",
    status: "team_delivery_status",
    graphSource: "project_driver",
    persistedTeamGraph: false,
    projectId: project?.projectId ?? null,
    projectTruthHash: project?.projectTruthHash ?? null,
    projectOverall: project?.overall ?? "not_initialized",
    recommendation: {
      recommendedMode: recommendation.recommendedMode,
      coordination: recommendation.coordination,
      reasonCodes: recommendation.reasonCodes,
    },
    lanes: recommendation.lanes,
    pathConflicts: recommendation.pathConflicts,
    acceptanceGaps: recommendation.acceptanceGaps,
    ownerTransitions: recommendation.ownerTransitions,
    nextAction: recommendation.nextCommand,
    dispatch: { ...recommendation.dispatch },
    authorityBoundary: { ...AUTHORITY_BOUNDARY },
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function readTeamDeliveryStatusV1({ workspaceRoot } = {}) {
  if (!nonEmptyString(workspaceRoot)) throw new Error("workspaceRoot is required.");
  return teamDeliveryStatusFromProject(currentProjectStatus(workspaceRoot), workspaceRoot);
}

function enrichedProjectWarnings(project) {
  return (project?.warnings ?? []).map((warning) => {
    const workItem = project.workItems.find(row => row.workItemId === warning.workItemId);
    const completed = workItem?.status === "completed";
    return {
      ...warning,
      severity: "warning",
      blocking: false,
      requiredAtGate: false,
      recommendedAction: completed
        ? "no_retroactive_action_required"
        : "bind_quick_or_formal_receipt_if_reusable_evidence_is_required",
    };
  });
}

function aggregateWarningSummary(warnings) {
  const groups = new Map();
  for (const warning of warnings) {
    const current = groups.get(warning.code) ?? {
      code: warning.code,
      severity: warning.severity,
      blocking: warning.blocking,
      count: 0,
      workItemIds: [],
      requiredAtGate: warning.requiredAtGate,
      recommendedAction: warning.recommendedAction,
    };
    current.count += 1;
    current.workItemIds.push(warning.workItemId);
    if (current.recommendedAction !== warning.recommendedAction) {
      current.recommendedAction = "review_individual_warning_actions";
    }
    groups.set(warning.code, current);
  }
  return {
    count: warnings.length,
    groups: [...groups.values()]
      .map(group => ({ ...group, workItemIds: uniqueSorted(group.workItemIds) }))
      .sort((left, right) => compareCodeUnits(left.code, right.code)),
  };
}

export function readTeamDeliveryStatusV2({ workspaceRoot } = {}) {
  if (!nonEmptyString(workspaceRoot)) throw new Error("workspaceRoot is required.");
  const project = currentProjectStatusV2(workspaceRoot);
  const legacy = teamDeliveryStatusFromProject(project, workspaceRoot);
  const warnings = enrichedProjectWarnings(project);
  return {
    ...legacy,
    schemaVersion: "OwlCodaRunKitTeamDeliveryStatusV2",
    externalGates: project?.externalGates ?? [],
    deliveryLifecycle: project?.deliveryLifecycle ?? null,
    unmodeledCandidateLanes: explicitCandidateInventory(project),
    nextAction: project?.nextAction ?? legacy.nextAction,
    warnings,
    warningSummary: aggregateWarningSummary(warnings),
  };
}

export function readTeamDeliveryStatusV3({ workspaceRoot } = {}) {
  const legacy = readTeamDeliveryStatusV2({ workspaceRoot });
  const warnings = legacy.warnings.map(warning => (
    warning.code === "no_bound_verification_receipt"
      ? { ...warning, severity: "advisory" }
      : warning
  ));
  const actionableWarnings = warnings.filter(warning => warning.severity !== "advisory");
  const advisories = warnings.filter(warning => warning.severity === "advisory");
  return {
    ...legacy,
    schemaVersion: "OwlCodaRunKitTeamDeliveryStatusV3",
    recommendation: {
      teamCoordinationMode: legacy.recommendation.recommendedMode,
      coordination: legacy.recommendation.coordination,
      reasonCodes: [...legacy.recommendation.reasonCodes],
    },
    warnings,
    warningSummary: aggregateWarningSummary(actionableWarnings),
    advisorySummary: aggregateWarningSummary(advisories),
  };
}

function bindPacketToProject(packet, project, definition, issueCodes) {
  if (!projectBindingValid(packet.projectBinding)) return;
  if (project === null) {
    issueCodes.push("packet_project_not_initialized");
    return;
  }
  if (packet.projectBinding.projectId !== project.projectId) {
    issueCodes.push("packet_project_id_mismatch");
  }
  if (packet.projectBinding.projectTruthHash !== project.projectTruthHash) {
    issueCodes.push("packet_project_truth_mismatch");
  }
  const gate = id(packet.gateId)
    ? definition.integrationGates.find(row => row.id === packet.gateId) ?? null
    : null;
  if (id(packet.gateId) && gate === null) {
    issueCodes.push("packet_gate_unknown");
  }
  const workItemId = packet.schemaVersion === "OwlCodaRunKitTeamTaskPacketV2"
    ? packet.workItem?.workItemId
    : packet.workItemId;
  const current = project.workItems.find(workItem => workItem.workItemId === workItemId);
  if (!current) {
    issueCodes.push("packet_work_item_unknown");
    return;
  }
  if (gate !== null && !gate.requiredWorkItemIds.includes(workItemId)) {
    issueCodes.push("packet_gate_work_item_mismatch");
  }
  if (packet.schemaVersion === "OwlCodaRunKitTeamTaskPacketV2") {
    if (packet.workItem.title !== current.title
      || !sameStringSet(packet.workItem.dependencies, current.dependencies)) {
      issueCodes.push("packet_work_item_truth_mismatch");
    }
    if (!sameStringSet(packet.workItem.ownedPaths, current.ownedPaths)
      || !sameStringSet(packet.scope.allowedChangedPaths, current.ownedPaths)) {
      issueCodes.push("packet_owned_paths_mismatch");
    }
  }
}

export function validateTeamPacketV1({ workspaceRoot, packet } = {}) {
  if (!nonEmptyString(workspaceRoot)) throw new Error("workspaceRoot is required.");
  const kind = PACKET_KINDS.get(packet?.schemaVersion) ?? "unknown";
  const contractValid = kind === "task"
    ? taskPacketContractValid(packet)
    : kind === "acceptance"
      ? acceptancePacketContractValid(packet)
      : kind === "transfer"
        ? transferPacketContractValid(packet)
        : false;
  const issueCodes = [];
  if (!contractValid) issueCodes.push("packet_contract_invalid");
  if (contractValid) {
    if (!existsSync(projectDefinitionPath(workspaceRoot))) {
      bindPacketToProject(packet, null, null, issueCodes);
    } else {
      const definitionBefore = readProjectDefinition(workspaceRoot);
      const projectBefore = currentProjectStatus(workspaceRoot);
      const projectAfter = currentProjectStatus(workspaceRoot);
      const definitionAfter = readProjectDefinition(workspaceRoot);
      if (teamProjectDefinitionBindingV1(definitionBefore).projectDefinitionSha256
          !== teamProjectDefinitionBindingV1(definitionAfter).projectDefinitionSha256
        || projectBefore.projectTruthHash !== projectAfter.projectTruthHash) {
        issueCodes.push("packet_project_truth_changed_during_validation");
      } else {
        bindPacketToProject(packet, projectAfter, definitionAfter, issueCodes);
      }
    }
    if (kind === "task"
      && new Set(["medium", "high"]).has(packet.risk.secondOrderRisk)
      && packet.acceptance.sameFamilyAllowed) {
      issueCodes.push("same_family_acceptance_forbidden_for_risk");
    }
    if (kind === "task") {
      if (packet.actor.executingAgent !== packet.entry.soleWriter) {
        issueCodes.push("task_sole_writer_mismatch");
      }
      if (packet.actor.modelFamily !== packet.acceptance.implementationModelFamily
        || packet.actor.modelVersion !== packet.acceptance.implementationModelVersion) {
        issueCodes.push("task_implementation_identity_mismatch");
      }
      if (new Set(["medium", "high"]).has(packet.risk.secondOrderRisk)
        && packet.actor.modelFamily === packet.acceptance.verificationModelFamily) {
        issueCodes.push("planned_acceptance_same_model_family");
      }
    }
    if (kind === "acceptance") {
      const requiresIndependence = new Set(["medium", "high"]).has(packet.secondOrderRisk);
      if (requiresIndependence
        && packet.independenceStatus === "independent"
        && packet.implementation.modelFamily === packet.verification.modelFamily) {
        issueCodes.push("independent_acceptance_same_model_family");
      }
      if (requiresIndependence
        && packet.independenceStatus === "independent"
        && packet.implementation.agent === packet.verification.agent) {
        issueCodes.push("independent_acceptance_same_agent");
      }
      if (packet.independenceStatus === "independent"
        && packet.implementation.modelFamily === packet.verification.modelFamily) {
        issueCodes.push("independence_status_inconsistent");
      }
      if (packet.independenceStatus === "same_family_not_independent"
        && packet.implementation.modelFamily !== packet.verification.modelFamily) {
        issueCodes.push("independence_status_inconsistent");
      }
      if (requiresIndependence
        && packet.verdict === "ACCEPT"
        && (
          packet.implementation.modelFamily === packet.verification.modelFamily
          || packet.implementation.agent === packet.verification.agent
        )) {
        issueCodes.push("accepted_packet_requires_independent_verifier");
      }
      if (packet.verdict === "ACCEPT"
        && packet.candidateIdentityBefore !== packet.candidateIdentityAfter) {
        issueCodes.push("accepted_candidate_identity_drift");
      }
      if (packet.verdict === "ACCEPT"
        && packet.acceptanceLevel !== "L0"
        && (
          packet.freshAdversarialFamilies.length === 0
          || packet.coverageLedger.checksRunFresh.length === 0
        )) {
        issueCodes.push("accepted_packet_requires_fresh_adversarial_evidence");
      }
    }
    if (kind === "transfer") {
      if (packet.handoffAck.status === "accepted"
        && (
          packet.handoffAck.agent !== packet.nextOwner
          || packet.handoffAck.evidenceRefs.length === 0
        )) {
        issueCodes.push("accepted_handoff_ack_invalid");
      }
      if (packet.lifecycle === "old_writer_release"
        && (
          packet.handoffAck.status !== "accepted"
          || packet.handoffAck.agent !== packet.nextOwner
          || packet.handoffAck.evidenceRefs.length === 0
        )) {
        issueCodes.push("old_writer_release_requires_accepted_handoff_ack");
      }
      if (packet.lifecycle === "handoff_ack"
        && (
          packet.handoffAck.status !== "accepted"
          || packet.handoffAck.agent !== packet.nextOwner
          || packet.handoffAck.evidenceRefs.length === 0
        )) {
        issueCodes.push("handoff_ack_lifecycle_requires_accepted_ack");
      }
    }
  }
  const uniqueIssues = uniqueSorted(issueCodes);
  return {
    schemaVersion: "OwlCodaRunKitTeamPacketValidationV1",
    status: uniqueIssues.length === 0 ? "team_packet_valid" : "team_packet_invalid",
    packetKind: kind,
    packetSchemaVersion: packet?.schemaVersion ?? null,
    issueCodes: uniqueIssues,
    authorityBoundary: { ...AUTHORITY_BOUNDARY },
    authorizationGranted: false,
    exitCode: uniqueIssues.length === 0 ? 0 : 2,
  };
}

export function validateTeamPacketFileV1({ workspaceRoot, packetPath } = {}) {
  if (!nonEmptyString(packetPath)) throw new Error("packetPath is required.");
  try {
    const { bytes } = readFileBytesBounded(packetPath);
    const packet = parseJsonStrict(decodeUtf8Strict(bytes));
    return validateTeamPacketV1({ workspaceRoot, packet });
  } catch (error) {
    const duplicate = error?.code === "receipt_duplicate_key"
      || error?.code === "DUPLICATE_OBJECT_KEY";
    return {
      schemaVersion: "OwlCodaRunKitTeamPacketValidationV1",
      status: "team_packet_invalid",
      packetKind: "unknown",
      packetSchemaVersion: null,
      issueCodes: [duplicate ? "packet_duplicate_object_key" : "packet_unreadable"],
      authorityBoundary: { ...AUTHORITY_BOUNDARY },
      authorizationGranted: false,
      exitCode: 2,
    };
  }
}

export function formatTeamDeliveryRecommendationHumanV1(result) {
  return [
    `Recommended Team mode: ${result.recommendedMode}`,
    `Continuity: ${result.continuity}`,
    `Coordination: ${result.coordination}`,
    `Why: ${result.reasonCodes.join(", ") || "none"}`,
    `Lanes: ${result.lanes.length}`,
    `Path conflicts: ${result.pathConflicts.length}`,
    `Acceptance gaps: ${result.acceptanceGaps.length}`,
    `Next: ${result.nextCommand ?? "none"}`,
    "Agent dispatch: not permitted.",
    "Authority: no Git, release, deployment, production, business, automation, or money authorization granted.",
    "",
  ].join("\n");
}

export function formatTeamDeliveryRecommendationHumanV2(result) {
  return [
    `Team coordination: ${result.teamCoordinationMode}`,
    `Continuity: ${result.continuity}`,
    `Coordination: ${result.coordination}`,
    `Why: ${result.reasonCodes.join(", ") || "none"}`,
    `Lanes: ${result.lanes.length}`,
    `Path conflicts: ${result.pathConflicts.length}`,
    `Acceptance gaps: ${result.acceptanceGaps.length}`,
    `Next: ${result.nextCommand ?? "none"}`,
    "Agent dispatch: not permitted.",
    "Authority: no Git, release, deployment, production, business, automation, or money authorization granted.",
    "",
  ].join("\n");
}

export function formatTeamDeliveryStatusHumanV1(result) {
  return [
    `Team Delivery: ${result.recommendation.recommendedMode}`,
    `Project: ${result.projectId ?? "not initialized"}`,
    `Project state: ${result.projectOverall}`,
    `Graph source: ${result.graphSource}`,
    `Persisted team graph: ${result.persistedTeamGraph ? "yes" : "no"}`,
    `Lanes: ${result.lanes.length}`,
    `Path conflicts: ${result.pathConflicts.length}`,
    `Acceptance gaps: ${result.acceptanceGaps.length}`,
    ...(result.warningSummary?.count > 0
      ? [`Warnings: ${result.warningSummary.count} non-blocking (${result.warningSummary.groups.map(group => `${group.code}:${group.count}`).join(", ")})`]
      : []),
    `Next: ${result.nextAction ?? "none"}`,
    "Agent dispatch: not permitted.",
    "Authority: not granted.",
    "",
  ].join("\n");
}

export function formatTeamDeliveryStatusHumanV2(result) {
  return [
    `Team Delivery: ${result.recommendation.recommendedMode}`,
    `Project: ${result.projectId ?? "not initialized"}`,
    `Project state: ${result.projectOverall}`,
    `Graph source: ${result.graphSource}`,
    `Persisted team graph: ${result.persistedTeamGraph ? "yes" : "no"}`,
    `Lanes: ${result.lanes.length}`,
    `Path conflicts: ${result.pathConflicts.length}`,
    `Acceptance gaps: ${result.acceptanceGaps.length}`,
    `External Gates: ${result.externalGates.length}`,
    `Unmodeled candidate lanes: ${result.unmodeledCandidateLanes.length}`,
    `Delivery: ${result.deliveryLifecycle?.currentStage ?? "not initialized"}`,
    ...(result.warningSummary?.count > 0
      ? [`Warnings: ${result.warningSummary.count} non-blocking (${result.warningSummary.groups.map(group => `${group.code}:${group.count}`).join(", ")})`]
      : []),
    `Next: ${result.nextAction ?? "none"}`,
    "Agent dispatch: not permitted.",
    "Authority: not granted.",
    "",
  ].join("\n");
}

export function formatTeamDeliveryStatusHumanV3(result) {
  return [
    `Team coordination: ${result.recommendation.teamCoordinationMode}`,
    `Project: ${result.projectId ?? "not initialized"}`,
    `Project state: ${result.projectOverall}`,
    `Graph source: ${result.graphSource}`,
    `Persisted team graph: ${result.persistedTeamGraph ? "yes" : "no"}`,
    `Lanes: ${result.lanes.length}`,
    `Path conflicts: ${result.pathConflicts.length}`,
    `Acceptance gaps: ${result.acceptanceGaps.length}`,
    `External Gates: ${result.externalGates.length}`,
    `Unmodeled candidate lanes: ${result.unmodeledCandidateLanes.length}`,
    `Delivery: ${result.deliveryLifecycle?.currentStage ?? "not initialized"}`,
    ...(result.warningSummary.count > 0
      ? [`Warnings: ${result.warningSummary.count} (${result.warningSummary.groups.map(group => `${group.code}:${group.count}`).join(", ")})`]
      : []),
    ...(result.advisorySummary.count > 0
      ? [`Advisories: ${result.advisorySummary.count} (${result.advisorySummary.groups.map(group => `${group.code}:${group.count}`).join(", ")})`]
      : []),
    `Next: ${result.nextAction ?? "none"}`,
    "Agent dispatch: not permitted.",
    "Authority: not granted.",
    "",
  ].join("\n");
}

export function formatTeamPacketValidationHumanV1(result) {
  return [
    `Team packet: ${result.status}`,
    `Kind: ${result.packetKind}`,
    `Schema: ${result.packetSchemaVersion ?? "unknown"}`,
    `Issues: ${result.issueCodes.join(", ") || "none"}`,
    "Agent dispatch: not permitted.",
    "Authority: not granted.",
    "",
  ].join("\n");
}
