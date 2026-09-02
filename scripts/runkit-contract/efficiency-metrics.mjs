import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import {
  decodeUtf8Strict,
  parseJsonStrict,
  readFileBytesBounded,
} from "../../packages/attest/src/formal.mjs";
import {
  canonicalJson,
  sha256Canonical,
} from "./quick-canonical.mjs";
import { readTrustedQuickReceiptHistory } from "./quick-metrics.mjs";
import {
  relativeToWorkspace,
  safeIdentifier,
  writeJsonExclusiveAtomically,
} from "./provenance-common.mjs";
import { readTeamProjectHandoffWaitV1 } from "./team-project.mjs";

const EFFICIENCY_ROOT = ".owlcoda/runkit/efficiency";
const EVENT_ROOT = `${EFFICIENCY_ROOT}/events`;
const EVENT_SCHEMA = "OwlCodaRunKitEfficiencyEventV1";
const EVENT_KINDS = new Set([
  "workflow_started",
  "false_block_confirmed",
  "manual_intervention",
  "acceptable_result_reached",
]);
const EVENT_KEYS = [
  "schemaVersion",
  "eventId",
  "kind",
  "occurredAt",
  "workflowId",
  "summary",
  "evidenceRefs",
  "authorizationGranted",
];

function compareIdentifiers(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(
      "Efficiency event --at must be an ISO-8601 UTC timestamp "
      + "(YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.sssZ).",
    );
  }
  return new Date(value).toISOString();
}

function normalizeEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort(compareIdentifiers).join("\0")
      !== [...EVENT_KEYS].sort(compareIdentifiers).join("\0")) {
    throw new Error("Efficiency event must use the exact V1 fields.");
  }
  if (value.schemaVersion !== EVENT_SCHEMA) {
    throw new Error("Efficiency event schemaVersion is unsupported.");
  }
  safeIdentifier(value.eventId, "efficiency eventId");
  safeIdentifier(value.workflowId, "efficiency workflowId");
  if (value.eventId.length > 128 || value.workflowId.length > 128) {
    throw new Error("Efficiency event and workflow identifiers must not exceed 128 characters.");
  }
  if (!EVENT_KINDS.has(value.kind)) throw new Error("Efficiency event kind is unsupported.");
  const occurredAt = validateTimestamp(value.occurredAt);
  if (typeof value.summary !== "string"
    || value.summary.trim().length === 0
    || value.summary.length > 2_000) {
    throw new Error("Efficiency event summary must contain 1 to 2000 characters.");
  }
  if (!Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.length > 100
    || value.evidenceRefs.some(ref => typeof ref !== "string" || ref.trim().length === 0)
    || value.evidenceRefs.some(ref => Buffer.byteLength(ref, "utf8") > 2_048)
    || new Set(value.evidenceRefs).size !== value.evidenceRefs.length) {
    throw new Error("Efficiency event evidenceRefs must be a unique string array.");
  }
  if (value.authorizationGranted !== false) {
    throw new Error("Efficiency events cannot grant authority.");
  }
  return {
    schemaVersion: EVENT_SCHEMA,
    eventId: value.eventId,
    kind: value.kind,
    occurredAt,
    workflowId: value.workflowId,
    summary: value.summary.trim(),
    evidenceRefs: [...value.evidenceRefs].sort(compareIdentifiers),
    authorizationGranted: false,
  };
}

function ensureDirectory(root, current, label, { create }) {
  if (!existsSync(current)) {
    if (!create) return false;
    try {
      mkdirSync(current);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const stat = lstatSync(current);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(current) !== current) {
    throw new Error(`${label} must be a real project-local directory tree.`);
  }
  const relative = path.relative(root, current);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the project workspace.`);
  }
  return true;
}

function efficiencyRootState(workspaceRoot, { create = false } = {}) {
  const root = realpathSync(workspaceRoot);
  let current = root;
  for (const segment of EFFICIENCY_ROOT.split("/")) {
    current = path.join(current, segment);
    if (!ensureDirectory(root, current, "Efficiency event store", { create })) {
      return {
        status: "missing",
        root,
        efficiencyRoot: path.join(root, EFFICIENCY_ROOT),
      };
    }
  }
  return { status: "valid", root, efficiencyRoot: current };
}

function eventRootState(workspaceRoot, { create = false } = {}) {
  const efficiency = efficiencyRootState(workspaceRoot, { create });
  const eventRoot = path.join(efficiency.root, EVENT_ROOT);
  if (efficiency.status === "missing"
    || !ensureDirectory(efficiency.root, eventRoot, "Efficiency event store", { create })) {
    return { status: "missing", root: efficiency.root, eventRoot };
  }
  return { status: "valid", root: efficiency.root, eventRoot };
}

function withEfficiencyLock(workspaceRoot, operation) {
  const selected = efficiencyRootState(workspaceRoot, { create: true });
  const lockPath = path.join(selected.efficiencyRoot, "control.lock");
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Another efficiency event transaction is active.");
    }
    throw error;
  }
  try {
    return operation(selected.root);
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function readStoredEvent(eventPath) {
  const stat = lstatSync(eventPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Efficiency event must be a regular non-symlink file.");
  }
  const { bytes } = readFileBytesBounded(eventPath);
  const parsed = parseJsonStrict(decodeUtf8Strict(bytes));
  const normalized = normalizeEvent(parsed);
  if (canonicalJson(parsed) !== canonicalJson(normalized)) {
    throw new Error("Efficiency event bytes do not match the canonical V1 event.");
  }
  return normalized;
}

function readEvents(workspaceRoot) {
  const selected = eventRootState(workspaceRoot);
  if (selected.status === "missing") return { root: selected.root, events: [], inputRefs: [] };
  const entries = readdirSync(selected.eventRoot, { withFileTypes: true })
    .sort((left, right) => compareIdentifiers(left.name, right.name));
  const events = [];
  const inputRefs = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      throw new Error("Efficiency event store contains an unsupported entry.");
    }
    const eventId = entry.name.slice(0, -".json".length);
    safeIdentifier(eventId, "efficiency event filename");
    const eventPath = path.join(selected.eventRoot, entry.name);
    const event = readStoredEvent(eventPath);
    if (event.eventId !== eventId) throw new Error("Efficiency event filename does not match eventId.");
    events.push(event);
    inputRefs.push(relativeToWorkspace(selected.root, eventPath));
  }
  events.sort((left, right) => (
    compareIdentifiers(left.occurredAt, right.occurredAt)
    || compareIdentifiers(left.eventId, right.eventId)
  ));
  const workflows = new Map();
  for (const event of events) {
    const rows = workflows.get(event.workflowId) ?? [];
    rows.push(event);
    workflows.set(event.workflowId, rows);
  }
  for (const [workflowId, rows] of workflows) {
    const starts = rows.filter(row => row.kind === "workflow_started");
    const results = rows.filter(row => row.kind === "acceptable_result_reached");
    if (starts.length > 1) {
      throw new Error(`Efficiency workflow ${workflowId} has multiple workflow_started events.`);
    }
    if (results.length > 1) {
      throw new Error(`Efficiency workflow ${workflowId} has multiple acceptable_result_reached events.`);
    }
    if (results.length === 1 && starts.length !== 1) {
      throw new Error(`Efficiency workflow ${workflowId} has an acceptable result without workflow_started.`);
    }
    if (results.length === 1 && results[0].occurredAt < starts[0].occurredAt) {
      throw new Error(`Efficiency workflow ${workflowId} has an acceptable result before workflow_started.`);
    }
  }
  return { root: selected.root, events, inputRefs };
}

function validateEventAgainstHistory(history, event) {
  const existing = history.events.find(row => row.eventId === event.eventId);
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(event)) {
      throw new Error(`Efficiency event ${event.eventId} is immutable and differs.`);
    }
    return { existing };
  }
  const workflowEvents = history.events.filter(row => row.workflowId === event.workflowId);
  const workflowStart = workflowEvents.find(row => row.kind === "workflow_started");
  if (event.kind === "workflow_started" && workflowStart) {
    throw new Error(`Efficiency workflow ${event.workflowId} already has a workflow_started event.`);
  }
  if (event.kind === "acceptable_result_reached") {
    if (!workflowStart) {
      throw new Error("acceptable_result_reached requires an earlier workflow_started event.");
    }
    if (workflowEvents.some(row => row.kind === "acceptable_result_reached")) {
      throw new Error(`Efficiency workflow ${event.workflowId} already reached an acceptable result.`);
    }
    if (event.occurredAt < workflowStart.occurredAt) {
      throw new Error("acceptable_result_reached cannot precede workflow_started.");
    }
  }
  return { existing: null };
}

export function recordEfficiencyEventV1({
  workspaceRoot,
  eventId,
  occurredAt,
  kind,
  workflowId,
  summary,
  evidenceRefs = [],
}) {
  const event = normalizeEvent({
    schemaVersion: EVENT_SCHEMA,
    eventId,
    kind,
    occurredAt,
    workflowId,
    summary,
    evidenceRefs,
    authorizationGranted: false,
  });
  const history = readEvents(workspaceRoot);
  const eventPath = path.join(history.root, EVENT_ROOT, `${event.eventId}.json`);
  const initial = validateEventAgainstHistory(history, event);
  if (initial.existing) {
    return {
      status: "efficiency_event_recorded",
      exitCode: 0,
      eventId: event.eventId,
      eventPath: relativeToWorkspace(history.root, eventPath),
      eventSha256: sha256Canonical(event),
      resumed: true,
      authorizationGranted: false,
    };
  }
  return withEfficiencyLock(history.root, (root) => {
    const refreshed = readEvents(root);
    const current = validateEventAgainstHistory(refreshed, event);
    const lockedEventPath = path.join(root, EVENT_ROOT, `${event.eventId}.json`);
    if (current.existing) {
      return {
        status: "efficiency_event_recorded",
        exitCode: 0,
        eventId: event.eventId,
        eventPath: relativeToWorkspace(root, lockedEventPath),
        eventSha256: sha256Canonical(event),
        resumed: true,
        authorizationGranted: false,
      };
    }
    const selected = eventRootState(root, { create: true });
    writeJsonExclusiveAtomically(lockedEventPath, event);
    return {
      status: "efficiency_event_recorded",
      exitCode: 0,
      eventId: event.eventId,
      eventPath: relativeToWorkspace(selected.root, lockedEventPath),
      eventSha256: sha256Canonical(event),
      resumed: false,
      authorizationGranted: false,
    };
  });
}

function dependencyFingerprint(receipt) {
  return receipt.executionIsolation?.dependencyEnvironment?.fingerprint ?? null;
}

function commandBinding(receipt) {
  return {
    executable: receipt.exactCommand.executable,
    argv: receipt.exactCommand.argv,
    workspaceSnapshotFingerprint: receipt.workspaceBefore.sourceFingerprint,
    ignoredPathsFingerprint: receipt.workspaceBefore.ignoredPathsFingerprint ?? null,
    stdinSha256: receipt.inputArtifacts?.stdin?.sha256 ?? null,
    dependencyEnvironmentFingerprint: dependencyFingerprint(receipt),
  };
}

function duplicateCommandMetrics(root, history) {
  const groups = new Map();
  for (const { receiptPath, receipt } of history.receipts) {
    const bindingFingerprint = sha256Canonical(commandBinding(receipt));
    const group = groups.get(bindingFingerprint) ?? {
      bindingFingerprint,
      executions: 0,
      inputRefs: [],
    };
    group.executions += 1;
    group.inputRefs.push(relativeToWorkspace(root, receiptPath));
    groups.set(bindingFingerprint, group);
  }
  const repeated = [...groups.values()]
    .filter(group => group.executions > 1)
    .sort((left, right) => compareIdentifiers(left.bindingFingerprint, right.bindingFingerprint));
  return {
    summary: {
      repeatedExecutions: repeated.reduce((total, group) => total + group.executions - 1, 0),
      groupCount: repeated.length,
      basis: "quick_receipts_same_command_candidate_input_and_dependency",
    },
    groups: repeated,
  };
}

function workflowMetrics(events) {
  const byWorkflow = new Map();
  for (const event of events) {
    const rows = byWorkflow.get(event.workflowId) ?? [];
    rows.push(event);
    byWorkflow.set(event.workflowId, rows);
  }
  const durations = [];
  for (const [workflowId, rows] of byWorkflow) {
    const started = rows.find(event => event.kind === "workflow_started");
    if (!started) continue;
    const completed = rows.find(event => (
      event.kind === "acceptable_result_reached"
      && event.occurredAt >= started.occurredAt
    ));
    if (!completed) continue;
    durations.push({
      workflowId,
      startedAt: started.occurredAt,
      acceptableResultAt: completed.occurredAt,
      durationMs: Date.parse(completed.occurredAt) - Date.parse(started.occurredAt),
    });
  }
  durations.sort((left, right) => (
    compareIdentifiers(left.acceptableResultAt, right.acceptableResultAt)
    || compareIdentifiers(left.workflowId, right.workflowId)
  ));
  if (durations.length === 0) {
    return {
      summary: {
        status: "not_observed",
        completedWorkflows: 0,
        totalMs: 0,
        averageMs: 0,
        minMs: 0,
        maxMs: 0,
        latestMs: 0,
      },
      durations,
    };
  }
  const totalMs = durations.reduce((total, row) => total + row.durationMs, 0);
  return {
    summary: {
      status: "observed",
      completedWorkflows: durations.length,
      totalMs,
      averageMs: Math.round(totalMs / durations.length),
      minMs: Math.min(...durations.map(row => row.durationMs)),
      maxMs: Math.max(...durations.map(row => row.durationMs)),
      latestMs: durations.at(-1).durationMs,
    },
    durations,
  };
}

function emptyHandoffWait() {
  return {
    completedHandoffs: 0,
    unresolvedHandoffs: 0,
    staleHandoffs: 0,
    totalMs: 0,
    averageMs: 0,
    maxMs: 0,
  };
}

export function readEfficiencyMetricsV1({ workspaceRoot, verbose = false }) {
  const root = realpathSync(workspaceRoot);
  try {
    const eventHistory = readEvents(root);
    const quickHistory = readTrustedQuickReceiptHistory(root);
    if (quickHistory.status === "invalid") {
      throw new Error("Quick receipt store is invalid.");
    }
    const duplicateCommands = duplicateCommandMetrics(root, quickHistory);
    const workflows = workflowMetrics(eventHistory.events);
    const handoff = readTeamProjectHandoffWaitV1({ workspaceRoot: root });
    const issueCodes = quickHistory.invalidCount > 0
      ? ["invalid_quick_receipts_excluded"]
      : [];
    return {
      schemaVersion: "OwlCodaRunKitEfficiencyMetricsV1",
      status: "efficiency_metrics",
      exitCode: 0,
      telemetry: false,
      networkRequests: 0,
      duplicateCommands: duplicateCommands.summary,
      confirmedFalseBlocks: {
        count: eventHistory.events.filter(event => event.kind === "false_block_confirmed").length,
        basis: "explicit_events",
      },
      manualInterventions: {
        count: eventHistory.events.filter(event => event.kind === "manual_intervention").length,
        basis: "explicit_events",
      },
      handoffWait: {
        completedHandoffs: handoff.completedHandoffs,
        unresolvedHandoffs: handoff.unresolvedHandoffs,
        staleHandoffs: handoff.staleHandoffs,
        totalMs: handoff.totalMs,
        averageMs: handoff.averageMs,
        maxMs: handoff.maxMs,
      },
      timeToAcceptableResult: workflows.summary,
      ...(verbose
        ? {
            details: {
              duplicateCommandGroups: duplicateCommands.groups,
              workflowDurations: workflows.durations,
              handoffSamples: handoff.samples,
              inputRefs: [...new Set([
                ...eventHistory.inputRefs,
                ...quickHistory.receiptPaths.map(receiptPath => relativeToWorkspace(root, receiptPath)),
                ...handoff.inputRefs,
              ])].sort(compareIdentifiers),
            },
          }
        : {}),
      issueCodes,
      issues: [],
      authorizationGranted: false,
    };
  } catch (error) {
    return {
      schemaVersion: "OwlCodaRunKitEfficiencyMetricsV1",
      status: "efficiency_metrics_invalid",
      exitCode: 3,
      telemetry: false,
      networkRequests: 0,
      duplicateCommands: {
        repeatedExecutions: 0,
        groupCount: 0,
        basis: "quick_receipts_same_command_candidate_input_and_dependency",
      },
      confirmedFalseBlocks: { count: 0, basis: "explicit_events" },
      manualInterventions: { count: 0, basis: "explicit_events" },
      handoffWait: emptyHandoffWait(),
      timeToAcceptableResult: {
        status: "not_observed",
        completedWorkflows: 0,
        totalMs: 0,
        averageMs: 0,
        minMs: 0,
        maxMs: 0,
        latestMs: 0,
      },
      issueCodes: ["efficiency_input_store_invalid"],
      issues: [error instanceof Error ? error.message : String(error)],
      authorizationGranted: false,
    };
  }
}

function duration(value, observed) {
  if (!observed) return "not observed";
  if (value === 0) return "0ms";
  if (value >= 60_000) {
    const minutes = Math.round((value / 60_000) * 10) / 10;
    return `${minutes}m`;
  }
  if (value >= 1_000) {
    const seconds = Math.round((value / 1_000) * 10) / 10;
    return `${seconds}s`;
  }
  return `${value}ms`;
}

export function formatEfficiencyMetricsHumanV1(metrics) {
  if (metrics.status !== "efficiency_metrics") {
    return [
      "RunKit friction: unavailable because a project-local input store is invalid.",
      `Issue: ${metrics.issues.join("; ")}`,
      "Next: repair the invalid local evidence store before using these metrics.",
      "Authority: no Git, release, deployment, production, or business authority granted.",
    ].join("\n");
  }
  return [
    "RunKit friction: "
      + `${metrics.duplicateCommands.repeatedExecutions} repeated Quick command executions; `
      + `${metrics.confirmedFalseBlocks.count} confirmed false blocks; `
      + `${metrics.manualInterventions.count} manual interventions.`,
    `Repeated Quick command executions: ${metrics.duplicateCommands.repeatedExecutions} `
      + `(same command, candidate, input, and dependency binding).`,
    `Confirmed false blocks: ${metrics.confirmedFalseBlocks.count}; `
      + `Manual interventions: ${metrics.manualInterventions.count} (explicit marks only).`,
    `Handoff wait: ${metrics.handoffWait.completedHandoffs} completed, `
      + `${duration(metrics.handoffWait.averageMs, metrics.handoffWait.completedHandoffs > 0)} average; `
      + `${metrics.handoffWait.unresolvedHandoffs} unresolved; `
      + `${metrics.handoffWait.staleHandoffs} stale.`,
    `Time to acceptable result: ${duration(
      metrics.timeToAcceptableResult.averageMs,
      metrics.timeToAcceptableResult.status === "observed",
    )} `
      + `across ${metrics.timeToAcceptableResult.completedWorkflows} observed workflows.`,
    "Basis: project-local receipts and explicit events only; telemetry and network requests are disabled.",
    "Authority: no Git, release, deployment, production, or business authority granted.",
  ].join("\n");
}
