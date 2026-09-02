import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  decodeUtf8Strict,
  parseJsonStrict,
  readFileBytesBounded,
} from "../../packages/attest/src/formal.mjs";
import { quickSnapshotFingerprintValid } from "../../packages/attest/src/quick-receipt-contract.mjs";
import {
  attestQuickReceipt,
  validQuickReceiptShape,
} from "./quick-attest.mjs";
import { quickReceiptRoot } from "./quick-receipt.mjs";

const INVALID_ATTESTATION_ISSUES = new Set([
  "attestation_material_missing",
  "receipt_material_hash_mismatch",
]);
const SUCCESSOR_MUTATION_ISSUES = new Set([
  "source_mutated_during_verification",
  "bound_ignored_path_mutated_during_verification",
  "dependency_environment_mutated_during_verification",
  "consumer_source_mutated_during_verification",
  "quick_isolation_cleanup_failed",
  "foreign_workspace_mutated_during_verification",
]);

function readHistoricalReceipt(receiptPath) {
  const { bytes } = readFileBytesBounded(receiptPath);
  const receipt = parseJsonStrict(decodeUtf8Strict(bytes));
  if (!validQuickReceiptShape(receipt)) throw new Error("quick_receipt_schema_invalid");
  const snapshotsValid = quickSnapshotFingerprintValid(receipt.workspaceBefore)
    && quickSnapshotFingerprintValid(receipt.workspaceAfter);
  const sourceChanged = receipt.workspaceBefore.sourceFingerprint
    !== receipt.workspaceAfter.sourceFingerprint;
  const successorReceipt = [
    "OwlCodaQuickVerificationReceiptV3",
    "OwlCodaQuickVerificationReceiptV4",
  ].includes(receipt.schemaVersion);
  const mutationBindingValid = receipt.mutationDecision === "source_unchanged"
    ? !sourceChanged && !receipt.issueCodes.some(issue => SUCCESSOR_MUTATION_ISSUES.has(issue))
    : successorReceipt
      ? receipt.issueCodes.some(issue => SUCCESSOR_MUTATION_ISSUES.has(issue))
      : sourceChanged && receipt.issueCodes.includes("source_mutated_during_verification");
  if (!snapshotsValid || !mutationBindingValid) {
    throw new Error("quick_receipt_source_binding_invalid");
  }
  return receipt;
}

function trustedReceiptRoot(workspaceRoot) {
  const workspace = realpathSync(workspaceRoot);
  const root = quickReceiptRoot(workspace);
  let current = workspace;
  for (const segment of path.relative(workspace, root).split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) return { status: "missing", root };
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { status: "invalid", root };
    const resolved = realpathSync(current);
    const remainder = path.relative(workspace, resolved);
    if (remainder === "" || remainder === ".."
      || remainder.startsWith(`..${path.sep}`) || path.isAbsolute(remainder)) {
      return { status: "invalid", root };
    }
  }
  return { status: "valid", root };
}

export function readTrustedQuickReceiptHistory(workspaceRoot) {
  const selected = trustedReceiptRoot(workspaceRoot);
  if (selected.status !== "valid") {
    return {
      status: selected.status,
      receiptPaths: [],
      receipts: [],
      invalidCount: selected.status === "invalid" ? 1 : 0,
    };
  }
  const receiptPaths = readdirSync(selected.root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(selected.root, entry.name, "receipt.json"))
    .filter(existsSync)
    .sort();
  const receipts = [];
  let invalidCount = 0;
  for (const receiptPath of receiptPaths) {
    try {
      const receipt = readHistoricalReceipt(receiptPath);
      const attestation = attestQuickReceipt({ receiptPath, workspaceRoot });
      if (attestation.issueCodes.some((issue) => INVALID_ATTESTATION_ISSUES.has(issue))) {
        invalidCount += 1;
      } else {
        receipts.push({ receiptPath, receipt });
      }
    } catch {
      invalidCount += 1;
    }
  }
  return {
    status: "valid",
    receiptPaths,
    receipts,
    invalidCount,
  };
}

export function readLocalQuickMetrics(workspaceRoot, { verbose = false } = {}) {
  const selected = trustedReceiptRoot(workspaceRoot);
  if (selected.status === "invalid") {
    return {
      status: "quick_receipt_store_invalid",
      exitCode: 3,
      schemaVersion: "OwlCodaRunKitLocalMetricsV1",
      telemetry: false,
      networkRequests: 0,
      ...(verbose ? { inputs: [] } : {}),
      quick: {
        total: 0,
        passed: 0,
        failed: 0,
        sourceMutated: 0,
        invalid: 0,
      },
      issueCodes: ["quick_receipt_store_invalid"],
      authorizationGranted: false,
    };
  }
  const receiptPaths = selected.status === "valid"
    ? readdirSync(selected.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(selected.root, entry.name, "receipt.json"))
      .filter(existsSync)
      .sort()
    : [];
  const totals = {
    total: receiptPaths.length,
    passed: 0,
    failed: 0,
    sourceMutated: 0,
    invalid: 0,
  };
  for (const receiptPath of receiptPaths) {
    try {
      const receipt = readHistoricalReceipt(receiptPath);
      const attestation = attestQuickReceipt({ receiptPath, workspaceRoot });
      if (attestation.issueCodes.some((issue) => INVALID_ATTESTATION_ISSUES.has(issue))) {
        totals.invalid += 1;
      } else if (receipt.mutationDecision !== "source_unchanged") {
        totals.sourceMutated += 1;
      } else if (receipt.exitResult.exitCode === 0 && receipt.exitResult.signal === null) {
        totals.passed += 1;
      } else {
        totals.failed += 1;
      }
    } catch {
      totals.invalid += 1;
    }
  }
  return {
    status: "local_metrics",
    exitCode: 0,
    schemaVersion: "OwlCodaRunKitLocalMetricsV1",
    telemetry: false,
    networkRequests: 0,
    ...(verbose ? { inputs: receiptPaths } : {}),
    quick: totals,
    authorizationGranted: false,
  };
}
