import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  decodeUtf8Strict,
  hasExactKeys,
  parseJsonStrict,
  readFileBytesBounded,
  sha256Bytes,
  sha256Canonical,
} from "../../packages/attest/src/formal.mjs";
import {
  quickSnapshotFingerprintValid,
  validQuickReceiptShape,
} from "../../packages/attest/src/quick-receipt-contract.mjs";

const REPORT_SCHEMA = "OwlCodaRunKitExternalRuntimeReportV1";
const RECEIPT_SCHEMA = "OwlCodaRunKitRuntimeTransitionReceiptV1";
const QUICK_RECEIPT_PREFIX = ".owlcoda/runkit/quick/receipts/";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const STAGE_STATUSES = new Set(["passed", "failed", "skipped"]);
const EXTERNAL_MUTATIONS = new Set(["changed", "unchanged", "unknown"]);
const FINAL_STATE_STATUSES = new Set(["changed", "unchanged", "restored", "unknown"]);
const ROLLBACK_OUTCOMES = new Set(["not_required", "succeeded", "failed", "unknown"]);

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function safeText(value, maximum = 2048) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !value.includes("\0");
}

function safeReference(value) {
  return safeText(value, 1024) && !/[\r\n]/u.test(value);
}

function safeArtifactPath(value, leafName = null) {
  if (typeof value !== "string" || !value.startsWith(QUICK_RECEIPT_PREFIX) || path.isAbsolute(value)) {
    return false;
  }
  if (value.includes("\\") || /[\0\r\n\t]/u.test(value)) return false;
  const segments = value.split("/");
  return segments.length === 6
    && SAFE_ID.test(segments[4])
    && segments.every(segment => segment.length > 0 && segment !== "." && segment !== "..")
    && (leafName === null || segments.at(-1) === leafName);
}

function validState(value) {
  return hasExactKeys(value, ["status", "stateRef", "fingerprint", "summary"])
    && FINAL_STATE_STATUSES.has(value.status)
    && safeReference(value.stateRef)
    && (value.fingerprint === null || SHA256.test(value.fingerprint))
    && safeText(value.summary);
}

function validStateIdentity(value, captured = false) {
  return hasExactKeys(value, captured
    ? ["stageId", "stateRef", "fingerprint"]
    : ["stateRef", "fingerprint"])
    && (!captured || SAFE_ID.test(value.stageId))
    && safeReference(value.stateRef)
    && (value.fingerprint === null || SHA256.test(value.fingerprint));
}

function normalizeRuntimeReport(report, { commandExitCode, commandSignal }) {
  if (!hasExactKeys(report, [
    "schemaVersion",
    "externalMutation",
    "rollbackPerformed",
    "finalExternalState",
    "failedStage",
    "lastPassedStage",
    "rollbackOutcome",
    "stages",
    "recoveryEvidence",
    "authorizationGranted",
  ]) || report.schemaVersion !== REPORT_SCHEMA || report.authorizationGranted !== false) {
    throw new Error("External runtime report shape is invalid.");
  }
  if (!EXTERNAL_MUTATIONS.has(report.externalMutation)
    || typeof report.rollbackPerformed !== "boolean"
    || !validState(report.finalExternalState)
    || !ROLLBACK_OUTCOMES.has(report.rollbackOutcome)
    || !(report.failedStage === null || SAFE_ID.test(report.failedStage))
    || !(report.lastPassedStage === null || SAFE_ID.test(report.lastPassedStage))) {
    throw new Error("External runtime report mutation, stage, or state value is invalid.");
  }
  if (!Array.isArray(report.stages) || report.stages.length === 0 || report.stages.length > 128) {
    throw new Error("External runtime report requires a bounded non-empty stage list.");
  }
  const stageIds = new Set();
  for (const stage of report.stages) {
    if (!hasExactKeys(stage, ["stageId", "status", "summary", "evidenceRefs"])
      || !SAFE_ID.test(stage.stageId)
      || !STAGE_STATUSES.has(stage.status)
      || !safeText(stage.summary)
      || !Array.isArray(stage.evidenceRefs)
      || stage.evidenceRefs.length > 128
      || stage.evidenceRefs.some(value => !safeReference(value))) {
      throw new Error("External runtime stage shape is invalid.");
    }
    if (stageIds.has(stage.stageId)) throw new Error("External runtime stage identifiers must be unique.");
    stageIds.add(stage.stageId);
  }
  const failedIndexes = report.stages
    .map((stage, index) => stage.status === "failed" ? index : -1)
    .filter(index => index >= 0);
  if (failedIndexes.length > 1) throw new Error("External runtime report supports one primary failed stage.");
  const failedIndex = failedIndexes[0] ?? -1;
  const expectedFailedStage = failedIndex < 0 ? null : report.stages[failedIndex].stageId;
  const passedSearchEnd = failedIndex < 0 ? report.stages.length : failedIndex;
  const expectedLastPassedStage = report.stages
    .slice(0, passedSearchEnd)
    .filter(stage => stage.status === "passed")
    .at(-1)?.stageId ?? null;
  if (report.failedStage !== expectedFailedStage || report.lastPassedStage !== expectedLastPassedStage) {
    throw new Error("External runtime report failedStage or lastPassedStage contradicts ordered stages.");
  }
  if ((commandExitCode !== 0 || commandSignal !== null) && report.failedStage === null) {
    throw new Error("A failed exact command must name its primary failed runtime stage.");
  }
  if (report.rollbackPerformed) {
    if (report.rollbackOutcome === "not_required") {
      throw new Error("Performed rollback cannot have not_required outcome.");
    }
  } else if (report.rollbackOutcome !== "not_required") {
    throw new Error("Rollback outcome must be not_required when no rollback was performed.");
  }
  if (report.finalExternalState.status === "restored" && !report.rollbackPerformed) {
    throw new Error("A restored final state requires a performed rollback.");
  }
  if (report.rollbackOutcome === "succeeded" && report.finalExternalState.status !== "restored") {
    throw new Error("Successful rollback requires an explicitly restored final state.");
  }
  if (report.externalMutation === "unchanged"
    && (report.rollbackPerformed || report.finalExternalState.status !== "unchanged")) {
    throw new Error("Unchanged external runtime cannot report rollback or a changed final state.");
  }
  if (!Array.isArray(report.recoveryEvidence) || report.recoveryEvidence.length > 128) {
    throw new Error("External runtime recovery evidence must be a bounded array.");
  }
  for (const evidence of report.recoveryEvidence) {
    if (!hasExactKeys(evidence, ["artifactRef", "capturedBefore", "restoresTo"])
      || !safeReference(evidence.artifactRef)
      || !validStateIdentity(evidence.capturedBefore, true)
      || !validStateIdentity(evidence.restoresTo, false)
      || !stageIds.has(evidence.capturedBefore.stageId)) {
      throw new Error("External runtime recovery evidence semantics are invalid.");
    }
  }
  if (report.rollbackOutcome === "succeeded") {
    const finalIdentity = `${report.finalExternalState.stateRef}\0${report.finalExternalState.fingerprint ?? ""}`;
    const restoresFinal = report.recoveryEvidence.some(evidence => (
      `${evidence.restoresTo.stateRef}\0${evidence.restoresTo.fingerprint ?? ""}` === finalIdentity
    ));
    if (!restoresFinal) {
      throw new Error("Successful rollback must name recovery evidence that restores the final state.");
    }
  }
  return JSON.parse(JSON.stringify(report));
}

function workspaceMutation(quickReceipt) {
  if (quickReceipt.mutationClasses !== undefined) {
    return quickReceipt.mutationClasses.workspaceSource === "changed"
      || quickReceipt.mutationClasses.boundIgnoredPaths === "changed"
      ? "changed"
      : "unchanged";
  }
  return quickReceipt.workspaceBefore.sourceFingerprint === quickReceipt.workspaceAfter.sourceFingerprint
    ? "unchanged"
    : "changed";
}

function transitionDecision({ quickReceipt, report, workspaceMutationValue }) {
  if (workspaceMutationValue === "changed") return "external_transition_invalidated";
  const commandFailed = quickReceipt.exitResult.exitCode !== 0 || quickReceipt.exitResult.signal !== null;
  if (commandFailed || report.failedStage !== null) {
    return report.rollbackOutcome === "succeeded" && report.finalExternalState.status === "restored"
      ? "external_transition_failed_recovered"
      : "external_transition_failed_unrecovered";
  }
  if (report.externalMutation === "unknown"
    || report.finalExternalState.status === "unknown"
    || report.rollbackOutcome === "unknown") {
    return "external_transition_indeterminate";
  }
  return "external_transition_passed";
}

function readBoundedJson(root, requestedPath) {
  const absolute = path.resolve(root, requestedPath);
  if (!withinRoot(root, absolute)) throw new Error("Runtime transition material escapes the workspace.");
  const loaded = readFileBytesBounded(absolute);
  if (loaded.absolutePath !== absolute) throw new Error("Runtime transition material must not traverse symlinks.");
  return {
    absolute,
    bytes: loaded.bytes,
    value: parseJsonStrict(decodeUtf8Strict(loaded.bytes)),
  };
}

function verifyArtifactBytes(root, artifact) {
  if (!hasExactKeys(artifact, ["path", "sha256", "sizeBytes"])
    || !safeArtifactPath(artifact.path)
    || !SHA256.test(artifact.sha256)
    || !Number.isSafeInteger(artifact.sizeBytes)
    || artifact.sizeBytes < 0) {
    throw new Error("Quick material reference is invalid.");
  }
  const absolute = path.resolve(root, artifact.path);
  if (!withinRoot(root, absolute)) throw new Error("Quick material escapes the workspace.");
  if (realpathSync(absolute) !== absolute) throw new Error("Quick material must not traverse symlinks.");
  const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size !== artifact.sizeBytes) {
      throw new Error("Quick material size or type changed.");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (total !== artifact.sizeBytes || `sha256:${hash.digest("hex")}` !== artifact.sha256) {
      throw new Error("Quick material bytes changed.");
    }
  } finally {
    closeSync(descriptor);
  }
}

function validateQuickMaterial(root, loaded) {
  const quick = loaded.value;
  if (!validQuickReceiptShape(quick)
    || !quickSnapshotFingerprintValid(quick.workspaceBefore)
    || !quickSnapshotFingerprintValid(quick.workspaceAfter)) {
    throw new Error("Runtime transition requires a strict Quick receipt.");
  }
  const sourceRoot = quick.schemaVersion === "OwlCodaQuickVerificationReceiptV3"
    ? quick.sourceWorkspaceRoot
    : quick.exactCommand.cwd;
  if (realpathSync(sourceRoot) !== root) throw new Error("Quick receipt belongs to another source workspace.");
  verifyArtifactBytes(root, quick.outputArtifacts.stdout);
  verifyArtifactBytes(root, quick.outputArtifacts.stderr);
  if (quick.inputArtifacts?.stdin !== undefined) verifyArtifactBytes(root, quick.inputArtifacts.stdin);
  return quick;
}

function receiptBody({ root, quickLoaded, reportLoaded }) {
  const quick = validateQuickMaterial(root, quickLoaded);
  const report = normalizeRuntimeReport(reportLoaded.value, {
    commandExitCode: quick.exitResult.exitCode,
    commandSignal: quick.exitResult.signal,
  });
  const quickRelative = path.relative(root, quickLoaded.absolute).split(path.sep).join("/");
  const reportRelative = path.relative(root, reportLoaded.absolute).split(path.sep).join("/");
  if (!safeArtifactPath(quickRelative, "receipt.json")
    || !safeArtifactPath(reportRelative, "runtime-report.json")
    || path.posix.dirname(quickRelative) !== path.posix.dirname(reportRelative)) {
    throw new Error("Runtime report must be beside its Quick receipt.");
  }
  const workspaceMutationValue = workspaceMutation(quick);
  return {
    schemaVersion: RECEIPT_SCHEMA,
    receiptId: `runtime-${quick.receiptId}`,
    quickReceipt: {
      receiptId: quick.receiptId,
      path: quickRelative,
      sha256: sha256Bytes(quickLoaded.bytes),
    },
    runtimeReport: {
      path: reportRelative,
      sha256: sha256Bytes(reportLoaded.bytes),
      sizeBytes: reportLoaded.bytes.byteLength,
    },
    reportingBasis: "exact_command_report",
    workspaceMutation: workspaceMutationValue,
    externalMutation: report.externalMutation,
    rollbackPerformed: report.rollbackPerformed,
    finalExternalState: report.finalExternalState,
    failedStage: report.failedStage,
    lastPassedStage: report.lastPassedStage,
    rollbackOutcome: report.rollbackOutcome,
    stages: report.stages,
    recoveryEvidence: report.recoveryEvidence,
    transitionDecision: transitionDecision({
      quickReceipt: quick,
      report,
      workspaceMutationValue,
    }),
    proven: [
      "The Quick receipt bytes, command-produced runtime report bytes, and projected transition fields are bound together.",
      "workspaceMutation is derived from the Quick before/after workspace evidence.",
    ],
    notProven: [
      "RunKit did not independently observe the external runtime; external fields are exact-command reports.",
      "No Git, release, deployment, production, or business authority is granted.",
    ],
    createdAt: new Date().toISOString(),
    authorizationGranted: false,
  };
}

function persistReceipt(filePath, body) {
  const receipt = { ...body, receiptSha256: sha256Canonical(body) };
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, filePath);
  return receipt;
}

function receiptSummary(receipt, receiptPath) {
  return {
    status: "runtime_transition_recorded",
    receiptPath,
    receiptSha256: receipt.receiptSha256,
    reportingBasis: receipt.reportingBasis,
    workspaceMutation: receipt.workspaceMutation,
    externalMutation: receipt.externalMutation,
    rollbackPerformed: receipt.rollbackPerformed,
    finalExternalState: receipt.finalExternalState,
    failedStage: receipt.failedStage,
    lastPassedStage: receipt.lastPassedStage,
    rollbackOutcome: receipt.rollbackOutcome,
    stages: receipt.stages,
    recoveryEvidence: receipt.recoveryEvidence,
    transitionDecision: receipt.transitionDecision,
    proven: receipt.proven,
    notProven: receipt.notProven,
    authorizationGranted: false,
  };
}

export function runtimeReportPath(receiptRoot) {
  return path.join(receiptRoot, "runtime-report.json");
}

export function captureRuntimeTransition({ workspaceRoot, quickReceiptPath, runtimeReportPath: reportPath }) {
  const root = realpathSync(workspaceRoot);
  const quickLoaded = readBoundedJson(root, quickReceiptPath);
  const reportLoaded = readBoundedJson(root, reportPath);
  const body = receiptBody({ root, quickLoaded, reportLoaded });
  const receiptPath = path.join(path.dirname(quickLoaded.absolute), "runtime-transition.json");
  const receipt = persistReceipt(receiptPath, body);
  const verified = verifyRuntimeTransitionReceipt({ workspaceRoot: root, receiptPath });
  if (verified.status !== "runtime_transition_receipt_valid") {
    throw new Error(`Persisted runtime transition receipt is invalid: ${verified.issueCodes.join(",")}`);
  }
  return receiptSummary(receipt, receiptPath);
}

export function verifyRuntimeTransitionReceipt({ workspaceRoot, receiptPath }) {
  const issues = [];
  try {
    const root = realpathSync(workspaceRoot);
    const loaded = readBoundedJson(root, receiptPath);
    const receipt = loaded.value;
    if (!hasExactKeys(receipt, [
      "schemaVersion",
      "receiptId",
      "quickReceipt",
      "runtimeReport",
      "reportingBasis",
      "workspaceMutation",
      "externalMutation",
      "rollbackPerformed",
      "finalExternalState",
      "failedStage",
      "lastPassedStage",
      "rollbackOutcome",
      "stages",
      "recoveryEvidence",
      "transitionDecision",
      "proven",
      "notProven",
      "createdAt",
      "authorizationGranted",
      "receiptSha256",
    ]) || receipt.schemaVersion !== RECEIPT_SCHEMA
      || receipt.authorizationGranted !== false
      || !SAFE_ID.test(receipt.receiptId)
      || !hasExactKeys(receipt.quickReceipt, ["receiptId", "path", "sha256"])
      || !SAFE_ID.test(receipt.quickReceipt.receiptId)
      || !safeArtifactPath(receipt.quickReceipt.path, "receipt.json")
      || !SHA256.test(receipt.quickReceipt.sha256)
      || !hasExactKeys(receipt.runtimeReport, ["path", "sha256", "sizeBytes"])
      || !safeArtifactPath(receipt.runtimeReport.path, "runtime-report.json")
      || !SHA256.test(receipt.runtimeReport.sha256)
      || !Number.isSafeInteger(receipt.runtimeReport.sizeBytes)
      || receipt.runtimeReport.sizeBytes < 0
      || receipt.reportingBasis !== "exact_command_report"
      || !Array.isArray(receipt.proven)
      || receipt.proven.length < 2
      || receipt.proven.some(value => !safeText(value))
      || !Array.isArray(receipt.notProven)
      || receipt.notProven.length < 2
      || receipt.notProven.some(value => !safeText(value))
      || !SHA256.test(receipt.receiptSha256)
      || !Number.isFinite(Date.parse(receipt.createdAt))) {
      throw new Error("Runtime transition receipt shape is invalid.");
    }
    const { receiptSha256, ...withoutHash } = receipt;
    if (sha256Canonical(withoutHash) !== receiptSha256) issues.push("runtime_transition_receipt_hash_mismatch");
    const quickLoaded = readBoundedJson(root, receipt.quickReceipt.path);
    if (sha256Bytes(quickLoaded.bytes) !== receipt.quickReceipt.sha256
      || quickLoaded.value.receiptId !== receipt.quickReceipt.receiptId) {
      issues.push("quick_receipt_mismatch");
    }
    const reportLoaded = readBoundedJson(root, receipt.runtimeReport.path);
    if (sha256Bytes(reportLoaded.bytes) !== receipt.runtimeReport.sha256
      || reportLoaded.bytes.byteLength !== receipt.runtimeReport.sizeBytes) {
      issues.push("runtime_report_mismatch");
    }
    let expected;
    try {
      expected = receiptBody({ root, quickLoaded, reportLoaded });
    } catch (error) {
      issues.push("runtime_transition_material_invalid");
    }
    if (expected !== undefined) {
      const comparable = { ...expected, createdAt: receipt.createdAt };
      if (JSON.stringify(comparable) !== JSON.stringify(withoutHash)) {
        issues.push("runtime_transition_projection_mismatch");
      }
    }
    return {
      status: issues.length === 0
        ? "runtime_transition_receipt_valid"
        : "runtime_transition_receipt_invalid",
      exitCode: issues.length === 0 ? 0 : 1,
      transitionDecision: receipt.transitionDecision,
      issueCodes: [...new Set(issues)].sort(compareCodeUnits),
      receiptPath: loaded.absolute,
      receiptSha256: sha256Bytes(loaded.bytes),
      authorizationGranted: false,
    };
  } catch (error) {
    return {
      status: "runtime_transition_receipt_invalid",
      exitCode: 1,
      transitionDecision: null,
      issueCodes: ["runtime_transition_unreadable_or_invalid"],
      issues: [error instanceof Error ? error.message : String(error)],
      authorizationGranted: false,
    };
  }
}
