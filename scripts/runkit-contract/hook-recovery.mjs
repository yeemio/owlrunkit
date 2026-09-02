import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  RUNTIME_ROOT,
  currentCoreIdentity,
  validateExecutionPin,
  validateProjectConfigV2,
} from "./core-contract.mjs";
import { inspectProjectControlState } from "./project-control-state.mjs";
import { readTeamProjectHookSourceV1 } from "./team-project.mjs";

const MAX_OUTPUT_BYTES = 2_000;
const MAX_CONTROL_BYTES = 1_048_576;
const MAX_PROJECT_ID_BYTES = 96;
const MAX_ACTOR_ID_BYTES = 96;
const MAX_GAP_ID_BYTES = 96;
const MAX_OBJECTIVE_PREVIEW_BYTES = 180;
const MAX_HEADLINE_BYTES = 120;
const MAX_GAP_REASON_BYTES = 120;
const MAX_NEXT_ACTION_BYTES = 120;
const MAX_WARNING_CODES = 4;
const MAX_WARNING_CODE_BYTES = 64;

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

function sha256Ref(value) {
  return "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(".." + path.sep)
      && !path.isAbsolute(relative)
    );
}

function canonicalWorkspaceRoot(workspaceRoot) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new Error("workspace_required");
  }
  const requested = path.resolve(workspaceRoot);
  const stat = lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("workspace_redirected");
  }
  const real = realpathSync(requested);
  return real;
}

function readRegularJsonBounded(root, filePath, label) {
  const stat = lstatSync(filePath);
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || stat.size > MAX_CONTROL_BYTES
  ) {
    throw new Error(label + "_invalid");
  }
  const real = realpathSync(filePath);
  if (real !== path.resolve(filePath) || !withinRoot(root, real)) {
    throw new Error(label + "_redirected");
  }
  return JSON.parse(readFileSync(real, "utf8"));
}

function unsafeCodePoint(codePoint) {
  return codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    || codePoint === 0x2028
    || codePoint === 0x2029;
}

function escapedCodePoint(character) {
  const codePoint = character.codePointAt(0);
  if (!unsafeCodePoint(codePoint)) return character;
  if (codePoint <= 0xffff) {
    return "\\u" + codePoint.toString(16).padStart(4, "0");
  }
  return "\\u{" + codePoint.toString(16) + "}";
}

function boundedUntrustedText(value, maxBytes) {
  if (value === null || value === undefined) {
    return { value: null, truncated: false };
  }
  let rendered = "";
  let renderedBytes = 0;
  let truncated = false;
  for (const character of String(value)) {
    const token = escapedCodePoint(character);
    const tokenBytes = Buffer.byteLength(token);
    if (renderedBytes + tokenBytes + 3 > maxBytes) {
      truncated = true;
      break;
    }
    rendered += token;
    renderedBytes += tokenBytes;
  }
  if (truncated) rendered += "…";
  return { value: rendered, truncated };
}

function exactBoundedIdentity(value, maxBytes) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return Buffer.byteLength(text) <= maxBytes ? text : null;
}

function safeWarningCode(value) {
  if (
    typeof value !== "string"
    || !/^[a-z0-9][a-z0-9._:-]*$/u.test(value)
    || Buffer.byteLength(value) > MAX_WARNING_CODE_BYTES
  ) {
    return "unclassified_warning";
  }
  return value;
}

function warningSummary(entries) {
  const groups = new Map();
  let count = 0;
  let blockingCount = 0;
  for (const entry of entries) {
    const increment = Number.isSafeInteger(entry.count) && entry.count > 0
      ? entry.count
      : 1;
    count += increment;
    if (entry.blocking === true) blockingCount += increment;
    const code = safeWarningCode(entry.code);
    const current = groups.get(code) ?? { code, count: 0, blocking: false };
    current.count += increment;
    current.blocking ||= entry.blocking === true;
    groups.set(code, current);
  }
  const ordered = [...groups.values()].sort((left, right) => (
    compareCodeUnits(left.code, right.code)
  ));
  return {
    count,
    blockingCount,
    codes: ordered.slice(0, MAX_WARNING_CODES).map(group => group.code),
    truncated: ordered.length > MAX_WARNING_CODES,
  };
}

function executionProjection(control) {
  return {
    state: control?.recovery?.state ?? "invalid_control_truth",
    openCount: control?.activeRunIds?.length ?? 0,
    activeLeaseCount: control?.activeLeaseIds?.length ?? 0,
  };
}

function noProjectGap() {
  return {
    kind: "no_project_driver",
    id: null,
    reason: "No Project Driver is initialized.",
    truncated: false,
  };
}

function invalidGap() {
  return {
    kind: "invalid_control_truth",
    id: null,
    reason: "RunKit control truth must be repaired before recovery.",
    truncated: false,
  };
}

function projectGap(status) {
  const kind = safeWarningCode(status.dominantGap?.kind ?? "none");
  const id = exactBoundedIdentity(status.dominantGap?.id, MAX_GAP_ID_BYTES);
  const reason = boundedUntrustedText(
    status.dominantGap?.reason,
    MAX_GAP_REASON_BYTES,
  );
  return {
    kind,
    id,
    reason: reason.value,
    truncated: reason.truncated
      || (status.dominantGap?.id !== null
        && status.dominantGap?.id !== undefined
        && id === null),
  };
}

function baseProjection({
  status,
  exitCode,
  execution,
  warnings,
  project = null,
  nextAction = null,
}) {
  const objective = project
    ? boundedUntrustedText(project.status.objective, MAX_OBJECTIVE_PREVIEW_BYTES)
    : { value: null, truncated: false };
  const headline = project
    ? boundedUntrustedText(project.status.headline, MAX_HEADLINE_BYTES)
    : { value: null, truncated: false };
  const next = boundedUntrustedText(nextAction, MAX_NEXT_ACTION_BYTES);
  const projectedGap = project ? projectGap(project.status) : noProjectGap();
  return {
    schemaVersion: "OwlCodaRunKitHookRecoveryV1",
    status,
    exitCode,
    projectId: project
      ? exactBoundedIdentity(project.status.projectId, MAX_PROJECT_ID_BYTES)
      : null,
    projectTruthHash: project?.status.projectTruthHash ?? null,
    objectiveDigest: project ? sha256Ref(project.status.objective) : null,
    objectivePreview: objective.value,
    objectiveTruncated: objective.truncated,
    projectTextTrust: "untrusted_data",
    overall: project?.status.overall ?? null,
    progress: {
      completedWorkItems: project?.status.counts?.completed ?? null,
      totalWorkItems: project?.status.counts?.total ?? null,
    },
    headline: headline.value,
    dominantGap: status === "invalid_control_truth"
      ? invalidGap()
      : projectedGap,
    nextActorId: project
      ? exactBoundedIdentity(project.status.nextActorId, MAX_ACTOR_ID_BYTES)
      : null,
    nextAction: next.value,
    deliveryDisposition: project?.status.deliveryDisposition ?? null,
    execution,
    warnings,
    latestProjectFactAt: project?.latestProjectFactAt ?? null,
    textTruncated: objective.truncated
      || headline.truncated
      || projectedGap.truncated
      || next.truncated,
    readOnly: true,
    writesPerformed: false,
    authorityBoundary: { ...AUTHORITY_BOUNDARY },
    authorizationGranted: false,
  };
}

function outputBytes(value) {
  return Buffer.byteLength(JSON.stringify(value) + "\n");
}

function enforceOutputBound(value) {
  if (outputBytes(value) <= MAX_OUTPUT_BYTES) return value;
  const fallback = {
    ...value,
    status: "invalid_control_truth",
    exitCode: 2,
    projectId: null,
    objectivePreview: null,
    objectiveTruncated: true,
    headline: "Hook recovery projection exceeded its byte bound.",
    dominantGap: invalidGap(),
    nextActorId: null,
    nextAction: "inspect_project_truth_manually",
    warnings: warningSummary([{
      code: "projection_byte_limit_exceeded",
      blocking: true,
    }]),
    textTruncated: true,
  };
  if (outputBytes(fallback) > MAX_OUTPUT_BYTES) {
    throw new Error("hook_recovery_byte_bound_invariant_failed");
  }
  return fallback;
}

function invalidProjection({
  execution = executionProjection(null),
  warningCodes,
  nextAction,
  project = null,
}) {
  return enforceOutputBound(baseProjection({
    status: "invalid_control_truth",
    exitCode: 2,
    execution,
    warnings: warningSummary(warningCodes.map(code => ({
      code,
      blocking: true,
    }))),
    project,
    nextAction,
  }));
}

function inspectCoreBinding(root) {
  try {
    const configPath = path.join(root, RUNTIME_ROOT, "config.json");
    if (!pathEntryExists(configPath)) {
      return { valid: false, code: "core_config_missing" };
    }
    const config = readRegularJsonBounded(root, configPath, "core_config");
    const configGate = validateProjectConfigV2(config);
    if (!configGate.valid) {
      return { valid: false, code: "core_config_invalid" };
    }
    const pinGate = validateExecutionPin({
      expected: config.core,
      actual: currentCoreIdentity(),
    });
    return pinGate.status === "valid"
      ? { valid: true }
      : { valid: false, code: "core_version_mismatch" };
  } catch {
    return { valid: false, code: "core_config_invalid" };
  }
}

function readProjectSource(root) {
  try {
    const projectRoot = path.join(root, RUNTIME_ROOT, "project");
    if (!pathEntryExists(projectRoot)) {
      return { state: "absent", project: null };
    }
    const projectStat = lstatSync(projectRoot);
    const projectReal = realpathSync(projectRoot);
    if (
      projectStat.isSymbolicLink()
      || !projectStat.isDirectory()
      || projectReal !== path.resolve(projectRoot)
      || !withinRoot(root, projectReal)
    ) {
      return { state: "invalid", project: null };
    }
    const definitionPath = path.join(projectRoot, "definition.json");
    if (!pathEntryExists(definitionPath)) {
      return { state: "invalid", project: null };
    }
    return {
      state: "valid",
      project: readTeamProjectHookSourceV1({ workspaceRoot: root }),
    };
  } catch {
    return { state: "invalid", project: null };
  }
}

export function buildHookRecoveryV1({ workspaceRoot } = {}) {
  let root;
  try {
    root = canonicalWorkspaceRoot(workspaceRoot);
  } catch {
    return invalidProjection({
      warningCodes: ["workspace_invalid"],
      nextAction: "repair_workspace_binding",
    });
  }

  const core = inspectCoreBinding(root);
  let control;
  try {
    control = inspectProjectControlState({
      workspaceRoot: root,
      currentCore: currentCoreIdentity(),
    });
  } catch {
    control = null;
  }
  const execution = executionProjection(control);
  const projectSource = readProjectSource(root);
  const project = projectSource.project;

  if (!core.valid) {
    return invalidProjection({
      execution,
      warningCodes: [core.code],
      nextAction: "repair_core_binding",
      project,
    });
  }
  if (!control || control.status === "invalid") {
    return invalidProjection({
      execution,
      warningCodes: ["control_truth_invalid"],
      nextAction: "repair_execution_artifacts",
      project,
    });
  }
  if (control.activeRunIds.length > 1) {
    return invalidProjection({
      execution,
      warningCodes: ["multiple_active_executions"],
      nextAction: "select_active_execution",
      project,
    });
  }
  if (control.closedHistory?.blocking === true) {
    return invalidProjection({
      execution,
      warningCodes: ["ambiguous_closed_history"],
      nextAction: "repair_execution_lineage",
      project,
    });
  }
  if (projectSource.state === "invalid") {
    return invalidProjection({
      execution,
      warningCodes: ["project_truth_invalid"],
      nextAction: "repair_project_truth",
    });
  }
  if (projectSource.state === "absent") {
    return enforceOutputBound(baseProjection({
      status: "no_project_driver",
      exitCode: 0,
      execution,
      warnings: warningSummary([]),
      nextAction: control.activeRunIds.length === 1
        ? "inspect_active_execution"
        : null,
    }));
  }

  const identityIssues = [];
  if (exactBoundedIdentity(project.status.projectId, MAX_PROJECT_ID_BYTES) === null) {
    identityIssues.push("project_id_exceeds_hook_bound");
  }
  if (
    project.status.nextActorId !== null
    && exactBoundedIdentity(project.status.nextActorId, MAX_ACTOR_ID_BYTES) === null
  ) {
    identityIssues.push("next_actor_id_exceeds_hook_bound");
  }
  if (
    project.status.dominantGap?.id !== null
    && exactBoundedIdentity(project.status.dominantGap.id, MAX_GAP_ID_BYTES) === null
  ) {
    identityIssues.push("dominant_gap_id_exceeds_hook_bound");
  }
  if (identityIssues.length > 0) {
    return invalidProjection({
      execution,
      warningCodes: identityIssues,
      nextAction: "inspect_project_truth_manually",
      project,
    });
  }

  const warningEntries = (project.status.warnings ?? []).map(warning => ({
    code: warning.code,
    count: 1,
    blocking: warning.blocking === true,
  }));
  return enforceOutputBound(baseProjection({
    status: "hook_recovery_ready",
    exitCode: 0,
    execution,
    warnings: warningSummary(warningEntries),
    project,
    nextAction: project.status.nextAction,
  }));
}

export const HOOK_RECOVERY_MAX_OUTPUT_BYTES = MAX_OUTPUT_BYTES;
