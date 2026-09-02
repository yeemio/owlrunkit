import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import { validateLeaseOwnedPaths } from "./core-contract.mjs";
import { inspectProjectControlState } from "./project-control-state.mjs";
import { canonicalSourceFingerprint } from "./source-fingerprint.mjs";
import {
  quickSnapshotFingerprintValid,
  validWorkspaceSnapshotShape,
} from "../../packages/attest/src/quick-receipt-contract.mjs";
import { readFileBytesBounded } from "../../packages/attest/src/formal.mjs";
import { attestCoreBoundQuickReceiptDetailsFromBytes } from "./quick-attest.mjs";
import {
  assertAllowedKeys,
  isRecord,
  relativeToWorkspace,
  safeIdentifier,
  writeJsonExclusiveAtomically,
} from "./provenance-common.mjs";

const PROJECT_ROOT = ".owlcoda/runkit/project";
const DEFINITION_SCHEMA = "OwlCodaRunKitTeamProjectDefinitionV1";
const EVENT_SCHEMA = "OwlCodaRunKitTeamProjectEventV1";
const EVENT_SCHEMA_V2 = "OwlCodaRunKitTeamProjectEventV2";
const EVENT_SCHEMA_V3 = "OwlCodaRunKitTeamProjectEventV3";
const EVENT_SCHEMA_V4 = "OwlCodaRunKitTeamProjectEventV4";
const EVENT_SCHEMA_V5 = "OwlCodaRunKitTeamProjectEventV5";
const EVENT_SCHEMA_V6 = "OwlCodaRunKitTeamProjectEventV6";
const EVENT_SCHEMA_V7 = "OwlCodaRunKitTeamProjectEventV7";
const STATUS_SCHEMA_V1 = "OwlCodaRunKitTeamProjectStatusV1";
const STATUS_SCHEMA_V2 = "OwlCodaRunKitTeamProjectStatusV2";
const STATUS_SCHEMA_V3 = "OwlCodaRunKitTeamProjectStatusV3";
const STATUS_SCHEMA_V4 = "OwlCodaRunKitTeamProjectStatusV4";

const DEFINITION_KEYS = [
  "schemaVersion",
  "projectId",
  "objective",
  "milestones",
  "workstreams",
  "workItems",
  "integrationGates",
];
const WORK_ITEM_STATES = new Set([
  "active",
  "waiting_dependency",
  "waiting_decision",
  "verifying",
  "ready_to_integrate",
  "completed",
  "failed",
]);
const VERIFICATION_DISPOSITIONS = new Set(["verified", "no_longer_required"]);
const DELIVERY_STAGES = Object.freeze([
  "source",
  "integration",
  "materialization",
  "deployment",
  "live_readback",
  "product_acceptance",
]);
const DELIVERY_STAGE_OUTCOMES = Object.freeze({
  source: new Set(["accepted", "rejected"]),
  integration: new Set(["integrated", "rejected"]),
  materialization: new Set(["materialized", "failed"]),
  deployment: new Set(["deployed", "failed", "rolled_back"]),
  live_readback: new Set(["passed", "failed"]),
  product_acceptance: new Set(["accepted", "rejected", "deferred"]),
});
const DELIVERY_POSITIVE_OUTCOME = Object.freeze({
  source: "accepted",
  integration: "integrated",
  materialization: "materialized",
  deployment: "deployed",
  live_readback: "passed",
  product_acceptance: "accepted",
});
const EXTERNAL_GATE_STATUSES = new Set(["pending", "passed", "blocked", "deferred"]);
const EVENT_KEYS = Object.freeze({
  agent_assigned: [
    "schemaVersion", "eventId", "type", "occurredAt", "assignmentId",
    "supersedesAssignmentId", "workItemId", "agentId", "executionRunId",
    "executionWorkItemId",
  ],
  checkpoint_recorded: [
    "schemaVersion", "eventId", "type", "occurredAt", "assignmentId",
    "workItemId", "state", "summary", "completedUnits", "evidenceRefs",
    "blockerRefs", "decisionRefs", "nextAction", "sourceFingerprint",
  ],
  handoff_recorded: [
    "schemaVersion", "eventId", "type", "occurredAt", "assignmentId",
    "workItemId", "fromAgentId", "toAgentId", "summary", "evidenceRefs",
    "nextAction",
  ],
  rework_returned: [
    "schemaVersion", "eventId", "type", "occurredAt", "reworkId",
    "assignmentId", "failedAssignmentId", "failedCheckpointEventId",
    "workItemId", "fromAgentId", "reviewerAgentId", "toAgentId", "reason",
    "evidenceRefs", "nextAction",
  ],
  decision_opened: [
    "schemaVersion", "eventId", "type", "occurredAt", "decisionId",
    "title", "question", "ownerAgentId", "blockingWorkItemIds", "options",
  ],
  decision_resolved: [
    "schemaVersion", "eventId", "type", "occurredAt", "decisionId",
    "resolution", "rationale", "evidenceRefs",
  ],
  integration_gate_passed: [
    "schemaVersion", "eventId", "type", "occurredAt", "gateId", "summary",
    "evidenceRefs",
  ],
  verification_deferred: [
    "schemaVersion", "eventId", "type", "occurredAt", "verificationId",
    "workItemId", "ownerAgentId", "checkIds", "reason", "dueGateId",
  ],
  verification_closed: [
    "schemaVersion", "eventId", "type", "occurredAt", "verificationId",
    "disposition", "summary", "evidenceRefs", "decisionIds",
  ],
  data_candidate_recorded: [
    "schemaVersion", "eventId", "type", "occurredAt", "candidateId",
    "sourceRef", "rights", "inputRef", "outputRef", "decisionRef",
    "verificationRefs", "outcomeRef", "version",
  ],
  source_delivery_imported: [
    "schemaVersion", "eventId", "type", "occurredAt", "deliveryId",
    "projectId", "projectDefinitionSha256", "assignmentId", "workItemId",
    "producerId", "targetWorkspaceRef",
    "targetHead", "entrySnapshotRef", "entrySnapshotSha256",
    "deliveryPacketSha256", "deliveryCandidateFingerprint",
    "workspaceSnapshotFingerprint", "overlayStatus", "candidateFiles",
    "changedPaths", "toolCachePaths", "dependencyEnvironmentPaths",
    "unchangedPacketPaths", "outOfScopeSourcePaths", "targetSnapshot",
    "proven", "notProven", "targetWritePerformed", "authorizationGranted",
  ],
  upstream_reopened: [
    "schemaVersion", "eventId", "type", "occurredAt", "reopenId",
    "assignmentId", "previousAssignmentId", "previousCheckpointEventId",
    "workItemId", "triggerWorkItemId", "fromAgentId", "reviewerAgentId",
    "toAgentId", "reason", "evidenceRefs", "nextAction",
  ],
  responsibility_transferred: [
    "schemaVersion", "eventId", "type", "occurredAt", "transferId",
    "assignmentId", "previousAssignmentId", "checkpointEventId",
    "handoffEventId", "assignmentEventId", "workItemId", "fromAgentId",
    "toAgentId", "state", "summary", "completedUnits", "evidenceRefs",
    "blockerRefs", "decisionRefs", "nextAction", "sourceFingerprint",
  ],
  work_item_scope_revised: [
    "schemaVersion", "eventId", "type", "occurredAt", "revisionId",
    "supersedesRevisionId", "assignmentId", "workItemId", "ownerAgentId",
    "previousOwnedPaths", "ownedPaths", "previousMeasurable", "measurable",
    "reason", "evidenceRefs",
  ],
  external_gate_reconciled: [
    "schemaVersion", "eventId", "type", "occurredAt", "reconciliationId",
    "supersedesReconciliationId", "gateId", "title", "requiredFor",
    "gateStatus", "ownerAgentId", "sourceAdapterId", "sourceRef",
    "sourceSha256", "summary", "evidenceRefs", "authorizationGranted",
  ],
  delivery_lifecycle_recorded: [
    "schemaVersion", "eventId", "type", "occurredAt", "recordId",
    "supersedesRecordId", "stage", "stageStatus", "ownerAgentId",
    "summary", "evidenceRefs", "externalGateIds", "authorizationGranted",
  ],
  work_item_evidence_requirement_set: [
    "schemaVersion", "eventId", "type", "occurredAt", "policyId",
    "supersedesPolicyId", "workItemId", "ownerAgentId", "requirement",
    "reason", "evidenceRefs", "authorizationGranted",
  ],
  checkpoint_receipt_bound: [
    "schemaVersion", "eventId", "type", "occurredAt", "checkpointId",
    "assignmentId", "workItemId", "state", "summary", "completedUnits",
    "evidenceRefs", "blockerRefs", "decisionRefs", "nextAction",
    "sourceFingerprint", "receiptBinding", "authorizationGranted",
  ],
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Project artifact is not canonical JSON.");
  return encoded;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value, label) {
  if (value === null) return null;
  return nonEmptyString(value, label);
}

function sha256Ref(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 reference.`);
  }
  return value;
}

function safeSourcePath(value, label) {
  if (typeof value !== "string"
    || value.length === 0
    || path.isAbsolute(value)
    || path.win32.parse(value).root
    || value.includes("\\")
    || value.includes("\0")
    || value.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a safe repository-relative path.`);
  }
  return value;
}

function stringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)
    || (!allowEmpty && value.length === 0)
    || value.some(item => typeof item !== "string" || item.trim().length === 0)
    || new Set(value).size !== value.length) {
    throw new Error(`${label} must be a unique string array${allowEmpty ? "" : " with at least one entry"}.`);
  }
  return [...value];
}

function projectRoot(workspaceRoot) {
  const root = realpathSync(workspaceRoot);
  return { root, projectRoot: path.join(root, PROJECT_ROOT) };
}

function assertRealProjectTree(root, candidate) {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(current) !== current) {
      throw new Error("Team project control path must not contain symlinks.");
    }
  }
}

function withProjectLock(root, operation) {
  const lockPath = path.join(root, "control.lock");
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Another team project control transaction is active.");
    }
    throw error;
  }
  try {
    return operation();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function teamProjectDefinitionBindingV1(definition) {
  const normalized = validateDefinition(definition);
  return {
    projectId: normalized.projectId,
    projectDefinitionSha256: `sha256:${sha256(canonical(normalized))}`,
  };
}

export function withTeamProjectControlLockV1({ workspaceRoot, operation }) {
  if (typeof operation !== "function") {
    throw new Error("Team project control operation must be a function.");
  }
  const loaded = loadProject(workspaceRoot);
  return withProjectLock(loaded.projectRoot, () => {
    const refreshed = loadProject(workspaceRoot);
    return operation({
      workspaceRoot: refreshed.root,
      projectRoot: refreshed.projectRoot,
      definition: structuredClone(refreshed.definition),
      definitionBinding: teamProjectDefinitionBindingV1(refreshed.definition),
    });
  });
}

function uniqueIds(rows, label) {
  const ids = rows.map(row => safeIdentifier(row.id, `${label} id`));
  if (new Set(ids).size !== ids.length) throw new Error(`${label} ids must be unique.`);
  return new Set(ids);
}

function assertAcyclic(items) {
  const byId = new Map(items.map(item => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Work item dependency cycle includes ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const item of items) visit(item.id);
}

function validateDefinition(value) {
  assertAllowedKeys(value, "Team project definition", DEFINITION_KEYS);
  if (value.schemaVersion !== DEFINITION_SCHEMA) {
    throw new Error(`Team project definition schemaVersion must be ${DEFINITION_SCHEMA}.`);
  }
  safeIdentifier(value.projectId, "projectId");
  nonEmptyString(value.objective, "objective");
  for (const [key, label] of [
    ["milestones", "Milestone"],
    ["workstreams", "Workstream"],
    ["workItems", "Work item"],
    ["integrationGates", "Integration gate"],
  ]) {
    if (!Array.isArray(value[key])) throw new Error(`${label} list must be an array.`);
  }
  if (value.workItems.length === 0) {
    throw new Error("Team project definition requires at least one WorkItem.");
  }
  const milestoneIds = uniqueIds(value.milestones, "Milestone");
  const workstreamIds = uniqueIds(value.workstreams, "Workstream");
  const workItemIds = uniqueIds(value.workItems, "Work item");
  const gateIds = uniqueIds(value.integrationGates, "Integration gate");

  const milestones = value.milestones.map((row) => {
    assertAllowedKeys(row, `Milestone ${row.id ?? "unknown"}`, ["id", "title"]);
    nonEmptyString(row.title, `Milestone ${row.id} title`);
    return { id: row.id, title: row.title };
  });
  const workstreams = value.workstreams.map((row) => {
    assertAllowedKeys(row, `Workstream ${row.id ?? "unknown"}`, ["id", "title", "milestoneId"]);
    nonEmptyString(row.title, `Workstream ${row.id} title`);
    if (!milestoneIds.has(row.milestoneId)) {
      throw new Error(`Workstream ${row.id} references unknown milestone ${row.milestoneId}.`);
    }
    return { id: row.id, title: row.title, milestoneId: row.milestoneId };
  });
  const workItems = value.workItems.map((row) => {
    assertAllowedKeys(row, `Work item ${row.id ?? "unknown"}`, [
      "id", "title", "milestoneId", "workstreamId", "dependencies",
      "ownedPaths", "measurable",
    ]);
    nonEmptyString(row.title, `Work item ${row.id} title`);
    if (!milestoneIds.has(row.milestoneId)) {
      throw new Error(`Work item ${row.id} references unknown milestone ${row.milestoneId}.`);
    }
    if (!workstreamIds.has(row.workstreamId)) {
      throw new Error(`Work item ${row.id} references unknown workstream ${row.workstreamId}.`);
    }
    const dependencies = stringArray(row.dependencies, `Work item ${row.id} dependencies`);
    for (const dependency of dependencies) {
      if (!workItemIds.has(dependency) || dependency === row.id) {
        throw new Error(`Work item ${row.id} has invalid dependency ${dependency}.`);
      }
    }
    const ownedPaths = validateLeaseOwnedPaths(row.ownedPaths);
    let measurable = null;
    if (row.measurable !== undefined) {
      assertAllowedKeys(row.measurable, `Work item ${row.id} measurable`, ["unit", "total"]);
      nonEmptyString(row.measurable.unit, `Work item ${row.id} measurable unit`);
      if (!Number.isSafeInteger(row.measurable.total) || row.measurable.total < 1) {
        throw new Error(`Work item ${row.id} measurable total must be a positive integer.`);
      }
      measurable = { unit: row.measurable.unit, total: row.measurable.total };
    }
    return {
      id: row.id,
      title: row.title,
      milestoneId: row.milestoneId,
      workstreamId: row.workstreamId,
      dependencies,
      ownedPaths,
      ...(measurable ? { measurable } : {}),
    };
  });
  assertAcyclic(workItems);
  const integrationGates = value.integrationGates.map((row) => {
    assertAllowedKeys(row, `Integration gate ${row.id ?? "unknown"}`, [
      "id", "title", "requiredWorkItemIds", "requiredDecisionIds",
    ]);
    nonEmptyString(row.title, `Integration gate ${row.id} title`);
    const requiredWorkItemIds = stringArray(
      row.requiredWorkItemIds,
      `Integration gate ${row.id} requiredWorkItemIds`,
      { allowEmpty: false },
    );
    for (const workItemId of requiredWorkItemIds) {
      if (!workItemIds.has(workItemId)) {
        throw new Error(`Integration gate ${row.id} references unknown work item ${workItemId}.`);
      }
    }
    const requiredDecisionIds = stringArray(
      row.requiredDecisionIds,
      `Integration gate ${row.id} requiredDecisionIds`,
    );
    return { id: row.id, title: row.title, requiredWorkItemIds, requiredDecisionIds };
  });
  if (gateIds.size !== integrationGates.length) throw new Error("Integration gate ids must be unique.");
  return {
    schemaVersion: DEFINITION_SCHEMA,
    projectId: value.projectId,
    objective: value.objective,
    milestones,
    workstreams,
    workItems,
    integrationGates,
  };
}

export function normalizeTeamProjectDefinitionV1(definition) {
  return validateDefinition(definition);
}

export function emptyTeamProjectTruthHashV1(definition) {
  const normalized = validateDefinition(definition);
  return sha256(canonical({ definition: normalized, events: [] }));
}

function readRegularJson(filePath, label) {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(filePath) !== filePath) {
    throw new Error(`${label} must be a regular file without symlinks.`);
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function loadProject(workspaceRoot) {
  const { root, projectRoot: rootPath } = projectRoot(workspaceRoot);
  const definitionPath = path.join(rootPath, "definition.json");
  if (!existsSync(definitionPath)) throw new Error("Team project is not initialized.");
  const definition = validateDefinition(readRegularJson(definitionPath, "Team project definition"));
  const eventsRoot = path.join(rootPath, "events");
  if (!existsSync(eventsRoot)) {
    throw new Error("Team project event directory must be a regular directory without symlinks.");
  }
  const eventsStat = lstatSync(eventsRoot);
  if (eventsStat.isSymbolicLink()
    || !eventsStat.isDirectory()
    || realpathSync(eventsRoot) !== eventsRoot) {
    throw new Error("Team project event directory must be a regular directory without symlinks.");
  }
  const events = readdirSync(eventsRoot, { withFileTypes: true })
      .filter(entry => entry.name.endsWith(".json"))
      .map((entry) => {
        if (entry.isSymbolicLink() || !entry.isFile()) {
          throw new Error(`Team project event must be a regular file: ${entry.name}`);
        }
        const eventPath = path.join(eventsRoot, entry.name);
        const event = readRegularJson(eventPath, `Team project event ${entry.name}`);
        if (`${event.eventId}.json` !== entry.name) {
          throw new Error(`Team project event filename is not bound to eventId: ${entry.name}`);
        }
        return { event, ref: `project/events/${entry.name}` };
      })
      .sort((left, right) => (
        left.event.occurredAt.localeCompare(right.event.occurredAt)
        || left.event.eventId.localeCompare(right.event.eventId)
      ));
  return { root, projectRoot: rootPath, definitionPath, definition, events };
}

function pathPrefix(value) {
  return value.endsWith("/**") ? value.slice(0, -3) : null;
}

function covers(owner, candidate) {
  if (owner === candidate) return true;
  const prefix = pathPrefix(owner);
  if (prefix === null) return false;
  const candidatePrefix = pathPrefix(candidate) ?? candidate;
  return candidatePrefix === prefix || candidatePrefix.startsWith(`${prefix}/`);
}

function pathsOverlap(left, right) {
  return left.some(leftPath => right.some(rightPath => (
    covers(leftPath, rightPath) || covers(rightPath, leftPath)
  )));
}

function eventRef(event) {
  return `project/events/${event.eventId}.json`;
}

function compareEventFacts(left, right) {
  return left.occurredAt.localeCompare(right.occurredAt)
    || left.eventId.localeCompare(right.eventId);
}

function latestEventFact(left, right) {
  if (!left) return right;
  if (!right) return left;
  return compareEventFacts(left, right) >= 0 ? left : right;
}

function downstreamWorkItemIds(definition, workItemId, { includeRoot = false } = {}) {
  const children = new Map(definition.workItems.map(row => [row.id, []]));
  for (const row of definition.workItems) {
    for (const dependency of row.dependencies) children.get(dependency).push(row.id);
  }
  const visited = new Set(includeRoot ? [workItemId] : []);
  const queue = [...children.get(workItemId)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...children.get(current));
  }
  return [...visited].sort(compareIdentifiers);
}

function pendingHandoffProjection(handoff) {
  return handoff
    ? {
        eventId: handoff.eventId,
        truthRef: handoff.ref,
        assignmentId: handoff.assignmentId,
        workItemId: handoff.workItemId,
        fromAgentId: handoff.fromAgentId,
        toAgentId: handoff.toAgentId,
        summary: handoff.summary,
        evidenceRefs: [...handoff.evidenceRefs],
        nextAction: handoff.nextAction,
        occurredAt: handoff.occurredAt,
      }
    : null;
}

function reworkProjection(rework, attempt) {
  return rework
    ? {
        eventId: rework.eventId,
        truthRef: rework.ref,
        reworkId: rework.reworkId,
        attempt,
        failedCheckpointEventId: rework.failedCheckpointEventId,
        failedTruthRef: `project/events/${rework.failedCheckpointEventId}.json`,
        previousAssignmentId: rework.failedAssignmentId,
        previousAgentId: rework.fromAgentId,
        reviewerAgentId: rework.reviewerAgentId,
        assignmentId: rework.assignmentId,
        agentId: rework.toAgentId,
        reason: rework.reason,
        evidenceRefs: [...rework.evidenceRefs],
        nextAction: rework.nextAction,
        occurredAt: rework.occurredAt,
      }
    : null;
}

function sourceDeliveryProjection(delivery) {
  return delivery
    ? {
        projectId: delivery.projectId,
        projectDefinitionSha256: delivery.projectDefinitionSha256,
        deliveryId: delivery.deliveryId,
        workItemId: delivery.workItemId,
        assignmentId: delivery.assignmentId,
        producerId: delivery.producerId,
        targetWorkspaceRef: delivery.targetWorkspaceRef,
        targetHead: delivery.targetHead,
        entrySnapshotRef: delivery.entrySnapshotRef,
        entrySnapshotSha256: delivery.entrySnapshotSha256,
        deliveryPacketSha256: delivery.deliveryPacketSha256,
        deliveryCandidateFingerprint: delivery.deliveryCandidateFingerprint,
        workspaceSnapshotFingerprint: delivery.workspaceSnapshotFingerprint,
        overlayStatus: delivery.overlayStatus,
        candidateFiles: delivery.candidateFiles.map(row => ({ ...row })),
        candidatePaths: delivery.candidateFiles.map(row => row.path),
        changedPaths: [...delivery.changedPaths],
        toolCachePaths: [...delivery.toolCachePaths],
        dependencyEnvironmentPaths: [...delivery.dependencyEnvironmentPaths],
        unchangedPacketPaths: [...delivery.unchangedPacketPaths],
        proven: [...delivery.proven],
        notProven: [...delivery.notProven],
        occurredAt: delivery.occurredAt,
        truthRef: delivery.ref,
        targetWritePerformed: false,
        authorizationGranted: false,
      }
    : null;
}

function sourceDeliveryDelta(deliveries) {
  const current = deliveries.at(-1) ?? null;
  if (!current) return null;
  const previous = deliveries.at(-2) ?? null;
  if (!previous) {
    return {
      status: "first_delivery",
      currentDeliveryId: current.deliveryId,
      previousDeliveryId: null,
      addedPaths: current.candidateFiles.map(row => row.path),
      changedPaths: [],
      removedPaths: [],
      unchangedPaths: [],
    };
  }
  const currentFiles = new Map(current.candidateFiles.map(row => [row.path, row.sha256]));
  const previousFiles = new Map(previous.candidateFiles.map(row => [row.path, row.sha256]));
  const allPaths = uniqueSorted([...currentFiles.keys(), ...previousFiles.keys()]);
  const addedPaths = allPaths.filter(filePath => (
    currentFiles.has(filePath) && !previousFiles.has(filePath)
  ));
  const removedPaths = allPaths.filter(filePath => (
    !currentFiles.has(filePath) && previousFiles.has(filePath)
  ));
  const changedPaths = allPaths.filter(filePath => (
    currentFiles.has(filePath)
    && previousFiles.has(filePath)
    && currentFiles.get(filePath) !== previousFiles.get(filePath)
  ));
  const unchangedPaths = allPaths.filter(filePath => (
    currentFiles.has(filePath)
    && previousFiles.has(filePath)
    && currentFiles.get(filePath) === previousFiles.get(filePath)
  ));
  return {
    status: addedPaths.length || removedPaths.length || changedPaths.length
      ? "changed"
      : "unchanged",
    currentDeliveryId: current.deliveryId,
    previousDeliveryId: previous.deliveryId,
    addedPaths,
    changedPaths,
    removedPaths,
    unchangedPaths,
  };
}

function staleHandoffsForTakeover({ loaded, status, agentId, responsibilities }) {
  const responsibilityIds = new Set(responsibilities.map(row => row.workItemId));
  const pendingEventIds = new Set(status.workItems
    .map(row => row.pendingHandoff?.eventId)
    .filter(Boolean));
  return loaded.events
    .filter(({ event }) => (
      event.type === "handoff_recorded"
      && !pendingEventIds.has(event.eventId)
      && (responsibilityIds.has(event.workItemId)
        || event.fromAgentId === agentId
        || event.toAgentId === agentId)
    ))
    .map(({ event, ref }) => {
      const laterFacts = loaded.events.filter(row => (
        row.event.workItemId === event.workItemId
        && compareEventFacts(row.event, event) > 0
        && [
          "agent_assigned",
          "checkpoint_recorded",
          "handoff_recorded",
          "rework_returned",
          "source_delivery_imported",
          "upstream_reopened",
          "responsibility_transferred",
          "work_item_scope_revised",
        ].includes(row.event.type)
      ));
      let reason = "superseded_by_current_truth";
      if (laterFacts.some(row => row.event.type === "handoff_recorded")) {
        reason = "redirected_by_later_handoff";
      } else if (laterFacts.some(row => (
        row.event.type === "agent_assigned"
        || row.event.type === "rework_returned"
        || row.event.type === "upstream_reopened"
        || row.event.type === "responsibility_transferred"
      ))) {
        reason = "superseded_by_assignment";
      } else if (laterFacts.length > 0) {
        reason = "superseded_by_later_work_fact";
      }
      return {
        eventId: event.eventId,
        truthRef: ref,
        assignmentId: event.assignmentId,
        workItemId: event.workItemId,
        fromAgentId: event.fromAgentId,
        toAgentId: event.toAgentId,
        occurredAt: event.occurredAt,
        reason,
      };
    })
    .sort((left, right) => compareIdentifiers(left.eventId, right.eventId));
}

function normalizeTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(
      "Team project event occurredAt must be an ISO-8601 UTC timestamp "
      + "(YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.sssZ).",
    );
  }
  return new Date(value).toISOString();
}

function validateEventShape(value, definition) {
  if (!isRecord(value) || typeof value.type !== "string" || !(value.type in EVENT_KEYS)) {
    throw new Error("Team project event type is invalid.");
  }
  assertAllowedKeys(value, `Team project event ${value.eventId ?? "unknown"}`, EVENT_KEYS[value.type]);
  if (![EVENT_SCHEMA, EVENT_SCHEMA_V2, EVENT_SCHEMA_V3, EVENT_SCHEMA_V4, EVENT_SCHEMA_V5, EVENT_SCHEMA_V6, EVENT_SCHEMA_V7]
    .includes(value.schemaVersion)) {
    throw new Error(
      `Team project event schemaVersion must be ${EVENT_SCHEMA}, ${EVENT_SCHEMA_V2}, ${EVENT_SCHEMA_V3}, ${EVENT_SCHEMA_V4}, ${EVENT_SCHEMA_V5}, ${EVENT_SCHEMA_V6}, or ${EVENT_SCHEMA_V7}.`,
    );
  }
  if (value.type === "rework_returned" && value.schemaVersion !== EVENT_SCHEMA_V2) {
    throw new Error(`rework_returned requires schemaVersion ${EVENT_SCHEMA_V2}.`);
  }
  if (value.type === "source_delivery_imported" && value.schemaVersion !== EVENT_SCHEMA_V3) {
    throw new Error(`source_delivery_imported requires schemaVersion ${EVENT_SCHEMA_V3}.`);
  }
  if (value.schemaVersion === EVENT_SCHEMA_V3 && value.type !== "source_delivery_imported") {
    throw new Error(`${EVENT_SCHEMA_V3} is reserved for source_delivery_imported events.`);
  }
  const eventV4Types = new Set(["upstream_reopened", "responsibility_transferred"]);
  if (eventV4Types.has(value.type) && value.schemaVersion !== EVENT_SCHEMA_V4) {
    throw new Error(`${value.type} requires schemaVersion ${EVENT_SCHEMA_V4}.`);
  }
  if (value.schemaVersion === EVENT_SCHEMA_V4 && !eventV4Types.has(value.type)) {
    throw new Error(
      `${EVENT_SCHEMA_V4} is reserved for upstream_reopened and responsibility_transferred events.`,
    );
  }
  if (value.type === "work_item_scope_revised" && value.schemaVersion !== EVENT_SCHEMA_V5) {
    throw new Error(`work_item_scope_revised requires schemaVersion ${EVENT_SCHEMA_V5}.`);
  }
  if (value.schemaVersion === EVENT_SCHEMA_V5 && value.type !== "work_item_scope_revised") {
    throw new Error(`${EVENT_SCHEMA_V5} is reserved for work_item_scope_revised events.`);
  }
  const eventV6Types = new Set(["external_gate_reconciled", "delivery_lifecycle_recorded"]);
  if (eventV6Types.has(value.type) && value.schemaVersion !== EVENT_SCHEMA_V6) {
    throw new Error(`${value.type} requires schemaVersion ${EVENT_SCHEMA_V6}.`);
  }
  if (value.schemaVersion === EVENT_SCHEMA_V6 && !eventV6Types.has(value.type)) {
    throw new Error(
      `${EVENT_SCHEMA_V6} is reserved for external Gate and delivery lifecycle events.`,
    );
  }
  const eventV7Types = new Set([
    "work_item_evidence_requirement_set",
    "checkpoint_receipt_bound",
  ]);
  if (eventV7Types.has(value.type) && value.schemaVersion !== EVENT_SCHEMA_V7) {
    throw new Error(`${value.type} requires schemaVersion ${EVENT_SCHEMA_V7}.`);
  }
  if (value.schemaVersion === EVENT_SCHEMA_V7 && !eventV7Types.has(value.type)) {
    throw new Error(
      `${EVENT_SCHEMA_V7} is reserved for WorkItem evidence requirements and receipt binding.`,
    );
  }
  safeIdentifier(value.eventId, "eventId");
  const normalizedOccurredAt = normalizeTimestamp(value.occurredAt);
  const workItemIds = new Set(definition.workItems.map(row => row.id));
  const gateIds = new Set(definition.integrationGates.map(row => row.id));
  const assertWorkItem = (id) => {
    safeIdentifier(id, "workItemId");
    if (!workItemIds.has(id)) throw new Error(`Team project event references unknown work item ${id}.`);
  };
  if ([
    "agent_assigned",
    "checkpoint_recorded",
    "handoff_recorded",
    "rework_returned",
    "source_delivery_imported",
    "upstream_reopened",
    "responsibility_transferred",
    "work_item_scope_revised",
    "verification_deferred",
    "work_item_evidence_requirement_set",
    "checkpoint_receipt_bound",
  ].includes(value.type)) {
    assertWorkItem(value.workItemId);
  }
  if ([
    "agent_assigned",
    "checkpoint_recorded",
    "handoff_recorded",
    "rework_returned",
    "source_delivery_imported",
    "upstream_reopened",
    "responsibility_transferred",
    "work_item_scope_revised",
    "checkpoint_receipt_bound",
  ].includes(value.type)) {
    safeIdentifier(value.assignmentId, "assignmentId");
  }
  if (value.type === "agent_assigned") {
    safeIdentifier(value.agentId, "agentId");
    if (value.supersedesAssignmentId !== undefined) {
      safeIdentifier(value.supersedesAssignmentId, "supersedesAssignmentId");
    }
    if ((value.executionRunId === undefined) !== (value.executionWorkItemId === undefined)) {
      throw new Error("executionRunId and executionWorkItemId must be supplied together.");
    }
    if (value.executionRunId !== undefined) {
      safeIdentifier(value.executionRunId, "executionRunId");
      safeIdentifier(value.executionWorkItemId, "executionWorkItemId");
    }
  } else if (value.type === "checkpoint_recorded") {
    if (!WORK_ITEM_STATES.has(value.state)) throw new Error("Checkpoint state is invalid.");
    nonEmptyString(value.summary, "Checkpoint summary");
    stringArray(value.evidenceRefs, "Checkpoint evidenceRefs");
    stringArray(value.blockerRefs, "Checkpoint blockerRefs");
    stringArray(value.decisionRefs, "Checkpoint decisionRefs");
    nullableString(value.nextAction, "Checkpoint nextAction");
    if (value.sourceFingerprint !== undefined
      && !/^(?:sha256:)?[a-f0-9]{64}$/u.test(value.sourceFingerprint)) {
      throw new Error("Checkpoint sourceFingerprint is invalid.");
    }
    if (value.completedUnits !== undefined
      && (!Number.isSafeInteger(value.completedUnits) || value.completedUnits < 0)) {
      throw new Error("Checkpoint completedUnits must be a non-negative integer.");
    }
    if (value.state === "completed" && value.evidenceRefs.length === 0) {
      throw new Error("Completed checkpoint requires evidence.");
    }
  } else if (value.type === "handoff_recorded") {
    safeIdentifier(value.fromAgentId, "fromAgentId");
    safeIdentifier(value.toAgentId, "toAgentId");
    if (value.fromAgentId === value.toAgentId) {
      throw new Error("fromAgentId and toAgentId must differ.");
    }
    nonEmptyString(value.summary, "Handoff summary");
    stringArray(value.evidenceRefs, "Handoff evidenceRefs", { allowEmpty: false });
    nonEmptyString(value.nextAction, "Handoff nextAction");
  } else if (value.type === "rework_returned") {
    safeIdentifier(value.reworkId, "reworkId");
    safeIdentifier(value.failedAssignmentId, "failedAssignmentId");
    safeIdentifier(value.failedCheckpointEventId, "failedCheckpointEventId");
    safeIdentifier(value.fromAgentId, "fromAgentId");
    safeIdentifier(value.reviewerAgentId, "reviewerAgentId");
    safeIdentifier(value.toAgentId, "toAgentId");
    nonEmptyString(value.reason, "Rework reason");
    stringArray(value.evidenceRefs, "Rework evidenceRefs", { allowEmpty: false });
    nonEmptyString(value.nextAction, "Rework nextAction");
  } else if (value.type === "decision_opened") {
    safeIdentifier(value.decisionId, "decisionId");
    safeIdentifier(value.ownerAgentId, "ownerAgentId");
    nonEmptyString(value.title, "Decision title");
    nonEmptyString(value.question, "Decision question");
    const blocking = stringArray(value.blockingWorkItemIds, "Decision blockingWorkItemIds");
    for (const id of blocking) assertWorkItem(id);
    stringArray(value.options, "Decision options", { allowEmpty: false });
  } else if (value.type === "decision_resolved") {
    safeIdentifier(value.decisionId, "decisionId");
    nonEmptyString(value.resolution, "Decision resolution");
    nonEmptyString(value.rationale, "Decision rationale");
    stringArray(value.evidenceRefs, "Decision evidenceRefs", { allowEmpty: false });
  } else if (value.type === "integration_gate_passed") {
    safeIdentifier(value.gateId, "gateId");
    if (!gateIds.has(value.gateId)) throw new Error(`Unknown integration gate ${value.gateId}.`);
    nonEmptyString(value.summary, "Integration gate summary");
    stringArray(value.evidenceRefs, "Integration gate evidenceRefs", { allowEmpty: false });
  } else if (value.type === "verification_deferred") {
    safeIdentifier(value.verificationId, "verificationId");
    safeIdentifier(value.ownerAgentId, "ownerAgentId");
    const checkIds = stringArray(
      value.checkIds,
      "Deferred verification checkIds",
      { allowEmpty: false },
    );
    for (const checkId of checkIds) safeIdentifier(checkId, "checkId");
    nonEmptyString(value.reason, "Deferred verification reason");
    safeIdentifier(value.dueGateId, "dueGateId");
    if (!gateIds.has(value.dueGateId)) {
      throw new Error(`Unknown deferred verification gate ${value.dueGateId}.`);
    }
  } else if (value.type === "verification_closed") {
    safeIdentifier(value.verificationId, "verificationId");
    if (!VERIFICATION_DISPOSITIONS.has(value.disposition)) {
      throw new Error("Deferred verification disposition is invalid.");
    }
    nonEmptyString(value.summary, "Deferred verification close summary");
    const evidenceRefs = stringArray(
      value.evidenceRefs,
      "Deferred verification close evidenceRefs",
    );
    const decisionIds = stringArray(
      value.decisionIds,
      "Deferred verification close decisionIds",
    );
    for (const decisionId of decisionIds) safeIdentifier(decisionId, "decisionId");
    if (value.disposition === "verified" && evidenceRefs.length === 0) {
      throw new Error("Verified deferred verification requires evidence.");
    }
    if (value.disposition === "verified" && decisionIds.length > 0) {
      throw new Error("Verified deferred verification must close with evidence, not decision IDs.");
    }
    if (value.disposition === "no_longer_required" && decisionIds.length === 0) {
      throw new Error("No-longer-required deferred verification requires a resolved decision.");
    }
  } else if (value.type === "data_candidate_recorded") {
    safeIdentifier(value.candidateId, "candidateId");
    nonEmptyString(value.sourceRef, "Data candidate sourceRef");
    nonEmptyString(value.rights, "Data candidate rights");
    nonEmptyString(value.inputRef, "Data candidate inputRef");
    nonEmptyString(value.outputRef, "Data candidate outputRef");
    nullableString(value.decisionRef, "Data candidate decisionRef");
    stringArray(value.verificationRefs, "Data candidate verificationRefs");
    nullableString(value.outcomeRef, "Data candidate outcomeRef");
    nonEmptyString(value.version, "Data candidate version");
  } else if (value.type === "source_delivery_imported") {
    safeIdentifier(value.projectId, "External delivery projectId");
    sha256Ref(value.projectDefinitionSha256, "External delivery projectDefinitionSha256");
    const definitionBinding = teamProjectDefinitionBindingV1(definition);
    if (value.projectId !== definitionBinding.projectId
      || value.projectDefinitionSha256 !== definitionBinding.projectDefinitionSha256) {
      throw new Error("External delivery project identity does not match current project truth.");
    }
    safeIdentifier(value.deliveryId, "deliveryId");
    safeIdentifier(value.producerId, "producerId");
    nonEmptyString(value.targetWorkspaceRef, "External delivery targetWorkspaceRef");
    if (!path.isAbsolute(value.targetWorkspaceRef)) {
      throw new Error("External delivery targetWorkspaceRef must be absolute.");
    }
    if (typeof value.targetHead !== "string"
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value.targetHead)) {
      throw new Error("External delivery targetHead is invalid.");
    }
    if ((value.entrySnapshotRef === null) !== (value.entrySnapshotSha256 === null)) {
      throw new Error("External delivery entry snapshot ref and hash must be supplied together.");
    }
    if (value.entrySnapshotRef !== null) {
      nonEmptyString(value.entrySnapshotRef, "External delivery entrySnapshotRef");
      sha256Ref(value.entrySnapshotSha256, "External delivery entrySnapshotSha256");
    }
    sha256Ref(value.deliveryPacketSha256, "External delivery packet hash");
    if (typeof value.deliveryCandidateFingerprint !== "string"
      || !/^[a-f0-9]{64}$/u.test(value.deliveryCandidateFingerprint)) {
      throw new Error("External delivery candidate fingerprint is invalid.");
    }
    sha256Ref(value.workspaceSnapshotFingerprint, "External delivery workspace snapshot fingerprint");
    if (!["candidate_only", "attested", "attested_with_non_source_changes"].includes(value.overlayStatus)) {
      throw new Error("External delivery overlayStatus is invalid.");
    }
    if (!Array.isArray(value.candidateFiles) || value.candidateFiles.length === 0) {
      throw new Error("External delivery candidateFiles must contain at least one file.");
    }
    const candidateFiles = value.candidateFiles.map((row) => {
      assertAllowedKeys(row, "External delivery candidate file", ["path", "sha256"]);
      const filePath = safeSourcePath(row.path, "External delivery candidate file path");
      if (typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.sha256)) {
        throw new Error(`External delivery candidate file hash is invalid: ${filePath}.`);
      }
      return { path: filePath, sha256: row.sha256 };
    });
    if (new Set(candidateFiles.map(row => row.path)).size !== candidateFiles.length
      || canonical([...candidateFiles].sort((left, right) => (
        compareIdentifiers(left.path, right.path)
      )))
        !== canonical(candidateFiles)) {
      throw new Error("External delivery candidateFiles must be uniquely sorted by path.");
    }
    if (canonicalSourceFingerprint(Object.fromEntries(
      candidateFiles.map(row => [row.path, row.sha256]),
    )) !== value.deliveryCandidateFingerprint) {
      throw new Error("External delivery candidate fingerprint does not match its file map.");
    }
    for (const [field, label] of [
      ["changedPaths", "External delivery changedPaths"],
      ["toolCachePaths", "External delivery toolCachePaths"],
      ["dependencyEnvironmentPaths", "External delivery dependencyEnvironmentPaths"],
      ["unchangedPacketPaths", "External delivery unchangedPacketPaths"],
      ["outOfScopeSourcePaths", "External delivery outOfScopeSourcePaths"],
    ]) {
      const paths = stringArray(value[field], label);
      for (const filePath of paths) safeSourcePath(filePath, label);
      if (canonical([...paths].sort()) !== canonical(paths)) {
        throw new Error(`${label} must be sorted.`);
      }
    }
    if (value.outOfScopeSourcePaths.length !== 0) {
      throw new Error("An imported external delivery cannot contain out-of-scope source paths.");
    }
    stringArray(value.proven, "External delivery proven statements", { allowEmpty: false });
    stringArray(value.notProven, "External delivery notProven statements", { allowEmpty: false });
    if (!validWorkspaceSnapshotShape(value.targetSnapshot)
      || !quickSnapshotFingerprintValid(value.targetSnapshot)
      || value.targetSnapshot.sourceFingerprint !== value.workspaceSnapshotFingerprint) {
      throw new Error("External delivery targetSnapshot identity is invalid.");
    }
    if (value.targetWritePerformed !== false || value.authorizationGranted !== false) {
      throw new Error("External delivery cannot grant authority or write the target workspace.");
    }
  } else if (value.type === "upstream_reopened") {
    safeIdentifier(value.reopenId, "reopenId");
    safeIdentifier(value.previousAssignmentId, "previousAssignmentId");
    safeIdentifier(value.previousCheckpointEventId, "previousCheckpointEventId");
    assertWorkItem(value.triggerWorkItemId);
    safeIdentifier(value.fromAgentId, "fromAgentId");
    safeIdentifier(value.reviewerAgentId, "reviewerAgentId");
    safeIdentifier(value.toAgentId, "toAgentId");
    nonEmptyString(value.reason, "Upstream reopen reason");
    stringArray(value.evidenceRefs, "Upstream reopen evidenceRefs", { allowEmpty: false });
    nonEmptyString(value.nextAction, "Upstream reopen nextAction");
  } else if (value.type === "responsibility_transferred") {
    safeIdentifier(value.transferId, "transferId");
    safeIdentifier(value.previousAssignmentId, "previousAssignmentId");
    for (const [field, label] of [
      ["checkpointEventId", "checkpointEventId"],
      ["handoffEventId", "handoffEventId"],
      ["assignmentEventId", "assignmentEventId"],
    ]) safeIdentifier(value[field], label);
    if (new Set([
      value.eventId,
      value.checkpointEventId,
      value.handoffEventId,
      value.assignmentEventId,
    ]).size !== 4) {
      throw new Error("Responsibility transfer fact IDs must be distinct.");
    }
    safeIdentifier(value.fromAgentId, "fromAgentId");
    safeIdentifier(value.toAgentId, "toAgentId");
    if (value.fromAgentId === value.toAgentId) {
      throw new Error("Responsibility transfer Agents must differ.");
    }
    if (!["active", "waiting_dependency", "waiting_decision", "verifying", "ready_to_integrate"]
      .includes(value.state)) {
      throw new Error("Responsibility transfer state must be non-terminal.");
    }
    nonEmptyString(value.summary, "Responsibility transfer summary");
    stringArray(value.evidenceRefs, "Responsibility transfer evidenceRefs", { allowEmpty: false });
    stringArray(value.blockerRefs, "Responsibility transfer blockerRefs");
    stringArray(value.decisionRefs, "Responsibility transfer decisionRefs");
    nonEmptyString(value.nextAction, "Responsibility transfer nextAction");
    if (value.completedUnits !== undefined
      && (!Number.isSafeInteger(value.completedUnits) || value.completedUnits < 0)) {
      throw new Error("Responsibility transfer completedUnits must be a non-negative integer.");
    }
    if (value.sourceFingerprint !== undefined
      && !/^(?:sha256:)?[a-f0-9]{64}$/u.test(value.sourceFingerprint)) {
      throw new Error("Responsibility transfer sourceFingerprint is invalid.");
    }
  } else if (value.type === "work_item_scope_revised") {
    safeIdentifier(value.revisionId, "revisionId");
    if (value.supersedesRevisionId !== undefined) {
      safeIdentifier(value.supersedesRevisionId, "supersedesRevisionId");
    }
    safeIdentifier(value.ownerAgentId, "ownerAgentId");
    const previousOwnedPaths = validateLeaseOwnedPaths(value.previousOwnedPaths);
    const ownedPaths = validateLeaseOwnedPaths(value.ownedPaths);
    const validateMeasurable = (measurable, label) => {
      if (measurable === null) return null;
      if (!isRecord(measurable)) throw new Error(`${label} must be an object or null.`);
      assertAllowedKeys(measurable, label, ["unit", "total"]);
      nonEmptyString(measurable.unit, `${label} unit`);
      if (!Number.isSafeInteger(measurable.total) || measurable.total < 1) {
        throw new Error(`${label} total must be a positive integer.`);
      }
      return { unit: measurable.unit, total: measurable.total };
    };
    const previousMeasurable = validateMeasurable(
      value.previousMeasurable,
      "Previous WorkItem measurable",
    );
    const measurable = validateMeasurable(value.measurable, "Revised WorkItem measurable");
    nonEmptyString(value.reason, "WorkItem scope revision reason");
    stringArray(value.evidenceRefs, "WorkItem scope revision evidenceRefs");
    return {
      ...structuredClone(value),
      occurredAt: normalizedOccurredAt,
      previousOwnedPaths,
      ownedPaths,
      previousMeasurable,
      measurable,
    };
  } else if (value.type === "external_gate_reconciled") {
    safeIdentifier(value.reconciliationId, "reconciliationId");
    if (value.supersedesReconciliationId !== undefined) {
      safeIdentifier(value.supersedesReconciliationId, "supersedesReconciliationId");
    }
    safeIdentifier(value.gateId, "external gateId");
    nonEmptyString(value.title, "External Gate title");
    if (!DELIVERY_STAGES.includes(value.requiredFor)) {
      throw new Error("External Gate requiredFor must be a delivery stage.");
    }
    if (!EXTERNAL_GATE_STATUSES.has(value.gateStatus)) {
      throw new Error("External Gate status is invalid.");
    }
    safeIdentifier(value.ownerAgentId, "External Gate ownerAgentId");
    safeIdentifier(value.sourceAdapterId, "External Gate sourceAdapterId");
    nonEmptyString(value.sourceRef, "External Gate sourceRef");
    sha256Ref(value.sourceSha256, "External Gate sourceSha256");
    nonEmptyString(value.summary, "External Gate summary");
    stringArray(value.evidenceRefs, "External Gate evidenceRefs", { allowEmpty: false });
    if (value.authorizationGranted !== false) {
      throw new Error("External Gate authorizationGranted must remain false.");
    }
  } else if (value.type === "delivery_lifecycle_recorded") {
    safeIdentifier(value.recordId, "delivery recordId");
    if (value.supersedesRecordId !== undefined) {
      safeIdentifier(value.supersedesRecordId, "supersedesRecordId");
    }
    if (!DELIVERY_STAGES.includes(value.stage)) {
      throw new Error("Delivery lifecycle stage is invalid.");
    }
    if (!DELIVERY_STAGE_OUTCOMES[value.stage].has(value.stageStatus)) {
      throw new Error(`Delivery lifecycle outcome is invalid for ${value.stage}.`);
    }
    safeIdentifier(value.ownerAgentId, "Delivery lifecycle ownerAgentId");
    nonEmptyString(value.summary, "Delivery lifecycle summary");
    stringArray(
      value.evidenceRefs,
      "Delivery lifecycle evidenceRefs",
      { allowEmpty: false },
    );
    const gateIdsForRecord = stringArray(
      value.externalGateIds,
      "Delivery lifecycle externalGateIds",
    );
    for (const gateId of gateIdsForRecord) safeIdentifier(gateId, "externalGateId");
    if (value.authorizationGranted !== false) {
      throw new Error("Delivery lifecycle authorizationGranted must remain false.");
    }
  } else if (value.type === "work_item_evidence_requirement_set") {
    safeIdentifier(value.policyId, "evidence policyId");
    if (value.supersedesPolicyId !== undefined) {
      safeIdentifier(value.supersedesPolicyId, "supersedesPolicyId");
    }
    safeIdentifier(value.ownerAgentId, "Evidence requirement ownerAgentId");
    if (!new Set(["none", "quick"]).has(value.requirement)) {
      throw new Error("WorkItem evidence requirement is invalid.");
    }
    nonEmptyString(value.reason, "WorkItem evidence requirement reason");
    stringArray(
      value.evidenceRefs,
      "WorkItem evidence requirement evidenceRefs",
      { allowEmpty: false },
    );
    if (value.authorizationGranted !== false) {
      throw new Error("WorkItem evidence requirement authorizationGranted must remain false.");
    }
  } else if (value.type === "checkpoint_receipt_bound") {
    safeIdentifier(value.checkpointId, "checkpointId");
    if (!WORK_ITEM_STATES.has(value.state)) throw new Error("Checkpoint state is invalid.");
    nonEmptyString(value.summary, "Checkpoint summary");
    stringArray(value.evidenceRefs, "Checkpoint evidenceRefs");
    stringArray(value.blockerRefs, "Checkpoint blockerRefs");
    stringArray(value.decisionRefs, "Checkpoint decisionRefs");
    nullableString(value.nextAction, "Checkpoint nextAction");
    if (value.sourceFingerprint !== undefined
      && !/^(?:sha256:)?[a-f0-9]{64}$/u.test(value.sourceFingerprint)) {
      throw new Error("Checkpoint sourceFingerprint is invalid.");
    }
    if (value.completedUnits !== undefined
      && (!Number.isSafeInteger(value.completedUnits) || value.completedUnits < 0)) {
      throw new Error("Checkpoint completedUnits must be a non-negative integer.");
    }
    if (!isRecord(value.receiptBinding)) {
      throw new Error("Checkpoint receiptBinding must be an object.");
    }
    assertAllowedKeys(value.receiptBinding, "Checkpoint receiptBinding", [
      "kind", "receiptId", "receiptRef", "receiptSha256",
      "sourceFingerprint", "attestationDecision", "issueCodes",
    ]);
    if (value.receiptBinding.kind !== "quick"
      || value.receiptBinding.attestationDecision !== "GO") {
      throw new Error("Checkpoint receiptBinding must be one GO Quick receipt.");
    }
    safeIdentifier(value.receiptBinding.receiptId, "Quick receiptId");
    safeSourcePath(value.receiptBinding.receiptRef, "Quick receiptRef");
    sha256Ref(value.receiptBinding.receiptSha256, "Quick receiptSha256");
    sha256Ref(value.receiptBinding.sourceFingerprint, "Quick sourceFingerprint");
    stringArray(value.receiptBinding.issueCodes, "Quick attestation issueCodes");
    if (value.authorizationGranted !== false) {
      throw new Error("Receipt-bound checkpoint authorizationGranted must remain false.");
    }
  }
  return { ...structuredClone(value), occurredAt: normalizedOccurredAt };
}

function projectEvents(definition, records) {
  const assignments = new Map();
  const assignmentHistory = new Map(definition.workItems.map(row => [row.id, []]));
  const checkpoints = new Map();
  const handoffs = new Map();
  const reworks = new Map();
  const reopens = new Map();
  const transfers = new Map();
  const decisions = new Map();
  const gatePasses = new Map();
  const verifications = new Map();
  const dataCandidates = [];
  const sourceDeliveries = [];
  const scopeRevisions = new Map();
  const scopeRevisionHistory = new Map(definition.workItems.map(row => [row.id, []]));
  const externalGates = new Map();
  const deliveryRecords = new Map();
  const evidenceRequirements = new Map();
  const receiptBindings = new Map();
  const seenAssignments = new Set();
  const seenReworks = new Set();
  const seenReopens = new Set();
  const seenTransfers = new Set();
  const seenDecisions = new Set();
  const seenDeliveries = new Set();
  const seenScopeRevisions = new Set();
  const seenExternalGateReconciliations = new Set();
  const seenDeliveryRecords = new Set();
  const seenEvidencePolicies = new Set();
  const seenReceiptBindings = new Set();
  const seenFactIds = new Set(records.map(row => row.event.eventId));

  for (const { event, ref } of records) {
    validateEventShape(event, definition);
    if (event.type === "agent_assigned") {
      if (seenAssignments.has(event.assignmentId)) {
        throw new Error(`Duplicate assignmentId ${event.assignmentId}.`);
      }
      seenAssignments.add(event.assignmentId);
      assignments.set(event.workItemId, { ...event, ref });
      assignmentHistory.get(event.workItemId).push({ ...event, ref });
    } else if (event.type === "checkpoint_recorded") {
      checkpoints.set(event.workItemId, { ...event, ref });
    } else if (event.type === "handoff_recorded") {
      handoffs.set(event.workItemId, { ...event, ref });
    } else if (event.type === "rework_returned") {
      if (seenReworks.has(event.reworkId)) {
        throw new Error(`Duplicate reworkId ${event.reworkId}.`);
      }
      if (seenAssignments.has(event.assignmentId)) {
        throw new Error(`Duplicate assignmentId ${event.assignmentId}.`);
      }
      const current = assignments.get(event.workItemId) ?? null;
      const failure = checkpoints.get(event.workItemId) ?? null;
      const latestFact = latestEventFact(failure, handoffs.get(event.workItemId) ?? null);
      if (!current
        || current.assignmentId !== event.failedAssignmentId
        || current.agentId !== event.fromAgentId
        || failure?.eventId !== event.failedCheckpointEventId
        || failure.assignmentId !== event.failedAssignmentId
        || failure.state !== "failed"
        || latestFact?.eventId !== failure.eventId) {
        throw new Error(
          `Rework ${event.reworkId} does not bind the current failed checkpoint and assignment.`,
        );
      }
      seenReworks.add(event.reworkId);
      seenAssignments.add(event.assignmentId);
      const assignment = {
        ...event,
        agentId: event.toAgentId,
        supersedesAssignmentId: event.failedAssignmentId,
        ref,
      };
      assignments.set(event.workItemId, assignment);
      assignmentHistory.get(event.workItemId).push(assignment);
      reworks.set(event.workItemId, { ...event, ref });
    } else if (event.type === "decision_opened") {
      if (seenDecisions.has(event.decisionId)) {
        throw new Error(`Duplicate decision_opened event for ${event.decisionId}.`);
      }
      seenDecisions.add(event.decisionId);
      decisions.set(event.decisionId, { opened: { ...event, ref }, resolved: null });
    } else if (event.type === "decision_resolved") {
      const decision = decisions.get(event.decisionId);
      if (!decision || decision.resolved) {
        throw new Error(`Decision ${event.decisionId} is not open.`);
      }
      decision.resolved = { ...event, ref };
    } else if (event.type === "integration_gate_passed") {
      gatePasses.set(event.gateId, { ...event, ref });
    } else if (event.type === "verification_deferred") {
      if (verifications.has(event.verificationId)) {
        throw new Error(`Duplicate deferred verification ${event.verificationId}.`);
      }
      if (gatePasses.has(event.dueGateId)) {
        throw new Error(
          `Deferred verification cannot target integration gate ${event.dueGateId}; gate already passed. `
          + "Create a successor project with project successor, or define a new unpassed gate before deferring.",
        );
      }
      verifications.set(event.verificationId, {
        deferred: { ...event, ref },
        closed: null,
      });
    } else if (event.type === "verification_closed") {
      const verification = verifications.get(event.verificationId);
      if (!verification || verification.closed) {
        throw new Error(`Deferred verification ${event.verificationId} is not open.`);
      }
      if (event.disposition === "no_longer_required") {
        for (const decisionId of event.decisionIds) {
          if (!decisions.get(decisionId)?.resolved) {
            throw new Error(
              `No-longer-required deferred verification requires resolved decision ${decisionId}.`,
            );
          }
        }
      }
      verification.closed = { ...event, ref };
    } else if (event.type === "data_candidate_recorded") {
      if (dataCandidates.some(row => row.candidateId === event.candidateId)) {
        throw new Error(`Duplicate data candidate ${event.candidateId}.`);
      }
      dataCandidates.push({ ...event, ref });
    } else if (event.type === "source_delivery_imported") {
      if (seenDeliveries.has(event.deliveryId)) {
        throw new Error(`Duplicate external source delivery ${event.deliveryId}.`);
      }
      const current = assignments.get(event.workItemId) ?? null;
      if (current?.assignmentId !== event.assignmentId) {
        throw new Error(
          `External source delivery ${event.deliveryId} does not bind the current assignment.`,
        );
      }
      const currentCheckpoint = checkpoints.get(event.workItemId) ?? null;
      if (currentCheckpoint?.assignmentId === current.assignmentId
        && ["completed", "failed"].includes(currentCheckpoint.state)) {
        throw new Error(
          `External source delivery ${event.deliveryId} cannot attach to terminal WorkItem truth.`,
        );
      }
      seenDeliveries.add(event.deliveryId);
      sourceDeliveries.push({ ...event, ref });
    } else if (event.type === "work_item_scope_revised") {
      if (seenScopeRevisions.has(event.revisionId)) {
        throw new Error(`Duplicate WorkItem scope revision ${event.revisionId}.`);
      }
      const baseWorkItem = definition.workItems.find(row => row.id === event.workItemId);
      const previous = scopeRevisions.get(event.workItemId) ?? null;
      const currentAssignment = assignments.get(event.workItemId) ?? null;
      const currentOwnedPaths = previous?.ownedPaths ?? baseWorkItem.ownedPaths;
      const currentMeasurable = previous
        ? previous.measurable
        : baseWorkItem.measurable ?? null;
      if (event.supersedesRevisionId !== previous?.revisionId) {
        throw new Error(
          `WorkItem scope revision ${event.revisionId} must supersede current revision ${previous?.revisionId ?? "none"}.`,
        );
      }
      if (canonical(event.previousOwnedPaths) !== canonical(currentOwnedPaths)
        || canonical(event.previousMeasurable) !== canonical(currentMeasurable)) {
        throw new Error(
          `WorkItem scope revision ${event.revisionId} does not bind the current scope.`,
        );
      }
      if (currentAssignment?.assignmentId !== event.assignmentId
        || currentAssignment.agentId !== event.ownerAgentId) {
        throw new Error(
          `WorkItem scope revision ${event.revisionId} does not bind the current assignment and owner.`,
        );
      }
      seenScopeRevisions.add(event.revisionId);
      const revision = { ...event, ref };
      scopeRevisions.set(event.workItemId, revision);
      scopeRevisionHistory.get(event.workItemId).push(revision);
    } else if (event.type === "upstream_reopened") {
      if (seenReopens.has(event.reopenId)) {
        throw new Error(`Duplicate upstream reopen ${event.reopenId}.`);
      }
      if (seenAssignments.has(event.assignmentId)) {
        throw new Error(`Duplicate assignmentId ${event.assignmentId}.`);
      }
      const current = assignments.get(event.workItemId) ?? null;
      const checkpoint = checkpoints.get(event.workItemId) ?? null;
      const affectedIds = downstreamWorkItemIds(
        definition,
        event.workItemId,
        { includeRoot: true },
      );
      if (!current
        || current.assignmentId !== event.previousAssignmentId
        || current.agentId !== event.fromAgentId
        || checkpoint?.eventId !== event.previousCheckpointEventId
        || checkpoint.assignmentId !== current.assignmentId
        || checkpoint.state !== "completed") {
        throw new Error(
          `Upstream reopen ${event.reopenId} does not bind the current completed WorkItem.`,
        );
      }
      if (!downstreamWorkItemIds(definition, event.workItemId)
        .includes(event.triggerWorkItemId)) {
        throw new Error(
          `Upstream reopen ${event.reopenId} trigger must be a transitive downstream WorkItem.`,
        );
      }
      const triggerAssignment = assignments.get(event.triggerWorkItemId) ?? null;
      if (triggerAssignment?.agentId !== event.reviewerAgentId) {
        throw new Error(
          `Upstream reopen ${event.reopenId} reviewer must own the trigger WorkItem.`,
        );
      }
      const invalidatedGate = definition.integrationGates.find(gate => (
        gatePasses.has(gate.id)
        && gate.requiredWorkItemIds.some(id => affectedIds.includes(id))
      ));
      if (invalidatedGate) {
        throw new Error(
          `Upstream reopen cannot invalidate passed integration gate ${invalidatedGate.id}.`,
        );
      }
      seenReopens.add(event.reopenId);
      seenAssignments.add(event.assignmentId);
      const assignment = {
        schemaVersion: EVENT_SCHEMA,
        eventId: `assignment-${event.assignmentId}`,
        type: "agent_assigned",
        occurredAt: event.occurredAt,
        assignmentId: event.assignmentId,
        supersedesAssignmentId: event.previousAssignmentId,
        workItemId: event.workItemId,
        agentId: event.toAgentId,
        ref: `${ref}#assignment`,
      };
      assignments.set(event.workItemId, assignment);
      assignmentHistory.get(event.workItemId).push(assignment);
      reopens.set(event.workItemId, { ...event, affectedWorkItemIds: affectedIds, ref });
    } else if (event.type === "responsibility_transferred") {
      if (seenTransfers.has(event.transferId)) {
        throw new Error(`Duplicate responsibility transfer ${event.transferId}.`);
      }
      if (seenAssignments.has(event.assignmentId)) {
        throw new Error(`Duplicate assignmentId ${event.assignmentId}.`);
      }
      for (const factId of [
        event.checkpointEventId,
        event.handoffEventId,
        event.assignmentEventId,
      ]) {
        if (seenFactIds.has(factId)) {
          throw new Error(`Duplicate responsibility transfer fact ID ${factId}.`);
        }
      }
      const current = assignments.get(event.workItemId) ?? null;
      const currentCheckpoint = checkpoints.get(event.workItemId) ?? null;
      const currentHandoff = handoffs.get(event.workItemId) ?? null;
      const latestCurrentFact = [
        currentCheckpoint,
        currentHandoff,
        reworks.get(event.workItemId) ?? null,
        reopens.get(event.workItemId) ?? null,
        transfers.get(event.workItemId) ?? null,
        sourceDeliveries.filter(row => row.workItemId === event.workItemId).at(-1) ?? null,
      ].reduce((latest, fact) => latestEventFact(latest, fact), null);
      if (!current
        || current.assignmentId !== event.previousAssignmentId
        || current.agentId !== event.fromAgentId) {
        throw new Error(
          `Responsibility transfer ${event.transferId} does not bind the current assignment.`,
        );
      }
      if (currentCheckpoint?.assignmentId === current.assignmentId
        && ["completed", "failed"].includes(currentCheckpoint.state)) {
        throw new Error("Responsibility transfer cannot target a terminal WorkItem.");
      }
      if (currentHandoff?.assignmentId === current.assignmentId
        && currentHandoff.fromAgentId === current.agentId
        && latestCurrentFact?.eventId === currentHandoff.eventId) {
        throw new Error("Responsibility transfer cannot replace a pending handoff.");
      }
      const checkpoint = {
        schemaVersion: EVENT_SCHEMA,
        eventId: event.checkpointEventId,
        type: "checkpoint_recorded",
        occurredAt: event.occurredAt,
        assignmentId: event.previousAssignmentId,
        workItemId: event.workItemId,
        state: event.state,
        summary: event.summary,
        ...(event.completedUnits === undefined ? {} : { completedUnits: event.completedUnits }),
        evidenceRefs: [...event.evidenceRefs],
        blockerRefs: [...event.blockerRefs],
        decisionRefs: [...event.decisionRefs],
        nextAction: event.nextAction,
        ...(event.sourceFingerprint === undefined
          ? {}
          : { sourceFingerprint: event.sourceFingerprint }),
        ref: `${ref}#checkpoint`,
      };
      const handoff = {
        schemaVersion: EVENT_SCHEMA,
        eventId: event.handoffEventId,
        type: "handoff_recorded",
        occurredAt: event.occurredAt,
        assignmentId: event.previousAssignmentId,
        workItemId: event.workItemId,
        fromAgentId: event.fromAgentId,
        toAgentId: event.toAgentId,
        summary: event.summary,
        evidenceRefs: [...event.evidenceRefs],
        nextAction: event.nextAction,
        ref: `${ref}#handoff`,
      };
      const assignment = {
        schemaVersion: EVENT_SCHEMA,
        eventId: event.assignmentEventId,
        type: "agent_assigned",
        occurredAt: event.occurredAt,
        assignmentId: event.assignmentId,
        supersedesAssignmentId: event.previousAssignmentId,
        workItemId: event.workItemId,
        agentId: event.toAgentId,
        ref: `${ref}#assignment`,
      };
      for (const factId of [
        event.checkpointEventId,
        event.handoffEventId,
        event.assignmentEventId,
      ]) seenFactIds.add(factId);
      seenTransfers.add(event.transferId);
      seenAssignments.add(event.assignmentId);
      checkpoints.set(event.workItemId, checkpoint);
      handoffs.set(event.workItemId, handoff);
      assignments.set(event.workItemId, assignment);
      assignmentHistory.get(event.workItemId).push(assignment);
      transfers.set(event.workItemId, { ...event, ref });
    } else if (event.type === "external_gate_reconciled") {
      if (seenExternalGateReconciliations.has(event.reconciliationId)) {
        throw new Error(`Duplicate external Gate reconciliation ${event.reconciliationId}.`);
      }
      const previous = externalGates.get(event.gateId) ?? null;
      if (event.supersedesReconciliationId !== previous?.reconciliationId) {
        throw new Error(
          `External Gate ${event.gateId} must supersede current reconciliation `
          + `${previous?.reconciliationId ?? "none"}.`,
        );
      }
      if (previous && previous.requiredFor !== event.requiredFor) {
        throw new Error(
          `External Gate ${event.gateId} cannot change required delivery stage.`,
        );
      }
      seenExternalGateReconciliations.add(event.reconciliationId);
      externalGates.set(event.gateId, { ...event, ref });
    } else if (event.type === "delivery_lifecycle_recorded") {
      if (seenDeliveryRecords.has(event.recordId)) {
        throw new Error(`Duplicate delivery lifecycle record ${event.recordId}.`);
      }
      const previous = deliveryRecords.get(event.stage) ?? null;
      if (event.supersedesRecordId !== previous?.recordId) {
        throw new Error(
          `Delivery stage ${event.stage} must supersede current record `
          + `${previous?.recordId ?? "none"}.`,
        );
      }
      const stageIndex = DELIVERY_STAGES.indexOf(event.stage);
      const downstream = DELIVERY_STAGES.slice(stageIndex + 1)
        .find(stage => deliveryRecords.has(stage));
      if (downstream) {
        throw new Error(
          `Delivery stage ${event.stage} cannot change after downstream delivery truth already exists.`,
        );
      }
      const decisionsResolved = [...decisions.values()].every(row => row.resolved !== null);
      const stateSnapshot = {
        checkpoints,
        reopens,
        scopeRevisions,
      };
      if (completedWorkItemIds(definition, stateSnapshot).size !== definition.workItems.length
        || gatePasses.size !== definition.integrationGates.length
        || !decisionsResolved) {
        throw new Error("Delivery lifecycle requires a completed Project Driver work ledger.");
      }
      if (stageIndex > 0) {
        const prerequisiteStage = DELIVERY_STAGES[stageIndex - 1];
        const prerequisite = deliveryRecords.get(prerequisiteStage) ?? null;
        const requiredOutcome = DELIVERY_POSITIVE_OUTCOME[prerequisiteStage];
        if (prerequisite?.stageStatus !== requiredOutcome) {
          throw new Error(
            `Delivery stage ${event.stage} requires ${prerequisiteStage}=${requiredOutcome}.`,
          );
        }
      }
      const requiredGates = [...externalGates.values()]
        .filter(gate => gate.requiredFor === event.stage)
        .sort((left, right) => compareIdentifiers(left.gateId, right.gateId));
      const unresolvedGate = requiredGates.find(gate => gate.gateStatus !== "passed");
      if (unresolvedGate) {
        throw new Error(
          `Delivery stage ${event.stage} external Gate ${unresolvedGate.gateId} is `
          + `${unresolvedGate.gateStatus}.`,
        );
      }
      const requiredGateIds = requiredGates.map(gate => gate.gateId);
      if (canonical(event.externalGateIds) !== canonical(requiredGateIds)) {
        throw new Error(
          `Delivery stage ${event.stage} must bind passed external Gates: `
          + `${requiredGateIds.join(", ") || "none"}.`,
        );
      }
      seenDeliveryRecords.add(event.recordId);
      deliveryRecords.set(event.stage, { ...event, ref });
    } else if (event.type === "work_item_evidence_requirement_set") {
      if (seenEvidencePolicies.has(event.policyId)) {
        throw new Error(`Duplicate WorkItem evidence policy ${event.policyId}.`);
      }
      const current = evidenceRequirements.get(event.workItemId) ?? null;
      if (event.supersedesPolicyId !== current?.policyId) {
        throw new Error(
          `WorkItem ${event.workItemId} evidence policy must supersede `
          + `${current?.policyId ?? "none"}.`,
        );
      }
      const assignment = assignments.get(event.workItemId) ?? null;
      if (assignment?.agentId !== event.ownerAgentId) {
        throw new Error("WorkItem evidence policy must bind the current owner.");
      }
      const checkpoint = checkpoints.get(event.workItemId) ?? null;
      if (checkpoint && ["completed", "failed"].includes(checkpoint.state)) {
        throw new Error("WorkItem evidence policy cannot change terminal WorkItem truth.");
      }
      seenEvidencePolicies.add(event.policyId);
      evidenceRequirements.set(event.workItemId, { ...event, ref });
    } else if (event.type === "checkpoint_receipt_bound") {
      if (seenReceiptBindings.has(event.checkpointId)) {
        throw new Error(`Duplicate receipt-bound checkpoint ${event.checkpointId}.`);
      }
      const current = assignments.get(event.workItemId) ?? null;
      if (current?.assignmentId !== event.assignmentId) {
        throw new Error("Receipt-bound checkpoint must bind the current assignment.");
      }
      seenReceiptBindings.add(event.checkpointId);
      const checkpoint = {
        ...event,
        type: "checkpoint_recorded",
        evidenceRefs: uniqueSorted([
          ...event.evidenceRefs,
          event.receiptBinding.receiptRef,
        ]),
        ref,
      };
      checkpoints.set(event.workItemId, checkpoint);
      receiptBindings.set(event.workItemId, {
        ...structuredClone(event.receiptBinding),
        checkpointId: event.checkpointId,
        assignmentId: event.assignmentId,
        occurredAt: event.occurredAt,
        truthRef: ref,
      });
    }
  }
  return {
    assignments,
    assignmentHistory,
    checkpoints,
    handoffs,
    reworks,
    reopens,
    transfers,
    decisions,
    gatePasses,
    verifications,
    dataCandidates,
    sourceDeliveries,
    scopeRevisions,
    scopeRevisionHistory,
    externalGates,
    deliveryRecords,
    evidenceRequirements,
    receiptBindings,
  };
}

function definitionWithScopeRevisions(definition, state) {
  return {
    ...definition,
    workItems: definition.workItems.map((item) => {
      const revision = state.scopeRevisions.get(item.id) ?? null;
      if (!revision) return item;
      const { measurable: _baseMeasurable, ...base } = item;
      return {
        ...base,
        ownedPaths: [...revision.ownedPaths],
        ...(revision.measurable === null
          ? {}
          : { measurable: structuredClone(revision.measurable) }),
      };
    }),
  };
}

function executionTruthFor(workspaceRoot, assignment) {
  if (!assignment?.executionRunId) return null;
  if (!workspaceRoot
    || !existsSync(path.join(workspaceRoot, ".owlcoda/runkit/executions"))) {
    return {
      status: "missing",
      runId: assignment.executionRunId,
      lifecycle: null,
      closeoutDecision: null,
      closeoutTrusted: false,
      leaseState: "missing",
      leaseWorkItemId: assignment.executionWorkItemId,
      issues: ["execution_not_found"],
    };
  }
  const control = inspectProjectControlState({ workspaceRoot });
  const execution = control.executions.find(row => row.runId === assignment.executionRunId);
  if (!execution) {
    return {
      status: "missing",
      runId: assignment.executionRunId,
      lifecycle: null,
      closeoutDecision: null,
      closeoutTrusted: false,
      leaseState: "missing",
      leaseWorkItemId: assignment.executionWorkItemId,
      issues: ["execution_not_found"],
    };
  }
  const lease = execution.lease;
  let leaseState = "missing";
  if (lease.activeWorkItemIds.includes(assignment.executionWorkItemId)) leaseState = "active";
  else if (lease.releasedWorkItemIds.includes(assignment.executionWorkItemId)) leaseState = "released";
  else if (lease.preservedInactiveWorkItemIds.includes(assignment.executionWorkItemId)) leaseState = "preserved_inactive";
  const issues = [
    ...execution.issues,
    ...lease.issues,
    ...(leaseState === "missing" ? ["execution_lease_work_item_missing"] : []),
  ];
  return {
    status: issues.length === 0 ? "bound" : "invalid",
    runId: assignment.executionRunId,
    lifecycle: execution.lifecycle,
    closeoutDecision: execution.closeout?.decision ?? null,
    closeoutTrusted: execution.closeout?.trusted === true,
    leaseState,
    leaseWorkItemId: assignment.executionWorkItemId,
    issues,
  };
}

function compareIdentifiers(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareIdentifiers);
}

function sortWorkItemIds(ids, priority) {
  return [...new Set(ids)].sort((left, right) => (
    (priority.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (priority.get(right) ?? Number.MAX_SAFE_INTEGER)
    || compareIdentifiers(left, right)
  ));
}

function dominantGapCandidateOrder(status) {
  const byId = new Map(status.workItems.map(row => [row.workItemId, row]));
  const failed = status.workItems
    .filter(row => row.status === "failed")
    .map(row => row.workItemId)
    .sort(compareIdentifiers);
  const failedIds = new Set(failed);
  const critical = status.criticalWorkItems
    .filter(workItemId => (
      byId.get(workItemId)?.status !== "completed"
      && !failedIds.has(workItemId)
    ));
  const criticalIds = new Set([...failed, ...critical]);
  const remaining = status.workItems
    .filter(row => row.status !== "completed" && !criticalIds.has(row.workItemId))
    .map(row => row.workItemId)
    .sort(compareIdentifiers);
  return [...failed, ...critical, ...remaining];
}

function unresolvedRootWorkItemIds(workItemId, byId, priority, visiting = new Set()) {
  const row = byId.get(workItemId);
  if (!row || visiting.has(workItemId)) return [workItemId];
  const nextVisiting = new Set(visiting).add(workItemId);
  const unresolved = row.unresolvedDependencies.filter(id => byId.has(id));
  if (unresolved.length === 0) return [workItemId];
  return sortWorkItemIds(
    unresolved.flatMap(id => unresolvedRootWorkItemIds(id, byId, priority, nextVisiting)),
    priority,
  );
}

function openDecisionsForWorkItem(row, openDecisions) {
  const decisionRefs = new Set([
    ...row.decisionRefs,
    ...row.blockers
      .filter(ref => ref.startsWith("decision:"))
      .map(ref => ref.slice("decision:".length)),
  ]);
  return openDecisions
    .filter(decision => (
      decisionRefs.has(decision.decisionId)
      || decision.blockingWorkItemIds.includes(row.workItemId)
    ))
    .sort((left, right) => compareIdentifiers(left.decisionId, right.decisionId));
}

function workItemGapReason(row) {
  if (row.status === "failed") {
    return row.summary
      ?? (row.executionTruth?.issues?.length > 0 ? "Execution truth is invalid." : null)
      ?? "Work item failed.";
  }
  return row.blockers.length > 0 ? row.summary ?? "Work item is blocked." : null;
}

function nextActionForGap(gap, status) {
  if (gap.kind === "decision") {
    return { action: `Resolve ${gap.id}`, actorId: gap.agentId };
  }
  if (gap.kind === "deferred_verification") {
    return { action: `Run deferred verification ${gap.id}`, actorId: gap.agentId };
  }
  if (gap.kind === "integration_gate") {
    return { action: `Review integration gate ${gap.id}`, actorId: null };
  }
  if (gap.kind === "none") return { action: null, actorId: null };

  const workItem = status.workItems.find(row => row.workItemId === gap.workItemId);
  if (workItem?.pendingHandoff) {
    return {
      action: `Accept handoff ${gap.workItemId}`,
      actorId: workItem.pendingHandoff.toAgentId,
    };
  }
  if (!workItem?.agentId) return { action: `Assign ${gap.workItemId}`, actorId: null };
  if (workItem.nextAction) {
    return { action: workItem.nextAction, actorId: workItem.agentId };
  }
  if (workItem.status === "failed") {
    return { action: `Rework ${gap.workItemId}`, actorId: workItem.agentId };
  }
  if (workItem.status === "verifying") {
    return { action: `Verify ${gap.workItemId}`, actorId: workItem.agentId };
  }
  if (workItem.status === "ready_to_integrate") {
    return { action: `Integrate ${gap.workItemId}`, actorId: workItem.agentId };
  }
  return { action: `Continue ${gap.workItemId}.`, actorId: workItem.agentId };
}

function singleLine(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function gapLabel(gap) {
  if (gap.kind === "none") return "none";
  if (gap.kind === "decision") return `decision ${gap.id} (${gap.title})`;
  if (gap.kind === "deferred_verification") {
    return `deferred verification ${gap.id}`;
  }
  if (gap.kind === "failed_work") return `failed work ${gap.workItemId} (${gap.title})`;
  if (gap.kind === "work_item") return `work item ${gap.workItemId} (${gap.title})`;
  return `integration gate ${gap.id} (${gap.title})`;
}

function buildProjectHeadline(gap, next) {
  const owner = gap.agentId ?? next.actorId ?? "unassigned";
  const blocker = gap.reason ?? "none";
  const action = next.action ?? "none";
  const normalizedAction = singleLine(action);
  const actionTerminator = /[.!?。！？]$/u.test(normalizedAction) ? "" : ".";
  return `Dominant gap: ${singleLine(gapLabel(gap))}; owner: ${singleLine(owner)}; `
    + `blocker: ${singleLine(blocker)}; next: ${normalizedAction}${actionTerminator}`;
}

function deriveProjectDriverSummary(status) {
  const byId = new Map(status.workItems.map(row => [row.workItemId, row]));
  const priority = new Map(
    dominantGapCandidateOrder(status).map((workItemId, index) => [workItemId, index]),
  );
  let gap = null;

  for (const candidateId of dominantGapCandidateOrder(status)) {
    const rootId = unresolvedRootWorkItemIds(candidateId, byId, priority)[0];
    const root = byId.get(rootId);
    if (!root) continue;
    if (root.pendingHandoff) {
      gap = {
        kind: "work_item",
        id: root.workItemId,
        title: root.title,
        workItemId: root.workItemId,
        agentId: root.pendingHandoff.toAgentId,
        reason: root.pendingHandoff.summary,
        truthRefs: uniqueSorted(root.truthRefs),
      };
    } else if (openDecisionsForWorkItem(root, status.openDecisions).length > 0) {
      const decisions = openDecisionsForWorkItem(root, status.openDecisions);
      const decision = decisions[0];
      gap = {
        kind: "decision",
        id: decision.decisionId,
        title: decision.title,
        workItemId: root.workItemId,
        agentId: decision.ownerAgentId,
        reason: decision.question,
        truthRefs: uniqueSorted([...decision.truthRefs, ...root.truthRefs]),
      };
    } else {
      gap = {
        kind: root.status === "failed" ? "failed_work" : "work_item",
        id: root.workItemId,
        title: root.title,
        workItemId: root.workItemId,
        agentId: root.agentId,
        reason: workItemGapReason(root),
        truthRefs: uniqueSorted(root.truthRefs),
      };
    }
    break;
  }

  if (!gap && status.workItems.every(row => row.status === "completed")) {
    const firstUnpassedGate = status.integrationGates
      .find(gate => gate.status !== "passed") ?? null;
    const gateDecisions = firstUnpassedGate
      ? status.openDecisions
        .filter(decision => firstUnpassedGate.unresolvedDecisionIds.includes(decision.decisionId))
        .sort((left, right) => compareIdentifiers(left.decisionId, right.decisionId))
      : [];
    if (gateDecisions.length > 0) {
      const decision = gateDecisions[0];
      gap = {
        kind: "decision",
        id: decision.decisionId,
        title: decision.title,
        workItemId: null,
        agentId: decision.ownerAgentId,
        reason: decision.question,
        truthRefs: uniqueSorted([...decision.truthRefs, ...firstUnpassedGate.truthRefs]),
      };
    } else if (firstUnpassedGate?.unresolvedVerificationIds.length > 0) {
      const verification = status.deferredVerifications.find(row => (
        row.verificationId === firstUnpassedGate.unresolvedVerificationIds[0]
      ));
      gap = {
        kind: "deferred_verification",
        id: verification.verificationId,
        title: `Deferred verification ${verification.verificationId}`,
        workItemId: verification.workItemId,
        agentId: verification.ownerAgentId,
        reason: verification.reason,
        truthRefs: uniqueSorted([
          ...verification.truthRefs,
          ...firstUnpassedGate.truthRefs,
        ]),
      };
    } else if (firstUnpassedGate) {
      gap = {
        kind: "integration_gate",
        id: firstUnpassedGate.gateId,
        title: firstUnpassedGate.title,
        workItemId: null,
        agentId: null,
        reason: "Integration gate has not passed.",
        truthRefs: uniqueSorted(firstUnpassedGate.truthRefs),
      };
    } else if (status.openDecisions.length > 0) {
      const decision = status.openDecisions[0];
      gap = {
        kind: "decision",
        id: decision.decisionId,
        title: decision.title,
        workItemId: null,
        agentId: decision.ownerAgentId,
        reason: decision.question,
        truthRefs: uniqueSorted(decision.truthRefs),
      };
    }
  }

  if (!gap) {
    gap = {
      kind: "none",
      id: null,
      title: null,
      workItemId: null,
      agentId: null,
      reason: null,
      truthRefs: uniqueSorted([
        "project/definition.json",
        ...status.integrationGates.flatMap(gate => gate.truthRefs),
      ]),
    };
  }

  const next = nextActionForGap(gap, status);
  return {
    headline: buildProjectHeadline(gap, next),
    dominantGap: gap,
    nextAction: next.action,
    nextActorId: next.actorId,
  };
}

function affectingReopensForWorkItem(state, workItemId) {
  return [...state.reopens.values()]
    .filter(reopen => reopen.affectedWorkItemIds.includes(workItemId))
    .sort(compareEventFacts);
}

function invalidatingReopensForWorkItem(state, workItemId) {
  const checkpoint = state.checkpoints.get(workItemId) ?? null;
  return affectingReopensForWorkItem(state, workItemId).filter(reopen => (
    checkpoint?.state !== "completed" || compareEventFacts(checkpoint, reopen) <= 0
  ));
}

function completedWorkItemIds(definition, state) {
  const completed = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of definition.workItems) {
      if (completed.has(item.id)) continue;
      const checkpoint = state.checkpoints.get(item.id) ?? null;
      const scopeRevision = state.scopeRevisions.get(item.id) ?? null;
      if (checkpoint?.state !== "completed"
        || (scopeRevision && compareEventFacts(checkpoint, scopeRevision) <= 0)
        || invalidatingReopensForWorkItem(state, item.id).length > 0
        || item.dependencies.some(id => !completed.has(id))) continue;
      completed.add(item.id);
      changed = true;
    }
  }
  return completed;
}

function hasBoundVerificationReceipt(evidenceRefs) {
  return evidenceRefs.some(ref => (
    /(?:quick[^\s]*receipt|receipt[^\s]*quick|formal[^\s]*(?:receipt|check|closeout)|(?:receipt|check|closeout)[^\s]*formal|closeout-receipt)/iu
      .test(ref)
  ));
}

function verificationReceiptWarning(workItem) {
  if (!["verifying", "completed"].includes(workItem.status)
    || hasBoundVerificationReceipt(workItem.evidenceRefs)) return null;
  return {
    code: "no_bound_verification_receipt",
    workItemId: workItem.workItemId,
    message: "No Quick or Formal receipt reference is bound to the current verification state.",
    truthRefs: uniqueSorted(workItem.truthRefs),
  };
}

function externalGateProjection(gate) {
  return {
    schemaVersion: "OwlCodaRunKitExternalGateV1",
    gateId: gate.gateId,
    title: gate.title,
    requiredFor: gate.requiredFor,
    gateStatus: gate.gateStatus,
    blocking: gate.gateStatus !== "passed",
    ownerAgentId: gate.ownerAgentId,
    source: {
      adapterId: gate.sourceAdapterId,
      ref: gate.sourceRef,
      sha256: gate.sourceSha256,
    },
    summary: gate.summary,
    evidenceRefs: [...gate.evidenceRefs],
    occurredAt: gate.occurredAt,
    truthRefs: [gate.ref],
    authorizationGranted: false,
  };
}

function deliveryLifecycleProjection(overall, state) {
  const stages = DELIVERY_STAGES.map((stage) => {
    const record = state.deliveryRecords.get(stage) ?? null;
    return {
      stage,
      status: record?.stageStatus ?? "pending",
      recordId: record?.recordId ?? null,
      ownerAgentId: record?.ownerAgentId ?? null,
      summary: record?.summary ?? null,
      evidenceRefs: [...(record?.evidenceRefs ?? [])],
      externalGateIds: [...(record?.externalGateIds ?? [])],
      occurredAt: record?.occurredAt ?? null,
      truthRef: record?.ref ?? null,
    };
  });
  let currentStage = overall === "completed"
    ? "work_ledger_complete"
    : "work_ledger_incomplete";
  let nextRequiredStage = overall === "completed" ? DELIVERY_STAGES[0] : null;
  let blockingStage = null;
  if (overall === "completed") {
    const projectedNames = {
      source: "source_accepted",
      integration: "integrated",
      materialization: "materialized",
      deployment: "deployed",
      live_readback: "live_readback_passed",
      product_acceptance: "product_accepted",
    };
    for (const stage of stages) {
      if (stage.status === "pending") {
        nextRequiredStage = stage.stage;
        break;
      }
      if (stage.status !== DELIVERY_POSITIVE_OUTCOME[stage.stage]) {
        blockingStage = stage.stage;
        nextRequiredStage = stage.stage;
        break;
      }
      currentStage = projectedNames[stage.stage];
      nextRequiredStage = stage.stage === DELIVERY_STAGES.at(-1)
        ? null
        : DELIVERY_STAGES[DELIVERY_STAGES.indexOf(stage.stage) + 1];
    }
  }
  const unresolvedGates = [...state.externalGates.values()]
    .filter(gate => gate.gateStatus !== "passed")
    .sort((left, right) => (
      DELIVERY_STAGES.indexOf(left.requiredFor) - DELIVERY_STAGES.indexOf(right.requiredFor)
      || compareIdentifiers(left.gateId, right.gateId)
    ));
  const nextStageIndex = nextRequiredStage === null
    ? DELIVERY_STAGES.length
    : DELIVERY_STAGES.indexOf(nextRequiredStage);
  const blockingExternalGateIds = unresolvedGates
    .filter(gate => DELIVERY_STAGES.indexOf(gate.requiredFor) <= nextStageIndex)
    .map(gate => gate.gateId);
  const lifecycleStatus = currentStage === "product_accepted"
    && blockingExternalGateIds.length === 0
    ? "completed"
    : blockingStage !== null || blockingExternalGateIds.length > 0
      ? "blocked"
      : "in_progress";
  return {
    schemaVersion: "OwlCodaRunKitDeliveryLifecycleV1",
    lifecycleStatus,
    currentStage,
    nextRequiredStage,
    blockingStage,
    blockingExternalGateIds,
    stages,
    authorizationGranted: false,
  };
}

function projectStatus(definition, records, workspaceRoot = null) {
  const projectDefinition = definition;
  const state = projectEvents(definition, records);
  definition = definitionWithScopeRevisions(definition, state);
  const completed = completedWorkItemIds(definition, state);
  let workItems = definition.workItems.map((item) => {
    const assignment = state.assignments.get(item.id) ?? null;
    const checkpoint = state.checkpoints.get(item.id) ?? null;
    const handoff = state.handoffs.get(item.id) ?? null;
    const rework = state.reworks.get(item.id) ?? null;
    const sourceDeliveries = state.sourceDeliveries.filter(row => row.workItemId === item.id);
    const scopeRevisionHistory = state.scopeRevisionHistory.get(item.id) ?? [];
    const evidenceRequirementFact = state.evidenceRequirements.get(item.id) ?? null;
    const receiptBindingFact = state.receiptBindings.get(item.id) ?? null;
    const latestScopeRevision = scopeRevisionHistory.at(-1) ?? null;
    const latestSourceDeliveryFact = sourceDeliveries.at(-1) ?? null;
    const latestSourceDelivery = sourceDeliveryProjection(sourceDeliveries.at(-1) ?? null);
    const currentRework = rework?.assignmentId === assignment?.assignmentId ? rework : null;
    const reopenFacts = affectingReopensForWorkItem(state, item.id);
    const invalidatingReopens = invalidatingReopensForWorkItem(state, item.id);
    const currentReopen = state.reopens.get(item.id)?.assignmentId === assignment?.assignmentId
      ? state.reopens.get(item.id)
      : null;
    const currentTransfer = state.transfers.get(item.id)?.assignmentId === assignment?.assignmentId
      ? state.transfers.get(item.id)
      : null;
    const scopeInvalidatesCheckpoint = checkpoint && latestScopeRevision
      && compareEventFacts(checkpoint, latestScopeRevision) <= 0;
    const effectiveCheckpoint = invalidatingReopens.length === 0 && !scopeInvalidatesCheckpoint
      ? checkpoint
      : null;
    let latestFact = [
      effectiveCheckpoint,
      handoff,
      currentRework,
      currentReopen,
      currentTransfer,
      latestScopeRevision,
    ]
      .reduce((latest, fact) => latestEventFact(latest, fact), null);
    if (currentTransfer && latestFact?.occurredAt === currentTransfer.occurredAt) {
      latestFact = currentTransfer;
    }
    const activeHandoff = handoff
      && handoff.assignmentId === assignment?.assignmentId
      && handoff.fromAgentId === assignment?.agentId
      ? handoff
      : null;
    const latestHandoffFact = latestEventFact(activeHandoff, latestSourceDeliveryFact);
    const handoffSupersededByDelivery = activeHandoff
      && latestFact?.eventId === activeHandoff.eventId
      && latestHandoffFact?.eventId !== activeHandoff.eventId;
    const projectedFact = handoffSupersededByDelivery
      ? [
          effectiveCheckpoint,
          currentRework,
          currentReopen,
          currentTransfer,
          latestScopeRevision,
        ]
        .reduce((latest, fact) => latestEventFact(latest, fact), null)
      : latestFact;
    const pendingHandoff = activeHandoff
      && latestFact?.eventId === activeHandoff.eventId
      && latestHandoffFact?.eventId === activeHandoff.eventId
      ? pendingHandoffProjection(activeHandoff)
      : null;
    const executionTruth = executionTruthFor(workspaceRoot, assignment);
    const unresolvedDependencies = item.dependencies.filter(id => !completed.has(id));
    let status = "planned";
    if (assignment) status = unresolvedDependencies.length > 0 ? "waiting_dependency" : "active";
    if (pendingHandoff) status = "planned";
    if (projectedFact?.type === "checkpoint_recorded") status = effectiveCheckpoint.state;
    if (projectedFact?.type === "responsibility_transferred") status = projectedFact.state;
    if (projectedFact?.type === "upstream_reopened") status = "active";
    if (projectedFact?.type === "work_item_scope_revised") status = "active";
    if (assignment && unresolvedDependencies.length > 0
      && !["completed", "failed"].includes(status)) status = "waiting_dependency";
    if (executionTruth && (executionTruth.status !== "bound"
      || (executionTruth.lifecycle === "closed"
        && executionTruth.closeoutDecision !== "accepted"))) {
      status = "failed";
    }
    const measured = item.measurable
      ? {
          kind: "measured_units",
          unit: item.measurable.unit,
          completed: effectiveCheckpoint?.completedUnits ?? 0,
          total: item.measurable.total,
        }
      : { kind: "state_only" };
    const assignmentEvents = state.assignmentHistory.get(item.id);
    const history = assignmentEvents.map(row => ({
      assignmentId: row.assignmentId,
      agentId: row.agentId,
      occurredAt: row.occurredAt,
      supersedesAssignmentId: row.supersedesAssignmentId ?? null,
      executionRunId: row.executionRunId ?? null,
      truthRef: row.ref,
    }));
    const truthRefs = [
      "project/definition.json",
      ...history.map(row => row.truthRef),
      ...(checkpoint ? [checkpoint.ref] : []),
      ...(handoff ? [handoff.ref] : []),
      ...(rework ? [rework.ref] : []),
      ...reopenFacts.map(row => row.ref),
      ...(currentTransfer ? [currentTransfer.ref] : []),
      ...sourceDeliveries.map(row => row.ref),
      ...scopeRevisionHistory.map(row => row.ref),
      ...(evidenceRequirementFact ? [evidenceRequirementFact.ref] : []),
    ];
    const projectedRework = reworkProjection(
      currentRework,
      currentRework
        ? assignmentEvents.findIndex(row => row.assignmentId === currentRework.assignmentId) + 1
        : null,
    );
    const latestSummary = [
      "rework_returned",
      "upstream_reopened",
      "work_item_scope_revised",
    ].includes(projectedFact?.type)
      ? projectedFact.reason
      : projectedFact?.summary ?? null;
    const checkpointLikeFact = ["checkpoint_recorded", "responsibility_transferred"]
      .includes(projectedFact?.type)
      ? projectedFact
      : null;
    return {
      workItemId: item.id,
      title: item.title,
      milestoneId: item.milestoneId,
      workstreamId: item.workstreamId,
      status,
      agentId: assignment?.agentId ?? null,
      assignmentId: assignment?.assignmentId ?? null,
      executionRunId: assignment?.executionRunId ?? null,
      executionWorkItemId: assignment?.executionWorkItemId ?? null,
      executionTruth,
      dependencies: [...item.dependencies],
      unresolvedDependencies,
      blockers: checkpointLikeFact
        ? checkpointLikeFact.blockerRefs
        : unresolvedDependencies.map(id => `work-item:${id}`),
      decisionRefs: checkpointLikeFact ? checkpointLikeFact.decisionRefs : [],
      progress: measured,
      ownedPaths: [...item.ownedPaths],
      measurable: item.measurable ? structuredClone(item.measurable) : null,
      scopeRevision: latestScopeRevision
        ? {
            revisionId: latestScopeRevision.revisionId,
            supersedesRevisionId: latestScopeRevision.supersedesRevisionId ?? null,
            occurredAt: latestScopeRevision.occurredAt,
            ownerAgentId: latestScopeRevision.ownerAgentId,
            reason: latestScopeRevision.reason,
            evidenceRefs: [...latestScopeRevision.evidenceRefs],
            truthRef: latestScopeRevision.ref,
          }
        : null,
      summary: latestSummary,
      nextAction: projectedFact?.nextAction ?? null,
      pendingHandoff,
      rework: projectedRework,
      latestSourceDelivery,
      evidenceRequirement: evidenceRequirementFact
        ? {
            policyId: evidenceRequirementFact.policyId,
            requirement: evidenceRequirementFact.requirement,
            ownerAgentId: evidenceRequirementFact.ownerAgentId,
            reason: evidenceRequirementFact.reason,
            evidenceRefs: [...evidenceRequirementFact.evidenceRefs],
            occurredAt: evidenceRequirementFact.occurredAt,
            truthRef: evidenceRequirementFact.ref,
          }
        : {
            policyId: null,
            requirement: "none",
            ownerAgentId: null,
            reason: null,
            evidenceRefs: [],
            occurredAt: null,
            truthRef: null,
          },
      boundVerificationReceipt: receiptBindingFact !== null
        && receiptBindingFact.assignmentId === assignment?.assignmentId
        && effectiveCheckpoint?.checkpointId === receiptBindingFact.checkpointId
        ? structuredClone(receiptBindingFact)
        : null,
      lastCheckpointAt: checkpoint?.occurredAt ?? null,
      evidenceRefs: projectedFact?.evidenceRefs ?? [],
      assignmentHistory: history,
      truthRefs,
      ...(reopenFacts.length === 0
        ? {}
        : { invalidatedByReopenIds: invalidatingReopens.map(row => row.reopenId) }),
    };
  });
  const openDecisions = [...state.decisions.values()]
    .filter(row => row.resolved === null)
    .map(row => ({
      decisionId: row.opened.decisionId,
      title: row.opened.title,
      question: row.opened.question,
      ownerAgentId: row.opened.ownerAgentId,
      blockingWorkItemIds: [...row.opened.blockingWorkItemIds],
      options: [...row.opened.options],
      truthRefs: [row.opened.ref],
    }))
    .sort((left, right) => left.decisionId.localeCompare(right.decisionId));
  const openDecisionIds = new Set(openDecisions.map(row => row.decisionId));
  workItems = workItems.map((row) => {
    const terminal = ["completed", "failed"].includes(row.status);
    const currentDecisionIds = terminal
      ? []
      : openDecisionsForWorkItem(row, openDecisions).map(decision => decision.decisionId);
    const checkpointDecisionIds = uniqueSorted([
      ...row.decisionRefs,
      ...row.blockers
        .filter(ref => ref.startsWith("decision:"))
        .map(ref => ref.slice("decision:".length)),
    ]);
    const staleDecisionRefs = checkpointDecisionIds.filter(id => !openDecisionIds.has(id));
    const currentBlockers = row.blockers.filter(ref => (
      !ref.startsWith("decision:") || openDecisionIds.has(ref.slice("decision:".length))
    ));
    for (const decisionId of currentDecisionIds) {
      const blockerRef = `decision:${decisionId}`;
      if (!currentBlockers.includes(blockerRef)) currentBlockers.push(blockerRef);
    }
    const underlyingStatus = row.assignmentId === null
      ? "planned"
      : row.unresolvedDependencies.length > 0 ? "waiting_dependency" : "active";
    let status = row.status;
    if (!row.pendingHandoff && !terminal) {
      status = currentDecisionIds.length > 0
        ? "waiting_decision"
        : row.status === "waiting_decision" ? underlyingStatus : row.status;
    }
    return {
      ...row,
      status,
      blockers: currentBlockers,
      decisionRefs: row.decisionRefs.filter(id => openDecisionIds.has(id)),
      summary: staleDecisionRefs.length > 0 ? null : row.summary,
      nextAction: staleDecisionRefs.length > 0 ? null : row.nextAction,
    };
  });
  const byId = new Map(workItems.map(row => [row.workItemId, row]));
  const resolvedDecisions = [...state.decisions.values()]
    .filter(row => row.resolved !== null)
    .map(row => ({
      decisionId: row.opened.decisionId,
      resolution: row.resolved.resolution,
      rationale: row.resolved.rationale,
      evidenceRefs: [...row.resolved.evidenceRefs],
      truthRefs: [row.opened.ref, row.resolved.ref],
    }))
    .sort((left, right) => left.decisionId.localeCompare(right.decisionId));
  const resolvedDecisionIds = new Set(resolvedDecisions.map(row => row.decisionId));
  const gateOrder = new Map(
    definition.integrationGates.map((gate, index) => [gate.id, index]),
  );
  const deferredVerifications = [...state.verifications.values()]
    .map((row) => ({
      verificationId: row.deferred.verificationId,
      workItemId: row.deferred.workItemId,
      ownerAgentId: row.deferred.ownerAgentId,
      checkIds: [...row.deferred.checkIds],
      reason: row.deferred.reason,
      dueGateId: row.deferred.dueGateId,
      status: row.closed ? "closed" : "open",
      disposition: row.closed?.disposition ?? null,
      summary: row.closed?.summary ?? null,
      evidenceRefs: row.closed ? [...row.closed.evidenceRefs] : [],
      decisionIds: row.closed ? [...row.closed.decisionIds] : [],
      truthRefs: [row.deferred.ref, ...(row.closed ? [row.closed.ref] : [])],
    }))
    .sort((left, right) => (
      gateOrder.get(left.dueGateId) - gateOrder.get(right.dueGateId)
      || compareIdentifiers(left.verificationId, right.verificationId)
    ));
  const openDeferredVerifications = deferredVerifications.filter(row => row.status === "open");
  const openDeferredVerificationIds = openDeferredVerifications
    .map(row => row.verificationId);
  const integrationGates = definition.integrationGates.map((gate) => {
    const unresolvedWorkItemIds = gate.requiredWorkItemIds.filter(id => byId.get(id).status !== "completed");
    const unresolvedDecisionIds = gate.requiredDecisionIds.filter(id => !resolvedDecisionIds.has(id));
    const gateVerifications = deferredVerifications.filter(row => row.dueGateId === gate.id);
    const unresolvedVerificationIds = gateVerifications
      .filter(row => row.status === "open")
      .map(row => row.verificationId);
    const pass = state.gatePasses.get(gate.id) ?? null;
    let status = unresolvedWorkItemIds.length === 0
      && unresolvedDecisionIds.length === 0
      && unresolvedVerificationIds.length === 0
      ? "ready"
      : "blocked";
    if (pass) {
      if (status !== "ready") throw new Error(`Integration gate ${gate.id} was passed before prerequisites.`);
      status = "passed";
    }
    return {
      gateId: gate.id,
      title: gate.title,
      status,
      unresolvedWorkItemIds,
      unresolvedDecisionIds,
      unresolvedVerificationIds,
      evidenceRefs: pass?.evidenceRefs ?? [],
      truthRefs: [
        "project/definition.json",
        ...gateVerifications.flatMap(row => row.truthRefs),
        ...(pass ? [pass.ref] : []),
      ],
    };
  });
  const stateNames = [
    "planned", "active", "waiting_dependency", "waiting_decision", "verifying",
    "ready_to_integrate", "completed", "failed",
  ];
  const counts = Object.fromEntries(stateNames.map(name => [
    name,
    workItems.filter(row => row.status === name).length,
  ]));
  counts.total = workItems.length;
  const orderedCounts = { total: counts.total };
  for (const name of stateNames) orderedCounts[name] = counts[name];
  const readyQueue = workItems
    .filter(row => row.status === "planned"
      && row.assignmentId === null
      && row.pendingHandoff === null
      && row.unresolvedDependencies.length === 0)
    .map(row => row.workItemId)
    .sort();
  const downstream = new Map(workItems.map(row => [row.workItemId, 0]));
  for (const item of workItems) {
    for (const dependency of item.dependencies) {
      downstream.set(dependency, downstream.get(dependency) + 1);
    }
  }
  const decisionBlocked = new Set(openDecisions.flatMap(row => row.blockingWorkItemIds));
  const criticalWorkItems = workItems
    .filter(row => row.status !== "completed" && (downstream.get(row.workItemId) > 0 || decisionBlocked.has(row.workItemId)))
    .sort((left, right) => (
      downstream.get(right.workItemId) - downstream.get(left.workItemId)
      || left.workItemId.localeCompare(right.workItemId)
    ))
    .map(row => row.workItemId);
  const agents = [...new Set(workItems.map(row => row.agentId).filter(Boolean))]
    .sort()
    .map(agentId => {
      const assigned = workItems.filter(row => row.agentId === agentId);
      const nextActions = assigned.map(row => row.nextAction).filter(Boolean);
      return {
        agentId,
        activeWorkItemIds: assigned.filter(row => ["active", "verifying", "ready_to_integrate"].includes(row.status)).map(row => row.workItemId).sort(),
        waitingWorkItemIds: assigned.filter(row => ["waiting_dependency", "waiting_decision"].includes(row.status)).map(row => row.workItemId).sort(),
        completedWorkItemIds: assigned.filter(row => row.status === "completed").map(row => row.workItemId).sort(),
        failedWorkItemIds: assigned.filter(row => row.status === "failed").map(row => row.workItemId).sort(),
        nextActions,
        lastCheckpointAt: assigned.map(row => row.lastCheckpointAt).filter(Boolean).sort().at(-1) ?? null,
      };
    });
  const aggregateGroup = (definitions, foreignKey, idKey) => definitions.map(group => {
    const items = workItems.filter(row => row[foreignKey] === group.id);
    return {
      [idKey]: group.id,
      title: group.title,
      totalWorkItems: items.length,
      completedWorkItems: items.filter(row => row.status === "completed").length,
      blockedWorkItems: items.filter(row => ["waiting_dependency", "waiting_decision", "failed"].includes(row.status)).map(row => row.workItemId).sort(),
    };
  });
  const dataCandidates = state.dataCandidates.map((row) => {
    const missingFields = [
      ...(row.decisionRef === null ? ["decisionRef"] : []),
      ...(row.outcomeRef === null ? ["outcomeRef"] : []),
      ...(row.rights === "unknown" ? ["rights"] : []),
      ...(row.verificationRefs.length === 0 ? ["verificationRefs"] : []),
    ].sort();
    return {
      candidateId: row.candidateId,
      sourceRef: row.sourceRef,
      rights: row.rights,
      inputRef: row.inputRef,
      outputRef: row.outputRef,
      decisionRef: row.decisionRef,
      verificationRefs: [...row.verificationRefs],
      outcomeRef: row.outcomeRef,
      version: row.version,
      admissionStatus: missingFields.length === 0 ? "eligible_candidate" : "incomplete",
      missingFields,
      truthRefs: [row.ref],
    };
  });
  const sourceDeliveries = state.sourceDeliveries.map(sourceDeliveryProjection);
  const warnings = workItems.map(verificationReceiptWarning).filter(Boolean);
  let overall = "planned";
  if (workItems.every(row => row.status === "completed")
    && integrationGates.every(row => row.status === "passed")
    && openDecisions.length === 0) overall = "completed";
  else if (openDecisions.length > 0 || workItems.some(row => row.status === "failed")) overall = "active_with_blockers";
  else if (workItems.some(row => row.status !== "planned" || row.pendingHandoff !== null)) overall = "active";
  const externalGates = [...state.externalGates.values()]
    .map(externalGateProjection)
    .sort((left, right) => compareIdentifiers(left.gateId, right.gateId));
  const deliveryLifecycle = deliveryLifecycleProjection(overall, state);
  const status = {
    schemaVersion: STATUS_SCHEMA_V3,
    status: "team_project_status",
    projectId: definition.projectId,
    objective: definition.objective,
    overall,
    counts: orderedCounts,
    milestones: aggregateGroup(definition.milestones, "milestoneId", "milestoneId"),
    workstreams: aggregateGroup(definition.workstreams, "workstreamId", "workstreamId"),
    workItems,
    agents,
    readyQueue,
    criticalWorkItems,
    openDecisions,
    resolvedDecisions,
    deferredVerifications,
    openDeferredVerificationIds,
    integrationGates,
    dataCandidates,
    sourceDeliveries,
    warnings,
    externalGates,
    deliveryLifecycle,
    projectTruthHash: sha256(canonical({
      definition: projectDefinition,
      events: records.map(row => row.event),
    })),
    authorizationGranted: false,
  };
  return { ...status, ...deriveProjectDriverSummary(status) };
}

function validateEventAgainstState(
  event,
  definition,
  records,
  workspaceRoot,
  { allowBoundReceipt = false } = {},
) {
  const normalized = validateEventShape(event, definition);
  const state = projectEvents(definition, records);
  const status = projectStatus(definition, records, workspaceRoot);
  if (normalized.schemaVersion === EVENT_SCHEMA_V6) {
    projectEvents(definition, [
      ...records,
      { event: normalized, ref: `project/events/${normalized.eventId}.json` },
    ]);
    return normalized;
  }
  if (normalized.type === "work_item_evidence_requirement_set") {
    projectEvents(definition, [
      ...records,
      { event: normalized, ref: `project/events/${normalized.eventId}.json` },
    ]);
    return normalized;
  }
  if (normalized.type === "checkpoint_receipt_bound") {
    const {
      receiptBinding: _receiptBinding,
      authorizationGranted: _authorizationGranted,
      checkpointId: _checkpointId,
      ...checkpointFields
    } = normalized;
    const checkpointEvent = {
      ...checkpointFields,
      schemaVersion: EVENT_SCHEMA,
      type: "checkpoint_recorded",
    };
    validateEventAgainstState(
      checkpointEvent,
      definition,
      records,
      workspaceRoot,
      { allowBoundReceipt: true },
    );
    projectEvents(definition, [
      ...records,
      { event: normalized, ref: `project/events/${normalized.eventId}.json` },
    ]);
    return normalized;
  }
  const effectiveDefinition = definitionWithScopeRevisions(definition, state);
  const workItem = effectiveDefinition.workItems.find(row => row.id === normalized.workItemId);
  if (normalized.type === "agent_assigned") {
    if (normalized.executionRunId !== undefined) {
      const executionTruth = executionTruthFor(workspaceRoot, normalized);
      if (executionTruth.status !== "bound") {
        throw new Error(
          `Agent assignment execution binding is not valid: ${executionTruth.issues.join(", ")}.`,
        );
      }
    }
    const current = state.assignments.get(normalized.workItemId) ?? null;
    if (current && normalized.supersedesAssignmentId !== current.assignmentId) {
      throw new Error(`Assignment must supersede current assignment ${current.assignmentId}.`);
    }
    if (!current && normalized.supersedesAssignmentId !== undefined) {
      throw new Error("supersedesAssignmentId has no current assignment.");
    }
    const currentProjection = status.workItems.find(
      row => row.workItemId === normalized.workItemId,
    );
    if (currentProjection?.pendingHandoff
      && normalized.agentId !== currentProjection.pendingHandoff.toAgentId) {
      throw new Error(
        `Assignment must accept pending handoff target ${currentProjection.pendingHandoff.toAgentId}.`,
      );
    }
    for (const projected of status.workItems) {
      if (projected.workItemId === normalized.workItemId
        || projected.assignmentId === null
        || ["completed", "failed"].includes(projected.status)) continue;
      const other = effectiveDefinition.workItems.find(row => row.id === projected.workItemId);
      if (pathsOverlap(workItem.ownedPaths, other.ownedPaths)) {
        throw new Error(
          `Owned paths overlap active assignment ${projected.assignmentId}: ${normalized.workItemId} <> ${projected.workItemId}.`,
        );
      }
    }
  } else if (normalized.type === "checkpoint_recorded") {
    const current = state.assignments.get(normalized.workItemId);
    if (!current || current.assignmentId !== normalized.assignmentId) {
      throw new Error("Checkpoint must bind the current assignment.");
    }
    if (normalized.state !== "completed") {
      const invalidatedGate = definition.integrationGates.find(gate => (
        gate.requiredWorkItemIds.includes(normalized.workItemId)
        && state.gatePasses.has(gate.id)
      ));
      if (invalidatedGate) {
        throw new Error(
          `Checkpoint cannot invalidate passed integration gate ${invalidatedGate.id}.`,
        );
      }
    }
    const unresolved = status.workItems.find(row => row.workItemId === normalized.workItemId).unresolvedDependencies;
    if (normalized.state === "completed" && unresolved.length > 0) {
      throw new Error(`Completed checkpoint has unresolved dependencies: ${unresolved.join(", ")}.`);
    }
    const evidenceRequirement = state.evidenceRequirements.get(normalized.workItemId) ?? null;
    if (!allowBoundReceipt
      && ["verifying", "completed"].includes(normalized.state)
      && evidenceRequirement?.requirement === "quick") {
      throw new Error(
        `WorkItem ${normalized.workItemId} requires a bound Quick receipt. `
        + "Use project checkpoint --from-quick-receipt <receipt.json>.",
      );
    }
    if (normalized.state === "verifying") {
      const history = state.assignmentHistory.get(normalized.workItemId) ?? [];
      const prior = history.at(-2) ?? null;
      if (!prior || prior.agentId === current.agentId) {
        throw new Error(
          "Independent verification requires a different current owner from the implementation owner. "
          + `Record a handoff to the verifier, then run: npx --no-install owlrunkit project assign --workspace ${JSON.stringify(workspaceRoot)} --assignment-id <verifier-assignment-id> --at <ISO-UTC> --work-item ${normalized.workItemId} --agent <verifier-agent> --supersedes ${current.assignmentId}`,
        );
      }
    }
    const executionTruth = status.workItems.find(
      row => row.workItemId === normalized.workItemId,
    ).executionTruth;
    if (normalized.state === "completed" && executionTruth
      && !(executionTruth.status === "bound"
        && executionTruth.lifecycle === "closed"
        && executionTruth.closeoutTrusted
        && executionTruth.closeoutDecision === "accepted"
        && new Set(["released", "preserved_inactive"]).has(executionTruth.leaseState))) {
      throw new Error("Completed checkpoint bound execution is not closed and accepted with a released lease.");
    }
    if (workItem.measurable) {
      if (normalized.completedUnits === undefined) {
        throw new Error("Measured work item checkpoint requires completedUnits.");
      }
      if (normalized.completedUnits > workItem.measurable.total) {
        throw new Error("Checkpoint completedUnits exceeds measurable total.");
      }
      if (normalized.state === "completed" && normalized.completedUnits !== workItem.measurable.total) {
        throw new Error("Completed measured work item must reach its total units.");
      }
    } else if (normalized.completedUnits !== undefined) {
      throw new Error("Unmeasured work item cannot claim completedUnits.");
    }
  } else if (normalized.type === "handoff_recorded") {
    const current = state.assignments.get(normalized.workItemId);
    const projected = status.workItems.find(row => row.workItemId === normalized.workItemId);
    if (["completed", "failed"].includes(projected?.status)) {
      throw new Error("Handoff cannot target a completed or failed WorkItem.");
    }
    if (!current
      || current.assignmentId !== normalized.assignmentId
      || current.agentId !== normalized.fromAgentId) {
      throw new Error("Handoff must bind the current assignment and Agent.");
    }
  } else if (normalized.type === "rework_returned") {
    const current = state.assignments.get(normalized.workItemId) ?? null;
    const failure = state.checkpoints.get(normalized.workItemId) ?? null;
    const projected = status.workItems.find(row => row.workItemId === normalized.workItemId);
    const latestFact = latestEventFact(
      failure,
      state.handoffs.get(normalized.workItemId) ?? null,
    );
    if (projected?.status !== "failed"
      || !current
      || current.assignmentId !== normalized.failedAssignmentId
      || current.agentId !== normalized.fromAgentId
      || failure?.eventId !== normalized.failedCheckpointEventId
      || failure.assignmentId !== normalized.failedAssignmentId
      || failure.state !== "failed"
      || latestFact?.eventId !== failure.eventId) {
      throw new Error(
        "reject-and-return requires one current failed checkpoint bound to the current assignment.",
      );
    }
    if (state.assignmentHistory.get(normalized.workItemId).some(
      row => row.assignmentId === normalized.assignmentId,
    )) {
      throw new Error(`Assignment ${normalized.assignmentId} already exists.`);
    }
    for (const otherProjection of status.workItems) {
      if (otherProjection.workItemId === normalized.workItemId
        || otherProjection.assignmentId === null
        || ["completed", "failed"].includes(otherProjection.status)) continue;
      const other = effectiveDefinition.workItems.find(row => row.id === otherProjection.workItemId);
      if (pathsOverlap(workItem.ownedPaths, other.ownedPaths)) {
        throw new Error(
          `Owned paths overlap active assignment ${otherProjection.assignmentId}: ${normalized.workItemId} <> ${otherProjection.workItemId}.`,
        );
      }
    }
  } else if (normalized.type === "upstream_reopened") {
    if ([...state.reopens.values()].some(row => row.reopenId === normalized.reopenId)) {
      throw new Error(`Upstream reopen ${normalized.reopenId} already exists.`);
    }
    if (state.assignmentHistory.get(normalized.workItemId).some(
      row => row.assignmentId === normalized.assignmentId,
    )) {
      throw new Error(`Assignment ${normalized.assignmentId} already exists.`);
    }
    const current = state.assignments.get(normalized.workItemId) ?? null;
    const checkpoint = state.checkpoints.get(normalized.workItemId) ?? null;
    const projected = status.workItems.find(row => row.workItemId === normalized.workItemId);
    if (projected?.status !== "completed"
      || !current
      || current.assignmentId !== normalized.previousAssignmentId
      || current.agentId !== normalized.fromAgentId
      || checkpoint?.eventId !== normalized.previousCheckpointEventId
      || checkpoint.assignmentId !== current.assignmentId
      || checkpoint.state !== "completed") {
      throw new Error("reopen-upstream requires the current completed upstream WorkItem.");
    }
    const downstreamIds = downstreamWorkItemIds(definition, normalized.workItemId);
    if (!downstreamIds.includes(normalized.triggerWorkItemId)) {
      throw new Error("reopen-upstream trigger must be a transitive downstream WorkItem.");
    }
    const triggerAssignment = state.assignments.get(normalized.triggerWorkItemId) ?? null;
    if (triggerAssignment?.agentId !== normalized.reviewerAgentId) {
      throw new Error("reopen-upstream reviewer must own the trigger WorkItem.");
    }
    const affectedIds = [normalized.workItemId, ...downstreamIds];
    const passedGate = definition.integrationGates.find(gate => (
      state.gatePasses.has(gate.id)
      && gate.requiredWorkItemIds.some(id => affectedIds.includes(id))
    ));
    if (passedGate) {
      throw new Error(`reopen-upstream cannot invalidate passed integration gate ${passedGate.id}.`);
    }
    for (const otherProjection of status.workItems) {
      if (otherProjection.workItemId === normalized.workItemId
        || otherProjection.assignmentId === null
        || ["completed", "failed"].includes(otherProjection.status)) continue;
      const other = effectiveDefinition.workItems.find(row => row.id === otherProjection.workItemId);
      if (pathsOverlap(workItem.ownedPaths, other.ownedPaths)) {
        throw new Error(
          `Owned paths overlap active assignment ${otherProjection.assignmentId}: ${normalized.workItemId} <> ${otherProjection.workItemId}.`,
        );
      }
    }
  } else if (normalized.type === "responsibility_transferred") {
    if ([...state.transfers.values()].some(row => row.transferId === normalized.transferId)) {
      throw new Error(`Responsibility transfer ${normalized.transferId} already exists.`);
    }
    if (state.assignmentHistory.get(normalized.workItemId).some(
      row => row.assignmentId === normalized.assignmentId,
    )) {
      throw new Error(`Assignment ${normalized.assignmentId} already exists.`);
    }
    const current = state.assignments.get(normalized.workItemId) ?? null;
    const projected = status.workItems.find(row => row.workItemId === normalized.workItemId);
    if (!current
      || current.assignmentId !== normalized.previousAssignmentId
      || current.agentId !== normalized.fromAgentId) {
      throw new Error("Responsibility transfer must bind the current assignment and Agent.");
    }
    if (["completed", "failed"].includes(projected?.status)) {
      throw new Error("Responsibility transfer cannot target a terminal WorkItem.");
    }
    if (projected?.pendingHandoff !== null) {
      throw new Error("Responsibility transfer cannot replace a pending handoff.");
    }
    const existingFactIds = new Set(records.flatMap(({ event }) => [
      event.eventId,
      ...(event.type === "responsibility_transferred"
        ? [event.checkpointEventId, event.handoffEventId, event.assignmentEventId]
        : []),
    ]));
    for (const factId of [
      normalized.checkpointEventId,
      normalized.handoffEventId,
      normalized.assignmentEventId,
    ]) {
      if (existingFactIds.has(factId)) {
        throw new Error(`Responsibility transfer fact ID ${factId} already exists.`);
      }
    }
    if (workItem.measurable) {
      if (normalized.completedUnits === undefined) {
        throw new Error("Measured WorkItem transfer requires completedUnits.");
      }
      if (normalized.completedUnits > workItem.measurable.total) {
        throw new Error("Responsibility transfer completedUnits exceeds measurable total.");
      }
    } else if (normalized.completedUnits !== undefined) {
      throw new Error("Unmeasured WorkItem transfer cannot claim completedUnits.");
    }
  } else if (normalized.type === "decision_opened") {
    if (state.decisions.has(normalized.decisionId)) throw new Error(`Decision ${normalized.decisionId} already exists.`);
  } else if (normalized.type === "decision_resolved") {
    const decision = state.decisions.get(normalized.decisionId);
    if (!decision || decision.resolved) throw new Error(`Decision ${normalized.decisionId} is not open.`);
  } else if (normalized.type === "verification_deferred") {
    if (state.verifications.has(normalized.verificationId)) {
      throw new Error(`Deferred verification ${normalized.verificationId} already exists.`);
    }
    if (state.gatePasses.has(normalized.dueGateId)) {
      throw new Error(
        `Deferred verification cannot target integration gate ${normalized.dueGateId}; gate already passed. `
        + "Create a successor project with: npx --no-install owlrunkit project successor --workspace <directory> --transition-id <id> --at <ISO-UTC> --definition <project.json> --reason <text>; or define a new unpassed gate before deferring.",
      );
    }
  } else if (normalized.type === "work_item_scope_revised") {
    const current = state.assignments.get(normalized.workItemId) ?? null;
    const currentRevision = state.scopeRevisions.get(normalized.workItemId) ?? null;
    const currentScope = currentRevision?.ownedPaths ?? workItem.ownedPaths;
    const currentMeasurable = currentRevision
      ? currentRevision.measurable
      : workItem.measurable ?? null;
    const projected = status.workItems.find(row => row.workItemId === normalized.workItemId);
    if (!current
      || current.assignmentId !== normalized.assignmentId
      || current.agentId !== normalized.ownerAgentId) {
      throw new Error("WorkItem scope revision must bind the current assignment and owner.");
    }
    if (["completed", "failed"].includes(projected?.status)) {
      throw new Error("WorkItem scope revision requires a non-terminal WorkItem.");
    }
    if (normalized.supersedesRevisionId !== currentRevision?.revisionId) {
      throw new Error(
        `WorkItem scope revision must supersede current revision ${currentRevision?.revisionId ?? "none"}.`,
      );
    }
    if (canonical(normalized.previousOwnedPaths) !== canonical(currentScope)
      || canonical(normalized.previousMeasurable) !== canonical(currentMeasurable)) {
      throw new Error("WorkItem scope revision does not bind the current scope.");
    }
    if (canonical(normalized.ownedPaths) === canonical(currentScope)
      && canonical(normalized.measurable) === canonical(currentMeasurable)) {
      throw new Error("WorkItem scope revision must change ownedPaths or measurable truth.");
    }
    for (const otherProjection of status.workItems) {
      if (otherProjection.workItemId === normalized.workItemId
        || otherProjection.assignmentId === null
        || ["completed", "failed"].includes(otherProjection.status)) continue;
      const otherRevision = state.scopeRevisions.get(otherProjection.workItemId) ?? null;
      const otherDefinition = effectiveDefinition.workItems.find(
        row => row.id === otherProjection.workItemId,
      );
      const otherOwnedPaths = otherRevision?.ownedPaths ?? otherDefinition.ownedPaths;
      if (pathsOverlap(normalized.ownedPaths, otherOwnedPaths)) {
        throw new Error(
          `Revised owned paths overlap active assignment ${otherProjection.assignmentId}: ${normalized.workItemId} <> ${otherProjection.workItemId}.`,
        );
      }
    }
  } else if (normalized.type === "verification_closed") {
    const verification = state.verifications.get(normalized.verificationId);
    if (!verification || verification.closed) {
      throw new Error(`Deferred verification ${normalized.verificationId} is not open.`);
    }
    if (normalized.disposition === "no_longer_required") {
      for (const decisionId of normalized.decisionIds) {
        const decision = state.decisions.get(decisionId);
        if (!decision?.resolved) {
          throw new Error(
            `No-longer-required deferred verification requires resolved decision ${decisionId}.`,
          );
        }
      }
    }
  } else if (normalized.type === "integration_gate_passed") {
    const gate = status.integrationGates.find(row => row.gateId === normalized.gateId);
    if (state.gatePasses.has(normalized.gateId)) {
      throw new Error(`Integration gate ${normalized.gateId} has already passed.`);
    }
    if (gate.status !== "ready") throw new Error(`Integration gate ${normalized.gateId} is not ready.`);
  } else if (normalized.type === "data_candidate_recorded") {
    if (state.dataCandidates.some(row => row.candidateId === normalized.candidateId)) {
      throw new Error(`Data candidate ${normalized.candidateId} already exists.`);
    }
  } else if (normalized.type === "source_delivery_imported") {
    if (state.sourceDeliveries.some(row => row.deliveryId === normalized.deliveryId)) {
      throw new Error(`External source delivery ${normalized.deliveryId} already exists.`);
    }
    const current = state.assignments.get(normalized.workItemId) ?? null;
    if (current?.assignmentId !== normalized.assignmentId) {
      throw new Error("External source delivery must bind the current assignment.");
    }
    const projected = status.workItems.find(row => row.workItemId === normalized.workItemId);
    if (["completed", "failed"].includes(projected?.status)) {
      throw new Error("External source delivery requires a non-terminal WorkItem.");
    }
  }
  return normalized;
}

export function initializeTeamProjectV1({ workspaceRoot, definition }) {
  const normalized = validateDefinition(definition);
  if (!existsSync(workspaceRoot)) mkdirSync(workspaceRoot, { recursive: true });
  const { root, projectRoot: rootPath } = projectRoot(workspaceRoot);
  assertRealProjectTree(root, rootPath);
  assertRealProjectTree(root, path.join(rootPath, "events"));
  const definitionPath = path.join(rootPath, "definition.json");
  if (existsSync(definitionPath)) {
    const existing = readRegularJson(definitionPath, "Team project definition");
    if (canonical(existing) !== canonical(normalized)) {
      throw new Error("Team project definition is immutable and differs.");
    }
    return {
      status: "team_project_initialized",
      exitCode: 0,
      projectId: normalized.projectId,
      definitionPath: relativeToWorkspace(root, definitionPath),
      definitionSha256: sha256(canonical(normalized)),
      resumed: true,
      authorizationGranted: false,
    };
  }
  writeJsonExclusiveAtomically(definitionPath, normalized);
  return {
    status: "team_project_initialized",
    exitCode: 0,
    projectId: normalized.projectId,
    definitionPath: relativeToWorkspace(root, definitionPath),
    definitionSha256: sha256(canonical(normalized)),
    resumed: false,
    authorizationGranted: false,
  };
}

function appendTeamProjectEventWithinLock(refreshed, event) {
  const shaped = validateEventShape(event, refreshed.definition);
  const eventPath = path.join(refreshed.projectRoot, "events", `${shaped.eventId}.json`);
  if (existsSync(eventPath)) {
    const existing = readRegularJson(eventPath, `Team project event ${shaped.eventId}`);
    if (canonical(existing) !== canonical(shaped)) {
      throw new Error(`Team project immutable event differs: ${shaped.eventId}.`);
    }
    return {
      status: "team_project_event_recorded",
      exitCode: 0,
      eventId: shaped.eventId,
      eventPath: relativeToWorkspace(refreshed.root, eventPath),
      eventSha256: sha256(canonical(shaped)),
      resumed: true,
      authorizationGranted: false,
    };
  }
  const latest = refreshed.events.at(-1)?.event ?? null;
  if (latest && (shaped.occurredAt < latest.occurredAt
    || (shaped.occurredAt === latest.occurredAt
      && shaped.eventId.localeCompare(latest.eventId) <= 0))) {
    throw new Error(
      `Team project event must sort after the latest event ${latest.eventId}.`,
    );
  }
  const normalized = validateEventAgainstState(
    shaped,
    refreshed.definition,
    refreshed.events,
    refreshed.root,
  );
  writeJsonExclusiveAtomically(eventPath, normalized);
  return {
    status: "team_project_event_recorded",
    exitCode: 0,
    eventId: normalized.eventId,
    eventPath: relativeToWorkspace(refreshed.root, eventPath),
    eventSha256: sha256(canonical(normalized)),
    resumed: false,
    authorizationGranted: false,
  };
}

export function appendTeamProjectEventV1({ workspaceRoot, event }) {
  const loaded = loadProject(workspaceRoot);
  return withProjectLock(loaded.projectRoot, () => (
    appendTeamProjectEventWithinLock(loadProject(workspaceRoot), event)
  ));
}

export function assignTeamProjectV1({
  workspaceRoot,
  assignmentId,
  occurredAt,
  workItemId,
  agentId,
  supersedesAssignmentId,
  executionRunId,
  executionWorkItemId,
}) {
  safeIdentifier(assignmentId, "assignmentId");
  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `assignment-${assignmentId}`,
    type: "agent_assigned",
    occurredAt,
    assignmentId,
    workItemId,
    agentId,
  };
  if (supersedesAssignmentId !== undefined) {
    event.supersedesAssignmentId = supersedesAssignmentId;
  }
  if (executionRunId !== undefined) event.executionRunId = executionRunId;
  if (executionWorkItemId !== undefined) event.executionWorkItemId = executionWorkItemId;

  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV3({ workspaceRoot });
  if (recorded.resumed) {
    const current = status.workItems.find(row => row.workItemId === workItemId);
    if (current?.assignmentId !== assignmentId) {
      throw new Error(
        `Cannot resume historical/superseded assignment ${assignmentId}; `
        + `current assignment=${current?.assignmentId ?? "none"}, `
        + `current owner=${current?.agentId ?? "none"}.`,
      );
    }
  }
  return {
    status: "team_project_assignment",
    assignmentId,
    workItemId,
    agentId,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function handoffTeamProjectV1({
  workspaceRoot,
  handoffId,
  occurredAt,
  assignmentId,
  workItemId,
  fromAgentId,
  toAgentId,
  summary,
  nextAction,
  evidenceRefs,
}) {
  safeIdentifier(handoffId, "handoffId");
  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `handoff-${handoffId}`,
    type: "handoff_recorded",
    occurredAt,
    assignmentId,
    workItemId,
    fromAgentId,
    toAgentId,
    summary,
    evidenceRefs,
    nextAction,
  };
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV1({ workspaceRoot });
  const current = status.workItems.find(row => row.workItemId === workItemId);
  const pending = current?.pendingHandoff ?? null;
  if (recorded.resumed && (
    current?.assignmentId !== assignmentId
      || current?.agentId !== fromAgentId
      || pending?.eventId !== event.eventId
  )) {
    throw new Error(
      `Cannot resume historical/superseded handoff ${handoffId}; `
      + `current assignment=${current?.assignmentId ?? "none"}, `
      + `current owner=${current?.agentId ?? "none"}, `
      + `current pending target=${pending?.toAgentId ?? "none"}.`,
    );
  }
  return {
    status: "team_project_handoff",
    handoffId,
    assignmentId,
    workItemId,
    fromAgentId,
    toAgentId,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    pending: true,
    targetNextAction: pending?.nextAction ?? nextAction,
    projectTruthHash: status.projectTruthHash,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    projectNextAction: status.nextAction,
    projectNextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function rejectAndReturnTeamProjectV1({
  workspaceRoot,
  reworkId,
  occurredAt,
  workItemId,
  reviewerAgentId,
  toAgentId,
  reason,
  nextAction,
  evidenceRefs,
}) {
  safeIdentifier(reworkId, "reworkId");
  const eventId = `rework-returned-${reworkId}`;
  const assignmentId = `rework-${reworkId}`;
  const loaded = loadProject(workspaceRoot);
  return withProjectLock(loaded.projectRoot, () => {
    const refreshed = loadProject(workspaceRoot);
    const existing = refreshed.events.find(row => row.event.eventId === eventId)?.event ?? null;
    let event;
    if (existing) {
      event = {
        schemaVersion: EVENT_SCHEMA_V2,
        eventId,
        type: "rework_returned",
        occurredAt,
        reworkId,
        assignmentId,
        failedAssignmentId: existing.failedAssignmentId,
        failedCheckpointEventId: existing.failedCheckpointEventId,
        workItemId,
        fromAgentId: existing.fromAgentId,
        reviewerAgentId,
        toAgentId,
        reason,
        evidenceRefs,
        nextAction,
      };
    } else {
      const state = projectEvents(refreshed.definition, refreshed.events);
      const status = projectStatus(refreshed.definition, refreshed.events, refreshed.root);
      const current = state.assignments.get(workItemId) ?? null;
      const failure = state.checkpoints.get(workItemId) ?? null;
      const projected = status.workItems.find(row => row.workItemId === workItemId) ?? null;
      const latestFact = latestEventFact(failure, state.handoffs.get(workItemId) ?? null);
      if (projected?.status !== "failed"
        || !current
        || failure?.state !== "failed"
        || failure.assignmentId !== current.assignmentId
        || latestFact?.eventId !== failure.eventId) {
        throw new Error(
          "reject-and-return requires one current failed checkpoint bound to the current assignment.",
        );
      }
      event = {
        schemaVersion: EVENT_SCHEMA_V2,
        eventId,
        type: "rework_returned",
        occurredAt,
        reworkId,
        assignmentId,
        failedAssignmentId: current.assignmentId,
        failedCheckpointEventId: failure.eventId,
        workItemId,
        fromAgentId: current.agentId,
        reviewerAgentId,
        toAgentId,
        reason,
        evidenceRefs,
        nextAction,
      };
    }

    const recorded = appendTeamProjectEventWithinLock(refreshed, event);
    const projectedEvents = recorded.resumed
      ? refreshed.events
      : [
          ...refreshed.events,
          { event, ref: `project/events/${event.eventId}.json` },
        ];
    const status = projectStatus(refreshed.definition, projectedEvents, refreshed.root);
    const projectedState = projectEvents(refreshed.definition, projectedEvents);
    const current = status.workItems.find(row => row.workItemId === workItemId) ?? null;
    const latestFact = latestEventFact(
      latestEventFact(
        projectedState.checkpoints.get(workItemId) ?? null,
        projectedState.handoffs.get(workItemId) ?? null,
      ),
      projectedState.reworks.get(workItemId) ?? null,
    );
    if (current?.assignmentId !== assignmentId
      || current?.rework?.eventId !== eventId
      || latestFact?.eventId !== eventId) {
      throw new Error(
        `Cannot resume historical/superseded rework ${reworkId}; `
        + `current assignment=${current?.assignmentId ?? "none"}, `
        + `current owner=${current?.agentId ?? "none"}.`,
      );
    }
    return {
      status: "team_project_rework",
      reworkId,
      assignmentId,
      failedAssignmentId: event.failedAssignmentId,
      failedCheckpointEventId: event.failedCheckpointEventId,
      workItemId,
      fromAgentId: event.fromAgentId,
      reviewerAgentId,
      toAgentId,
      reason,
      nextAction: current.nextAction,
      eventId: recorded.eventId,
      eventPath: recorded.eventPath,
      eventSha256: recorded.eventSha256,
      resumed: recorded.resumed,
      reworkAttempt: current.rework.attempt,
      projectTruthHash: status.projectTruthHash,
      overall: status.overall,
      projectNextAction: status.nextAction,
      projectNextActorId: status.nextActorId,
      gitWritePerformed: false,
      releaseWritePerformed: false,
      authorizationGranted: false,
      exitCode: 0,
    };
  });
}

export function reopenUpstreamTeamProjectV1({
  workspaceRoot,
  reopenId,
  occurredAt,
  upstreamWorkItemId,
  triggerWorkItemId,
  reviewerAgentId,
  toAgentId,
  reason,
  nextAction,
  evidenceRefs,
}) {
  safeIdentifier(reopenId, "reopenId");
  const eventId = `upstream-reopened-${reopenId}`;
  const assignmentId = `reopen-${reopenId}`;
  const loaded = loadProject(workspaceRoot);
  return withProjectLock(loaded.projectRoot, () => {
    const refreshed = loadProject(workspaceRoot);
    const existing = refreshed.events.find(row => row.event.eventId === eventId)?.event ?? null;
    let event;
    if (existing) {
      event = {
        schemaVersion: EVENT_SCHEMA_V4,
        eventId,
        type: "upstream_reopened",
        occurredAt,
        reopenId,
        assignmentId,
        previousAssignmentId: existing.previousAssignmentId,
        previousCheckpointEventId: existing.previousCheckpointEventId,
        workItemId: upstreamWorkItemId,
        triggerWorkItemId,
        fromAgentId: existing.fromAgentId,
        reviewerAgentId,
        toAgentId,
        reason,
        evidenceRefs,
        nextAction,
      };
    } else {
      const state = projectEvents(refreshed.definition, refreshed.events);
      const current = state.assignments.get(upstreamWorkItemId) ?? null;
      const checkpoint = state.checkpoints.get(upstreamWorkItemId) ?? null;
      if (!current || !checkpoint) {
        throw new Error("reopen-upstream requires an assigned, completed upstream WorkItem.");
      }
      event = {
        schemaVersion: EVENT_SCHEMA_V4,
        eventId,
        type: "upstream_reopened",
        occurredAt,
        reopenId,
        assignmentId,
        previousAssignmentId: current.assignmentId,
        previousCheckpointEventId: checkpoint.eventId,
        workItemId: upstreamWorkItemId,
        triggerWorkItemId,
        fromAgentId: current.agentId,
        reviewerAgentId,
        toAgentId,
        reason,
        evidenceRefs,
        nextAction,
      };
    }
    const recorded = appendTeamProjectEventWithinLock(refreshed, event);
    const projectedEvents = recorded.resumed
      ? refreshed.events
      : [...refreshed.events, { event, ref: `project/events/${event.eventId}.json` }];
    const status = projectStatus(refreshed.definition, projectedEvents, refreshed.root);
    const projectedState = projectEvents(refreshed.definition, projectedEvents);
    const current = status.workItems.find(row => row.workItemId === upstreamWorkItemId) ?? null;
    const reopen = projectedState.reopens.get(upstreamWorkItemId) ?? null;
    if (current?.assignmentId !== assignmentId || reopen?.reopenId !== reopenId) {
      throw new Error(
        `Cannot resume historical/superseded upstream reopen ${reopenId}; `
        + `current assignment=${current?.assignmentId ?? "none"}.`,
      );
    }
    return {
      status: "team_project_upstream_reopened",
      reopenId,
      assignmentId,
      previousAssignmentId: event.previousAssignmentId,
      previousCheckpointEventId: event.previousCheckpointEventId,
      upstreamWorkItemId,
      triggerWorkItemId,
      fromAgentId: event.fromAgentId,
      reviewerAgentId,
      toAgentId,
      invalidatedWorkItemIds: downstreamWorkItemIds(
        refreshed.definition,
        upstreamWorkItemId,
        { includeRoot: true },
      ),
      eventId: recorded.eventId,
      eventPath: recorded.eventPath,
      eventSha256: recorded.eventSha256,
      resumed: recorded.resumed,
      projectTruthHash: status.projectTruthHash,
      overall: status.overall,
      nextAction: status.nextAction,
      nextActorId: status.nextActorId,
      gitWritePerformed: false,
      releaseWritePerformed: false,
      authorizationGranted: false,
      exitCode: 0,
    };
  });
}

export function transferTeamProjectV1({
  workspaceRoot,
  transferId,
  occurredAt,
  assignmentId: previousAssignmentId,
  workItemId,
  fromAgentId,
  toAgentId,
  state,
  summary,
  completedUnits,
  evidenceRefs = [],
  blockerRefs = [],
  decisionRefs = [],
  nextAction,
  sourceFingerprint,
}) {
  safeIdentifier(transferId, "transferId");
  const eventId = `responsibility-transferred-${transferId}`;
  const assignmentId = `transfer-${transferId}`;
  const event = {
    schemaVersion: EVENT_SCHEMA_V4,
    eventId,
    type: "responsibility_transferred",
    occurredAt,
    transferId,
    assignmentId,
    previousAssignmentId,
    checkpointEventId: `transfer-checkpoint-${transferId}`,
    handoffEventId: `transfer-handoff-${transferId}`,
    assignmentEventId: `transfer-assignment-${transferId}`,
    workItemId,
    fromAgentId,
    toAgentId,
    state,
    summary,
    ...(completedUnits === undefined ? {} : { completedUnits }),
    evidenceRefs,
    blockerRefs,
    decisionRefs,
    nextAction,
    ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
  };
  const loaded = loadProject(workspaceRoot);
  return withProjectLock(loaded.projectRoot, () => {
    const refreshed = loadProject(workspaceRoot);
    const recorded = appendTeamProjectEventWithinLock(refreshed, event);
    const projectedEvents = recorded.resumed
      ? refreshed.events
      : [...refreshed.events, { event, ref: `project/events/${event.eventId}.json` }];
    const status = projectStatus(refreshed.definition, projectedEvents, refreshed.root);
    const projectedState = projectEvents(refreshed.definition, projectedEvents);
    const current = status.workItems.find(row => row.workItemId === workItemId) ?? null;
    const transfer = projectedState.transfers.get(workItemId) ?? null;
    if (current?.assignmentId !== assignmentId || transfer?.transferId !== transferId) {
      throw new Error(
        `Cannot resume historical/superseded responsibility transfer ${transferId}; `
        + `current assignment=${current?.assignmentId ?? "none"}.`,
      );
    }
    const factRefs = ["checkpoint", "handoff", "assignment"]
      .map(fragment => `project/events/${eventId}.json#${fragment}`);
    return {
      status: "team_project_transfer",
      transferId,
      assignmentId,
      previousAssignmentId,
      workItemId,
      fromAgentId,
      toAgentId,
      state,
      factRefs,
      eventId: recorded.eventId,
      eventPath: recorded.eventPath,
      eventSha256: recorded.eventSha256,
      resumed: recorded.resumed,
      projectTruthHash: status.projectTruthHash,
      overall: status.overall,
      nextAction: status.nextAction,
      nextActorId: status.nextActorId,
      gitWritePerformed: false,
      releaseWritePerformed: false,
      authorizationGranted: false,
      exitCode: 0,
    };
  });
}

export function openTeamProjectDecisionV1({
  workspaceRoot,
  decisionId,
  occurredAt,
  title,
  question,
  ownerAgentId,
  blockingWorkItemIds,
  options,
}) {
  safeIdentifier(decisionId, "decisionId");
  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `decision-opened-${decisionId}`,
    type: "decision_opened",
    occurredAt,
    decisionId,
    title,
    question,
    ownerAgentId,
    blockingWorkItemIds,
    options,
  };
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV1({ workspaceRoot });
  if (recorded.resumed && !status.openDecisions.some(row => row.decisionId === decisionId)) {
    const resolved = status.resolvedDecisions.some(row => row.decisionId === decisionId);
    throw new Error(
      `Cannot resume historical decision ${decisionId}; `
      + (resolved ? "decision is already resolved." : "decision is not currently open."),
    );
  }
  return {
    status: "team_project_decision",
    operation: "opened",
    decisionId,
    ownerAgentId,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function resolveTeamProjectDecisionV1({
  workspaceRoot,
  decisionId,
  occurredAt,
  resolution,
  rationale,
  evidenceRefs,
}) {
  safeIdentifier(decisionId, "decisionId");
  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `decision-resolved-${decisionId}`,
    type: "decision_resolved",
    occurredAt,
    decisionId,
    resolution,
    rationale,
    evidenceRefs,
  };
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV1({ workspaceRoot });
  if (recorded.resumed && !status.resolvedDecisions.some(row => row.decisionId === decisionId)) {
    throw new Error(`Cannot resume decision ${decisionId}; decision is not resolved.`);
  }
  return {
    status: "team_project_decision",
    operation: "resolved",
    decisionId,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function deferTeamProjectVerificationV1({
  workspaceRoot,
  verificationId,
  occurredAt,
  workItemId,
  ownerAgentId,
  checkIds,
  reason,
  dueGateId,
}) {
  safeIdentifier(verificationId, "verificationId");
  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `verification-deferred-${verificationId}`,
    type: "verification_deferred",
    occurredAt,
    verificationId,
    workItemId,
    ownerAgentId,
    checkIds,
    reason,
    dueGateId,
  };
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV1({ workspaceRoot });
  const verification = status.deferredVerifications.find(
    row => row.verificationId === verificationId,
  );
  if (recorded.resumed && verification?.status !== "open") {
    throw new Error(`Cannot resume closed deferred verification ${verificationId}.`);
  }
  const gate = status.integrationGates.find(row => row.gateId === dueGateId);
  return {
    status: "team_project_verification",
    operation: "deferred",
    verificationId,
    verificationStatus: verification?.status ?? null,
    dueGateId,
    gateStatus: gate?.status ?? null,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    overall: status.overall,
    projectTruthHash: status.projectTruthHash,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    verificationCommandExecuted: false,
    gitWritePerformed: false,
    releaseWritePerformed: false,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function closeTeamProjectVerificationV1({
  workspaceRoot,
  verificationId,
  occurredAt,
  disposition,
  summary,
  evidenceRefs,
  decisionIds,
}) {
  safeIdentifier(verificationId, "verificationId");
  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `verification-closed-${verificationId}`,
    type: "verification_closed",
    occurredAt,
    verificationId,
    disposition,
    summary,
    evidenceRefs,
    decisionIds,
  };
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV1({ workspaceRoot });
  const verification = status.deferredVerifications.find(
    row => row.verificationId === verificationId,
  );
  if (verification?.status !== "closed" || verification.disposition !== disposition) {
    throw new Error(`Cannot resume deferred verification close ${verificationId}.`);
  }
  const gate = status.integrationGates.find(row => row.gateId === verification.dueGateId);
  return {
    status: "team_project_verification",
    operation: "closed",
    verificationId,
    verificationStatus: verification.disposition,
    dueGateId: verification.dueGateId,
    gateStatus: gate?.status ?? null,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    overall: status.overall,
    projectTruthHash: status.projectTruthHash,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    verificationCommandExecuted: false,
    gitWritePerformed: false,
    releaseWritePerformed: false,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function integrateTeamProjectV1({
  workspaceRoot,
  gateId,
  occurredAt,
  summary,
  evidenceRefs,
}) {
  safeIdentifier(gateId, "gateId");
  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `integration-gate-${gateId}`,
    type: "integration_gate_passed",
    occurredAt,
    gateId,
    summary,
    evidenceRefs,
  };
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV3({ workspaceRoot });
  const gate = status.integrationGates.find(row => row.gateId === gateId);
  return {
    status: "team_project_integration",
    gateId,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    gateStatus: gate?.status ?? null,
    overall: status.overall,
    deliveryDisposition: status.deliveryDisposition,
    projectTruthHash: status.projectTruthHash,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    gitWritePerformed: false,
    releaseWritePerformed: false,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function reconcileExternalGateV1({
  workspaceRoot,
  reconciliationId,
  occurredAt,
  gateId,
  title,
  requiredFor,
  gateStatus,
  ownerAgentId,
  sourceAdapterId,
  sourceRef,
  sourceSha256,
  summary,
  evidenceRefs = [],
}) {
  safeIdentifier(reconciliationId, "reconciliationId");
  const loaded = loadProject(workspaceRoot);
  const state = projectEvents(loaded.definition, loaded.events);
  const existing = loaded.events.find(row => (
    row.event.type === "external_gate_reconciled"
    && row.event.reconciliationId === reconciliationId
  ))?.event ?? null;
  let event;
  if (existing) {
    const requested = {
      occurredAt: normalizeTimestamp(occurredAt),
      gateId,
      title,
      requiredFor,
      gateStatus,
      ownerAgentId,
      sourceAdapterId,
      sourceRef,
      sourceSha256,
      summary,
      evidenceRefs,
    };
    for (const key of Object.keys(requested)) {
      if (canonical(existing[key]) !== canonical(requested[key])) {
        throw new Error(`Cannot resume external Gate reconciliation ${reconciliationId}; ${key} differs.`);
      }
    }
    event = existing;
  } else {
    const previous = state.externalGates.get(gateId) ?? null;
    event = {
      schemaVersion: EVENT_SCHEMA_V6,
      eventId: `external-gate-${reconciliationId}`,
      type: "external_gate_reconciled",
      occurredAt,
      reconciliationId,
      ...(previous ? { supersedesReconciliationId: previous.reconciliationId } : {}),
      gateId,
      title,
      requiredFor,
      gateStatus,
      ownerAgentId,
      sourceAdapterId,
      sourceRef,
      sourceSha256,
      summary,
      evidenceRefs,
      authorizationGranted: false,
    };
  }
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV4({ workspaceRoot });
  const gate = status.externalGates.find(row => row.gateId === gateId);
  if (!gate || gate.gateStatus !== gateStatus) {
    throw new Error(`External Gate reconciliation ${reconciliationId} is not current.`);
  }
  return {
    status: "team_project_external_gate_reconciled",
    reconciliationId,
    supersedesReconciliationId: event.supersedesReconciliationId ?? null,
    gateId,
    gateStatus,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    dominantGap: status.dominantGap,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function recordDeliveryLifecycleV1({
  workspaceRoot,
  recordId,
  occurredAt,
  stage,
  stageStatus,
  ownerAgentId,
  summary,
  evidenceRefs = [],
  externalGateIds = [],
}) {
  safeIdentifier(recordId, "delivery recordId");
  const loaded = loadProject(workspaceRoot);
  const state = projectEvents(loaded.definition, loaded.events);
  const existing = loaded.events.find(row => (
    row.event.type === "delivery_lifecycle_recorded"
    && row.event.recordId === recordId
  ))?.event ?? null;
  let event;
  if (existing) {
    const requested = {
      occurredAt: normalizeTimestamp(occurredAt),
      stage,
      stageStatus,
      ownerAgentId,
      summary,
      evidenceRefs,
      externalGateIds,
    };
    for (const key of Object.keys(requested)) {
      if (canonical(existing[key]) !== canonical(requested[key])) {
        throw new Error(`Cannot resume delivery lifecycle record ${recordId}; ${key} differs.`);
      }
    }
    event = existing;
  } else {
    const previous = state.deliveryRecords.get(stage) ?? null;
    event = {
      schemaVersion: EVENT_SCHEMA_V6,
      eventId: `delivery-lifecycle-${recordId}`,
      type: "delivery_lifecycle_recorded",
      occurredAt,
      recordId,
      ...(previous ? { supersedesRecordId: previous.recordId } : {}),
      stage,
      stageStatus,
      ownerAgentId,
      summary,
      evidenceRefs,
      externalGateIds,
      authorizationGranted: false,
    };
  }
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV4({ workspaceRoot });
  const stageProjection = status.deliveryLifecycle.stages.find(row => row.stage === stage);
  if (stageProjection?.recordId !== recordId) {
    throw new Error(`Delivery lifecycle record ${recordId} is not current.`);
  }
  return {
    status: "team_project_delivery_lifecycle_recorded",
    recordId,
    supersedesRecordId: event.supersedesRecordId ?? null,
    stage,
    stageStatus,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    deliveryLifecycle: status.deliveryLifecycle,
    dominantGap: status.dominantGap,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function setWorkItemEvidenceRequirementV1({
  workspaceRoot,
  policyId,
  occurredAt,
  workItemId,
  ownerAgentId,
  requirement,
  reason,
  evidenceRefs = [],
}) {
  safeIdentifier(policyId, "evidence policyId");
  const loaded = loadProject(workspaceRoot);
  const state = projectEvents(loaded.definition, loaded.events);
  const existing = loaded.events.find(row => (
    row.event.type === "work_item_evidence_requirement_set"
    && row.event.policyId === policyId
  ))?.event ?? null;
  let event;
  if (existing) {
    const requested = {
      occurredAt: normalizeTimestamp(occurredAt),
      workItemId,
      ownerAgentId,
      requirement,
      reason,
      evidenceRefs,
    };
    for (const key of Object.keys(requested)) {
      if (canonical(existing[key]) !== canonical(requested[key])) {
        throw new Error(`Cannot resume WorkItem evidence policy ${policyId}; ${key} differs.`);
      }
    }
    event = existing;
  } else {
    const previous = state.evidenceRequirements.get(workItemId) ?? null;
    event = {
      schemaVersion: EVENT_SCHEMA_V7,
      eventId: `work-item-evidence-${policyId}`,
      type: "work_item_evidence_requirement_set",
      occurredAt,
      policyId,
      ...(previous ? { supersedesPolicyId: previous.policyId } : {}),
      workItemId,
      ownerAgentId,
      requirement,
      reason,
      evidenceRefs,
      authorizationGranted: false,
    };
  }
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV4({ workspaceRoot });
  const workItem = status.workItems.find(row => row.workItemId === workItemId);
  if (workItem?.evidenceRequirement.policyId !== policyId) {
    throw new Error(`WorkItem evidence policy ${policyId} is not current.`);
  }
  return {
    status: "team_project_work_item_evidence_requirement",
    policyId,
    supersedesPolicyId: event.supersedesPolicyId ?? null,
    workItemId,
    requirement,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    authorizationGranted: false,
    exitCode: 0,
  };
}

function attestQuickReceiptBinding(workspaceRoot, receiptPath) {
  const root = realpathSync(workspaceRoot);
  const { absolutePath, bytes } = readFileBytesBounded(receiptPath);
  const result = attestCoreBoundQuickReceiptDetailsFromBytes({
    receiptPath: absolutePath,
    receiptBytes: bytes,
    workspaceRoot: root,
  });
  if (result.attestation.decision !== "GO") {
    throw new Error(
      `Quick receipt attestation must be GO; got ${result.attestation.decision}: `
      + `${result.attestation.issueCodes.join(", ") || "no issue code"}.`,
    );
  }
  return {
    kind: "quick",
    receiptId: result.attestation.subjectRef.receiptId,
    receiptRef: relativeToWorkspace(root, absolutePath),
    receiptSha256: result.attestation.subjectRef.receiptSha256,
    sourceFingerprint: result.sourceFingerprint,
    attestationDecision: "GO",
    issueCodes: [...result.attestation.issueCodes],
  };
}

export function checkpointTeamProjectFromQuickReceiptV1({
  workspaceRoot,
  checkpointId,
  occurredAt,
  assignmentId,
  workItemId,
  state,
  summary,
  completedUnits,
  evidenceRefs = [],
  blockerRefs = [],
  decisionRefs = [],
  nextAction = null,
  sourceFingerprint,
  receiptPath,
}) {
  safeIdentifier(checkpointId, "checkpointId");
  const receiptBinding = attestQuickReceiptBinding(workspaceRoot, receiptPath);
  if (sourceFingerprint !== undefined
    && sourceFingerprint !== receiptBinding.sourceFingerprint) {
    throw new Error("Checkpoint sourceFingerprint differs from the Quick receipt.");
  }
  const event = {
    schemaVersion: EVENT_SCHEMA_V7,
    eventId: `checkpoint-receipt-${checkpointId}`,
    type: "checkpoint_receipt_bound",
    occurredAt,
    checkpointId,
    assignmentId,
    workItemId,
    state,
    summary,
    ...(completedUnits === undefined ? {} : { completedUnits }),
    evidenceRefs: uniqueSorted([...evidenceRefs, receiptBinding.receiptRef]),
    blockerRefs,
    decisionRefs,
    nextAction,
    sourceFingerprint: receiptBinding.sourceFingerprint,
    receiptBinding,
    authorizationGranted: false,
  };
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV4({ workspaceRoot });
  const workItem = status.workItems.find(row => row.workItemId === workItemId);
  if (workItem?.boundVerificationReceipt?.checkpointId !== checkpointId) {
    throw new Error(`Receipt-bound checkpoint ${checkpointId} is not current.`);
  }
  return {
    status: "team_project_checkpoint",
    checkpointId,
    assignmentId,
    workItemId,
    state,
    receiptBinding,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    overall: status.overall,
    warnings: status.warnings.filter(row => row.workItemId === workItemId),
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function checkpointTeamProjectV1({
  workspaceRoot,
  checkpointId,
  occurredAt,
  assignmentId,
  workItemId,
  state,
  summary,
  completedUnits,
  evidenceRefs = [],
  blockerRefs = [],
  decisionRefs = [],
  nextAction = null,
  sourceFingerprint,
}) {
  safeIdentifier(checkpointId, "checkpointId");
  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `checkpoint-${checkpointId}`,
    type: "checkpoint_recorded",
    occurredAt,
    assignmentId,
    workItemId,
    state,
    summary,
    ...(completedUnits === undefined ? {} : { completedUnits }),
    evidenceRefs,
    blockerRefs,
    decisionRefs,
    nextAction,
    ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
  };
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV3({ workspaceRoot });
  if (recorded.resumed) {
    const loaded = loadProject(workspaceRoot);
    const stateProjection = projectEvents(loaded.definition, loaded.events);
    const currentAssignment = stateProjection.assignments.get(workItemId) ?? null;
    const latestFact = latestEventFact(
      stateProjection.checkpoints.get(workItemId) ?? null,
      stateProjection.handoffs.get(workItemId) ?? null,
    );
    if (currentAssignment?.assignmentId !== assignmentId || latestFact?.eventId !== event.eventId) {
      throw new Error(
        `Cannot resume historical/superseded checkpoint ${checkpointId}; `
        + `current assignment=${currentAssignment?.assignmentId ?? "none"}, `
        + `current owner=${currentAssignment?.agentId ?? "none"}, `
        + `latest fact=${latestFact?.eventId ?? "none"}.`,
      );
    }
  }
  return {
    status: "team_project_checkpoint",
    checkpointId,
    assignmentId,
    workItemId,
    state,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    overall: status.overall,
    warnings: status.warnings.filter(row => row.workItemId === workItemId),
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function reviseTeamProjectWorkItemScopeV1({
  workspaceRoot,
  revisionId,
  occurredAt,
  assignmentId,
  workItemId,
  ownerAgentId,
  ownedPaths,
  measurable = null,
  reason,
  evidenceRefs = [],
}) {
  safeIdentifier(revisionId, "revisionId");
  const loaded = loadProject(workspaceRoot);
  const state = projectEvents(loaded.definition, loaded.events);
  const baseWorkItem = loaded.definition.workItems.find(row => row.id === workItemId);
  if (!baseWorkItem) throw new Error(`Unknown team project WorkItem: ${workItemId}.`);
  const existing = loaded.events.find(row => (
    row.event.type === "work_item_scope_revised"
    && row.event.revisionId === revisionId
  ))?.event ?? null;
  let event;
  if (existing) {
    const requested = {
      occurredAt: normalizeTimestamp(occurredAt),
      assignmentId,
      workItemId,
      ownerAgentId,
      ownedPaths: validateLeaseOwnedPaths(ownedPaths),
      measurable,
      reason,
      evidenceRefs,
    };
    for (const key of Object.keys(requested)) {
      if (canonical(existing[key]) !== canonical(requested[key])) {
        throw new Error(`Cannot resume WorkItem scope revision ${revisionId}; ${key} differs.`);
      }
    }
    event = existing;
  } else {
    const previous = state.scopeRevisions.get(workItemId) ?? null;
    event = {
      schemaVersion: EVENT_SCHEMA_V5,
      eventId: `work-item-scope-revised-${revisionId}`,
      type: "work_item_scope_revised",
      occurredAt,
      revisionId,
      ...(previous ? { supersedesRevisionId: previous.revisionId } : {}),
      assignmentId,
      workItemId,
      ownerAgentId,
      previousOwnedPaths: [...(previous?.ownedPaths ?? baseWorkItem.ownedPaths)],
      ownedPaths,
      previousMeasurable: structuredClone(
        previous ? previous.measurable : baseWorkItem.measurable ?? null,
      ),
      measurable,
      reason,
      evidenceRefs,
    };
  }
  const recorded = appendTeamProjectEventV1({ workspaceRoot, event });
  const status = readTeamProjectStatusV3({ workspaceRoot });
  const workItem = status.workItems.find(row => row.workItemId === workItemId);
  return {
    status: "team_project_work_item_scope_revised",
    revisionId,
    workItemId,
    ownedPaths: [...workItem.ownedPaths],
    measurable: structuredClone(workItem.measurable),
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    resumed: recorded.resumed,
    projectTruthHash: status.projectTruthHash,
    nextAction: status.nextAction,
    nextActorId: status.nextActorId,
    authorizationGranted: false,
    exitCode: 0,
  };
}

function legacyWorkItemProjection(workItem) {
  if (workItem === null) return null;
  const {
    latestSourceDelivery: _latestSourceDelivery,
    invalidatedByReopenIds: _invalidatedByReopenIds,
    ownedPaths: _ownedPaths,
    measurable: _measurable,
    scopeRevision: _scopeRevision,
    evidenceRequirement: _evidenceRequirement,
    boundVerificationReceipt: _boundVerificationReceipt,
    ...legacy
  } = workItem;
  return legacy;
}

function statusV2WorkItemProjection(workItem) {
  if (workItem === null) return null;
  const {
    ownedPaths: _ownedPaths,
    measurable: _measurable,
    scopeRevision: _scopeRevision,
    evidenceRequirement: _evidenceRequirement,
    boundVerificationReceipt: _boundVerificationReceipt,
    ...v2
  } = workItem;
  return v2;
}

function statusV3WorkItemProjection(workItem) {
  if (workItem === null) return null;
  const {
    evidenceRequirement: _evidenceRequirement,
    boundVerificationReceipt: _boundVerificationReceipt,
    ...v3
  } = workItem;
  return v3;
}

function statusV3CompletionProjection(status) {
  if (status.overall !== "completed") {
    return { ...status, deliveryDisposition: "work_in_progress" };
  }
  const dominantGap = {
    kind: "release_authority",
    id: "release-authority",
    title: "Separate release authority",
    workItemId: null,
    agentId: null,
    reason: "Project work ledger is complete, but Git, release, deployment, production, and business authority remain outside Project Driver.",
    truthRefs: uniqueSorted([
      "project/definition.json",
      ...status.integrationGates.flatMap(gate => gate.truthRefs),
    ]),
  };
  const nextAction = "Obtain separate Git/release/deployment authority if activation is intended; otherwise stop.";
  return {
    ...status,
    deliveryDisposition: "code_complete_without_release_authority",
    headline: `code_complete_without_release_authority: work ledger completed; authorizationGranted=false; next: ${nextAction}`,
    dominantGap,
    nextAction,
    nextActorId: null,
  };
}

function statusV4DeliveryProjection(status) {
  if (status.overall !== "completed") {
    return {
      ...status,
      schemaVersion: STATUS_SCHEMA_V4,
      deliveryDisposition: status.deliveryLifecycle.currentStage,
    };
  }
  const dueGate = status.externalGates
    .filter(gate => gate.blocking)
    .sort((left, right) => (
      DELIVERY_STAGES.indexOf(left.requiredFor) - DELIVERY_STAGES.indexOf(right.requiredFor)
      || compareIdentifiers(left.gateId, right.gateId)
    ))
    .find(gate => status.deliveryLifecycle.blockingExternalGateIds.includes(gate.gateId))
    ?? null;
  if (dueGate) {
    const dominantGap = {
      kind: "external_gate",
      id: dueGate.gateId,
      title: dueGate.title,
      workItemId: null,
      agentId: dueGate.ownerAgentId,
      reason: dueGate.summary,
      truthRefs: uniqueSorted(dueGate.truthRefs),
    };
    const nextAction = `Reconcile external Gate ${dueGate.gateId}.`;
    return {
      ...status,
      schemaVersion: STATUS_SCHEMA_V4,
      deliveryDisposition: status.deliveryLifecycle.currentStage,
      headline: `Dominant gap: external Gate ${dueGate.gateId} (${dueGate.title}); `
        + `owner: ${dueGate.ownerAgentId}; blocker: ${singleLine(dueGate.summary)}; `
        + `next: ${nextAction}`,
      dominantGap,
      nextAction,
      nextActorId: dueGate.ownerAgentId,
    };
  }
  if (status.deliveryLifecycle.nextRequiredStage !== null) {
    const stage = status.deliveryLifecycle.nextRequiredStage;
    const stageProjection = status.deliveryLifecycle.stages.find(row => row.stage === stage);
    const dominantGap = {
      kind: "delivery_stage",
      id: stage,
      title: `Delivery stage ${stage}`,
      workItemId: null,
      agentId: stageProjection?.ownerAgentId ?? null,
      reason: stageProjection?.status === "pending"
        ? `Delivery stage ${stage} has no evidence-bound record.`
        : stageProjection?.summary ?? `Delivery stage ${stage} is not accepted.`,
      truthRefs: uniqueSorted([
        "project/definition.json",
        ...(stageProjection?.truthRef ? [stageProjection.truthRef] : []),
      ]),
    };
    const nextAction = `Record delivery stage ${stage}.`;
    return {
      ...status,
      schemaVersion: STATUS_SCHEMA_V4,
      deliveryDisposition: status.deliveryLifecycle.currentStage,
      headline: `Dominant gap: delivery stage ${stage}; owner: `
        + `${dominantGap.agentId ?? "unassigned"}; blocker: ${singleLine(dominantGap.reason)}; `
        + `next: ${nextAction}`,
      dominantGap,
      nextAction,
      nextActorId: dominantGap.agentId,
    };
  }
  return {
    ...status,
    schemaVersion: STATUS_SCHEMA_V4,
    deliveryDisposition: status.deliveryLifecycle.currentStage,
    headline: "Delivery lifecycle complete through product acceptance; authorizationGranted=false.",
    dominantGap: {
      kind: "none",
      id: null,
      title: null,
      workItemId: null,
      agentId: null,
      reason: null,
      truthRefs: uniqueSorted([
        "project/definition.json",
        ...status.deliveryLifecycle.stages
          .map(stage => stage.truthRef)
          .filter(Boolean),
      ]),
    },
    nextAction: null,
    nextActorId: null,
  };
}

export function readTeamProjectStatusV1({ workspaceRoot }) {
  const loaded = loadProject(workspaceRoot);
  const {
    sourceDeliveries: _sourceDeliveries,
    warnings: _warnings,
    externalGates: _externalGates,
    deliveryLifecycle: _deliveryLifecycle,
    ...legacy
  } = projectStatus(
    loaded.definition,
    loaded.events,
    loaded.root,
  );
  return {
    ...legacy,
    schemaVersion: STATUS_SCHEMA_V1,
    workItems: legacy.workItems.map(legacyWorkItemProjection),
    exitCode: 0,
  };
}

export function readTeamProjectStatusV2({ workspaceRoot }) {
  const loaded = loadProject(workspaceRoot);
  const {
    warnings: _warnings,
    externalGates: _externalGates,
    deliveryLifecycle: _deliveryLifecycle,
    ...v2
  } = projectStatus(
    loaded.definition,
    loaded.events,
    loaded.root,
  );
  return {
    ...v2,
    schemaVersion: STATUS_SCHEMA_V2,
    workItems: v2.workItems.map(statusV2WorkItemProjection),
    exitCode: 0,
  };
}

export function readTeamProjectStatusV3({ workspaceRoot }) {
  const loaded = loadProject(workspaceRoot);
  const {
    externalGates: _externalGates,
    deliveryLifecycle: _deliveryLifecycle,
    ...v3
  } = projectStatus(
    loaded.definition,
    loaded.events,
    loaded.root,
  );
  return {
    ...statusV3CompletionProjection(v3),
    workItems: v3.workItems.map(statusV3WorkItemProjection),
    exitCode: 0,
  };
}

export function readTeamProjectStatusV4({ workspaceRoot }) {
  const loaded = loadProject(workspaceRoot);
  return {
    ...statusV4DeliveryProjection(projectStatus(
      loaded.definition,
      loaded.events,
      loaded.root,
    )),
    exitCode: 0,
  };
}

export function readTeamProjectHookSourceV1({ workspaceRoot }) {
  const loaded = loadProject(workspaceRoot);
  const normalizedRecords = loaded.events
    .map(({ event, ref }) => ({
      event: validateEventShape(event, loaded.definition),
      ref,
    }))
    .sort((left, right) => compareEventFacts(left.event, right.event));
  const rawProjectTruthHash = sha256(canonical({
    definition: loaded.definition,
    events: loaded.events.map(row => row.event),
  }));
  const normalizedStatus = projectStatus(
    loaded.definition,
    normalizedRecords,
    loaded.root,
  );
  const status = {
    ...statusV4DeliveryProjection({
      ...normalizedStatus,
      projectTruthHash: rawProjectTruthHash,
    }),
    exitCode: 0,
  };
  return {
    status,
    latestProjectFactAt: normalizedRecords.at(-1)?.event.occurredAt ?? null,
  };
}

export function readTeamProjectHandoffWaitV1({ workspaceRoot }) {
  const { root, projectRoot: rootPath } = projectRoot(workspaceRoot);
  if (!existsSync(path.join(rootPath, "definition.json"))) {
    return {
      completedHandoffs: 0,
      unresolvedHandoffs: 0,
      staleHandoffs: 0,
      totalMs: 0,
      averageMs: 0,
      maxMs: 0,
      samples: [],
      inputRefs: [],
    };
  }
  const loaded = loadProject(root);
  const workFactTypes = new Set([
    "agent_assigned",
    "checkpoint_recorded",
    "handoff_recorded",
    "rework_returned",
    "source_delivery_imported",
    "upstream_reopened",
    "responsibility_transferred",
  ]);
  const samples = [];
  let unresolvedHandoffs = 0;
  let staleHandoffs = 0;
  const handoffs = loaded.events.filter(({ event }) => event.type === "handoff_recorded");
  for (const { event, ref } of handoffs) {
    const laterFacts = loaded.events.filter(({ event: later }) => (
      later.workItemId === event.workItemId
      && compareEventFacts(later, event) > 0
      && workFactTypes.has(later.type)
    ));
    const accepted = laterFacts.find(({ event: later }) => (
      later.type === "agent_assigned"
      && later.supersedesAssignmentId === event.assignmentId
      && later.agentId === event.toAgentId
    ));
    if (accepted) {
      const durationMs = Date.parse(accepted.event.occurredAt) - Date.parse(event.occurredAt);
      samples.push({
        handoffEventId: event.eventId,
        acceptedEventId: accepted.event.eventId,
        workItemId: event.workItemId,
        durationMs,
        handoffRef: ref,
        acceptedRef: accepted.ref,
      });
    } else if (laterFacts.length > 0) {
      staleHandoffs += 1;
    } else {
      unresolvedHandoffs += 1;
    }
  }
  const totalMs = samples.reduce((total, sample) => total + sample.durationMs, 0);
  return {
    completedHandoffs: samples.length,
    unresolvedHandoffs,
    staleHandoffs,
    totalMs,
    averageMs: samples.length === 0 ? 0 : Math.round(totalMs / samples.length),
    maxMs: samples.length === 0 ? 0 : Math.max(...samples.map(sample => sample.durationMs)),
    samples,
    inputRefs: loaded.events
      .filter(({ event }) => event.type === "handoff_recorded" || event.type === "agent_assigned")
      .map(({ ref }) => ref),
  };
}

function buildTeamProjectTakeover(
  { workspaceRoot, agentId },
  { includeTerminalFallback = true } = {},
) {
  safeIdentifier(agentId, "agentId");
  const loaded = loadProject(workspaceRoot);
  const status = projectStatus(loaded.definition, loaded.events, loaded.root);
  const responsibilities = status.workItems.filter(row => row.agentId === agentId);
  const current = responsibilities.find(row => (
    ["active", "verifying", "ready_to_integrate"].includes(row.status)
    && row.pendingHandoff === null
  ))
    ?? responsibilities.find(row => !["completed", "failed"].includes(row.status))
    ?? (includeTerminalFallback ? responsibilities.at(-1) : null)
    ?? null;
  const pendingForCurrent = current?.pendingHandoff ?? null;
  const pendingForAgent = status.workItems.find(row => (
    row.pendingHandoff?.toAgentId === agentId
  ))?.pendingHandoff ?? null;
  const pendingHandoff = pendingForCurrent ?? pendingForAgent;
  const staleHandoffs = staleHandoffsForTakeover({
    loaded,
    status,
    agentId,
    responsibilities,
  });
  const latestStaleHandoff = [...staleHandoffs]
    .sort(compareEventFacts)
    .at(-1) ?? null;
  const focusResponsibility = current
    ?? (pendingHandoff
      ? status.workItems.find(row => row.workItemId === pendingHandoff.workItemId) ?? null
      : null)
    ?? (latestStaleHandoff
      ? status.workItems.find(row => row.workItemId === latestStaleHandoff.workItemId) ?? null
      : null);
  const focusedDeliveries = focusResponsibility
    ? status.sourceDeliveries.filter(row => (
        row.workItemId === focusResponsibility.workItemId
      ))
    : [];
  const currentSourceDelivery = focusedDeliveries.at(-1) ?? null;
  const deliveryDelta = sourceDeliveryDelta(focusedDeliveries);
  const checkpoints = loaded.events
    .filter(row => row.event.type === "checkpoint_recorded"
      && responsibilities.some(item => item.workItemId === row.event.workItemId))
    .map(row => ({ ...row.event, truthRef: row.ref }));
  const lastCheckpoint = checkpoints.at(-1) ?? null;
  const evidenceRefs = [...new Set([
    ...(lastCheckpoint?.evidenceRefs ?? []),
    ...(current?.evidenceRefs ?? []),
    ...(pendingHandoff?.evidenceRefs ?? []),
    ...(currentSourceDelivery ? [currentSourceDelivery.truthRef] : []),
    ...(deliveryDelta?.previousDeliveryId ? [focusedDeliveries.at(-2).truthRef] : []),
    ...staleHandoffs.map(row => row.truthRef),
  ])].sort();
  const unresolvedDecisionsById = new Map();
  for (const decision of status.openDecisions) {
    if (decision.ownerAgentId === agentId
      || (current && openDecisionsForWorkItem(current, [decision]).length > 0)) {
      unresolvedDecisionsById.set(decision.decisionId, decision);
    }
  }
  const unresolvedDecisions = [...unresolvedDecisionsById.values()]
    .sort((left, right) => compareIdentifiers(left.decisionId, right.decisionId));
  const ownedDecision = status.openDecisions.find(row => (
    row.ownerAgentId === agentId
      && status.dominantGap.kind === "decision"
      && status.dominantGap.id === row.decisionId
  )) ?? status.openDecisions.find(row => row.ownerAgentId === agentId) ?? null;
  const blockingDecision = current
    ? openDecisionsForWorkItem(current, status.openDecisions)[0] ?? null
    : null;
  const deferredVerifications = status.deferredVerifications.filter(row => (
    row.status === "open" && row.ownerAgentId === agentId
  ));
  const ownedVerification = deferredVerifications[0] ?? null;
  let nextAction = null;
  if (pendingForAgent && !current) {
    nextAction = pendingForAgent.nextAction;
  } else if (pendingForCurrent) {
    nextAction = `Waiting for ${pendingForCurrent.toAgentId} to accept ${pendingForCurrent.workItemId}.`;
  } else if (ownedDecision) {
    nextAction = `Resolve ${ownedDecision.decisionId}`;
  } else if (blockingDecision) {
    nextAction = `Waiting for ${blockingDecision.ownerAgentId} to resolve ${blockingDecision.decisionId}.`;
  } else if (ownedVerification) {
    nextAction = `Run deferred verification ${ownedVerification.verificationId}`;
  } else if (current?.nextAction) {
    nextAction = current.nextAction;
  } else {
    nextAction = current && !["completed", "failed"].includes(current.status)
      ? `Continue ${current.workItemId}.`
      : current ? null : status.readyQueue[0] ? `Take ${status.readyQueue[0]}.` : null;
  }
  return {
    schemaVersion: "OwlCodaRunKitTeamProjectTakeoverV2",
    status: "team_project_takeover",
    projectId: status.projectId,
    objective: status.objective,
    overall: status.overall,
    projectHeadline: status.headline,
    dominantGap: status.dominantGap,
    projectNextAction: status.nextAction,
    projectNextActorId: status.nextActorId,
    agentId,
    currentResponsibility: statusV2WorkItemProjection(current),
    allResponsibilities: responsibilities.map(statusV2WorkItemProjection),
    pendingHandoff,
    staleHandoffs,
    currentSourceDelivery,
    sourceDeliveryDelta: deliveryDelta,
    lastAcceptedCheckpoint: lastCheckpoint
      ? {
          workItemId: lastCheckpoint.workItemId,
          assignmentId: lastCheckpoint.assignmentId,
          state: lastCheckpoint.state,
          summary: lastCheckpoint.summary,
          evidenceRefs: [...lastCheckpoint.evidenceRefs],
          occurredAt: lastCheckpoint.occurredAt,
          truthRef: lastCheckpoint.truthRef,
        }
      : null,
    unresolvedDecisions,
    deferredVerifications,
    dependencies: current?.unresolvedDependencies ?? [],
    evidenceRefs,
    nextAction,
    projectTruthHash: status.projectTruthHash,
    authorizationGranted: false,
    exitCode: 0,
  };
}

export function buildTeamProjectTakeoverV2(input) {
  return buildTeamProjectTakeover(input);
}

export function buildTeamProjectTakeoverV1(input) {
  const {
    staleHandoffs: _staleHandoffs,
    currentSourceDelivery: _currentSourceDelivery,
    sourceDeliveryDelta: _sourceDeliveryDelta,
    ...legacy
  } = buildTeamProjectTakeoverV2(input);
  const v2OnlyEvidenceRefs = new Set([
    ..._staleHandoffs.map(row => row.truthRef),
    ...readTeamProjectStatusV2({ workspaceRoot: input.workspaceRoot })
      .sourceDeliveries.map(row => row.truthRef),
  ]);
  return {
    ...legacy,
    schemaVersion: "OwlCodaRunKitTeamProjectTakeoverV1",
    currentResponsibility: legacyWorkItemProjection(legacy.currentResponsibility),
    allResponsibilities: legacy.allResponsibilities.map(legacyWorkItemProjection),
    evidenceRefs: legacy.evidenceRefs.filter(ref => !v2OnlyEvidenceRefs.has(ref)),
  };
}

export function buildTeamProjectTakeoverV3(input) {
  const legacy = buildTeamProjectTakeoverV2(input);
  const status = readTeamProjectStatusV3({ workspaceRoot: input.workspaceRoot });
  const byId = new Map(status.workItems.map(row => [row.workItemId, row]));
  return {
    ...legacy,
    schemaVersion: "OwlCodaRunKitTeamProjectTakeoverV3",
    projectHeadline: status.headline,
    dominantGap: status.dominantGap,
    projectNextAction: status.nextAction,
    projectNextActorId: status.nextActorId,
    currentResponsibility: legacy.currentResponsibility
      ? byId.get(legacy.currentResponsibility.workItemId) ?? null
      : null,
    allResponsibilities: legacy.allResponsibilities
      .map(row => byId.get(row.workItemId))
      .filter(Boolean),
    deliveryDisposition: status.deliveryDisposition,
    warnings: status.warnings,
    authorizationGranted: false,
  };
}

export function buildTeamProjectTakeoverV4(input) {
  const legacy = buildTeamProjectTakeover(input, { includeTerminalFallback: false });
  const status = readTeamProjectStatusV3({ workspaceRoot: input.workspaceRoot });
  const byId = new Map(status.workItems.map(row => [row.workItemId, row]));
  return {
    ...legacy,
    schemaVersion: "OwlCodaRunKitTeamProjectTakeoverV4",
    projectHeadline: status.headline,
    dominantGap: status.dominantGap,
    projectNextAction: status.nextAction,
    projectNextActorId: status.nextActorId,
    currentResponsibility: legacy.currentResponsibility
      ? byId.get(legacy.currentResponsibility.workItemId) ?? null
      : null,
    allResponsibilities: legacy.allResponsibilities
      .map(row => byId.get(row.workItemId))
      .filter(Boolean),
    deliveryDisposition: status.deliveryDisposition,
    warnings: status.warnings,
    authorizationGranted: false,
  };
}

export function formatTeamProjectStatusHumanV1(status) {
  const nextAction = status.nextAction === null ? "none" : singleLine(status.nextAction);
  return [
    status.headline,
    `Project: ${status.projectId} — ${singleLine(status.objective)}`,
    `State: ${status.overall}`,
    `Work: ${status.counts.completed}/${status.counts.total} completed; ${status.counts.active} active; ${status.counts.waiting_dependency + status.counts.waiting_decision} waiting`,
    `Agents: ${status.agents.map(agent => agent.agentId).join(", ") || "none assigned"}`,
    `Open decisions: ${status.openDecisions.map(row => row.decisionId).join(", ") || "none"}`,
    `Deferred verification: ${status.openDeferredVerificationIds.length} open${
      status.openDeferredVerificationIds.length > 0
        ? ` (${status.openDeferredVerificationIds.join(", ")})`
        : ""
    }`,
    `Ready queue: ${status.readyQueue.join(", ") || "none"}`,
    `Next: ${nextAction}${status.nextActorId ? ` (owner ${status.nextActorId})` : ""}`,
    "",
  ].join("\n");
}

export function formatTeamProjectStatusHumanV2(status) {
  const nextAction = status.nextAction === null ? "none" : singleLine(status.nextAction);
  const latestSourceDelivery = status.sourceDeliveries.at(-1) ?? null;
  return [
    status.headline,
    `Project: ${status.projectId} — ${singleLine(status.objective)}`,
    `Work ledger: ${status.overall}; Delivery: ${status.deliveryDisposition}`,
    `Work: ${status.counts.completed}/${status.counts.total} completed; ${status.counts.active} active; ${status.counts.waiting_dependency + status.counts.waiting_decision} waiting`,
    `Agents: ${status.agents.map(agent => agent.agentId).join(", ") || "none assigned"}`,
    `Open decisions: ${status.openDecisions.map(row => row.decisionId).join(", ") || "none"}`,
    `Deferred verification: ${status.openDeferredVerificationIds.length} open${
      status.openDeferredVerificationIds.length > 0
        ? ` (${status.openDeferredVerificationIds.join(", ")})`
        : ""
    }`,
    `Ready queue: ${status.readyQueue.join(", ") || "none"}`,
    `Source deliveries: ${status.sourceDeliveries.length}${latestSourceDelivery
      ? `; latest ${latestSourceDelivery.deliveryId} (${latestSourceDelivery.overlayStatus}, ${latestSourceDelivery.deliveryCandidateFingerprint})`
      : ""}`,
    ...(status.warnings?.length > 0
      ? [`Warnings: ${status.warnings.map(row => `${row.code}:${row.workItemId}`).join(", ")}`]
      : []),
    `Next: ${nextAction}${status.nextActorId ? ` (owner ${status.nextActorId})` : ""}; Authority: not granted for Git, release, deployment, production, or business actions.`,
    "",
  ].join("\n");
}

export function formatTeamProjectTakeoverHumanV2(takeover) {
  const responsibility = takeover.currentResponsibility;
  const agentNextAction = takeover.nextAction === null
    ? "none"
    : singleLine(takeover.nextAction);
  const projectNextAction = takeover.projectNextAction === null
    ? "none"
    : singleLine(takeover.projectNextAction);
  return [
    takeover.projectHeadline,
    `Project: ${takeover.projectId} — ${singleLine(takeover.objective)}`,
    ...(takeover.deliveryDisposition
      ? [`Delivery disposition: ${takeover.deliveryDisposition}`]
      : []),
    `Agent: ${takeover.agentId}`,
    `Responsibility: ${responsibility?.workItemId ?? "none"}`,
    `Open decisions: ${takeover.unresolvedDecisions.map(row => row.decisionId).join(", ") || "none"}`,
    `Deferred verification: ${takeover.deferredVerifications
      .map(row => row.verificationId).join(", ") || "none"}`,
    `Handoffs: pending ${takeover.pendingHandoff
      ? `${takeover.pendingHandoff.fromAgentId} -> ${takeover.pendingHandoff.toAgentId} for ${takeover.pendingHandoff.workItemId}`
      : "none"}; stale ${takeover.staleHandoffs.length > 0
      ? takeover.staleHandoffs.map(row => `${row.eventId} (${row.reason})`).join(", ")
      : "none"}`,
    `Candidate: ${takeover.currentSourceDelivery
      ? `${takeover.currentSourceDelivery.deliveryId} (${takeover.currentSourceDelivery.overlayStatus}, ${takeover.currentSourceDelivery.deliveryCandidateFingerprint})`
      : "none"}; delta ${takeover.sourceDeliveryDelta === null
      ? "none"
      : takeover.sourceDeliveryDelta.previousDeliveryId === null
        ? `first delivery; added ${takeover.sourceDeliveryDelta.addedPaths.length}`
        : `vs ${takeover.sourceDeliveryDelta.previousDeliveryId}; added ${takeover.sourceDeliveryDelta.addedPaths.length}, changed ${takeover.sourceDeliveryDelta.changedPaths.length}, removed ${takeover.sourceDeliveryDelta.removedPaths.length}, unchanged ${takeover.sourceDeliveryDelta.unchangedPaths.length}`}`,
    `Agent next: ${agentNextAction}`,
    `Project next: ${projectNextAction}${takeover.projectNextActorId ? ` (owner ${takeover.projectNextActorId})` : ""}`,
    `State: ${takeover.overall}`,
    ...(takeover.warnings?.length > 0
      ? [`Warnings: ${takeover.warnings.map(row => `${row.code}:${row.workItemId}`).join(", ")}`]
      : []),
    "",
  ].join("\n");
}

export function formatTeamProjectTakeoverHumanV1(takeover) {
  const responsibility = takeover.currentResponsibility;
  const agentNextAction = takeover.nextAction === null
    ? "none"
    : singleLine(takeover.nextAction);
  const projectNextAction = takeover.projectNextAction === null
    ? "none"
    : singleLine(takeover.projectNextAction);
  return [
    takeover.projectHeadline,
    `Project: ${takeover.projectId} — ${singleLine(takeover.objective)}`,
    `Agent: ${takeover.agentId}`,
    `Responsibility: ${responsibility?.workItemId ?? "none"}`,
    `Open decisions: ${takeover.unresolvedDecisions.map(row => row.decisionId).join(", ") || "none"}`,
    `Deferred verification: ${takeover.deferredVerifications
      .map(row => row.verificationId).join(", ") || "none"}`,
    `Pending handoff: ${takeover.pendingHandoff
      ? `${takeover.pendingHandoff.fromAgentId} -> ${takeover.pendingHandoff.toAgentId} for ${takeover.pendingHandoff.workItemId}`
      : "none"}`,
    `Agent next: ${agentNextAction}`,
    `Project next: ${projectNextAction}${takeover.projectNextActorId ? ` (owner ${takeover.projectNextActorId})` : ""}`,
    `State: ${takeover.overall}`,
    "",
  ].join("\n");
}
