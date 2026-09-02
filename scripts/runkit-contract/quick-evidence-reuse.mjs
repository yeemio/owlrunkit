import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
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
import { attestQuickReceiptDetails } from "./quick-attest.mjs";
import { runQuickVerification } from "./quick-verify.mjs";
import { captureWorkspaceSnapshot } from "./quick-workspace-snapshot.mjs";

const REUSE_ROOT = ".owlcoda/runkit/quick/reuse";
const MAX_GIT_BLOB_BYTES = 512 * 1024 * 1024;
const ALLOWED_BASE_ATTESTATION_ISSUES = new Set([
  "anchor_absent",
  "receipt_source_mismatch",
  "signature_absent",
]);
const NON_DECISIONAL_DELTA_ATTESTATION_ISSUES = new Set([
  "anchor_absent",
  "signature_absent",
]);

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function safeLiteralPath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return false;
  if (value.includes("\\") || /[\0\r\n\t]/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every(segment => segment.length > 0 && segment !== "." && segment !== "..")
    && value !== ".owlcoda/runkit"
    && !value.startsWith(".owlcoda/runkit/");
}

function safeQuickArtifactPath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return false;
  if (value.includes("\\") || /[\0\r\n\t]/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every(segment => segment.length > 0 && segment !== "." && segment !== "..")
    && value.startsWith(".owlcoda/runkit/quick/");
}

function selectedPaths(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => !safeLiteralPath(value))) {
    throw new Error(`${label} must contain safe literal workspace-relative paths.`);
  }
  const selected = [...new Set(values)].sort(compareCodeUnits);
  if (selected.length !== values.length) throw new Error(`${label} must not contain duplicates.`);
  return selected;
}

function readBaseReceipt(root, requestedPath) {
  const absolute = path.resolve(root, requestedPath);
  if (!withinRoot(root, absolute)) throw new Error("Base Quick receipt must remain inside the workspace.");
  const { bytes } = readFileBytesBounded(absolute);
  const receipt = parseJsonStrict(decodeUtf8Strict(bytes));
  if (
    !validQuickReceiptShape(receipt)
    || !quickSnapshotFingerprintValid(receipt.workspaceBefore)
    || !quickSnapshotFingerprintValid(receipt.workspaceAfter)
  ) {
    throw new Error("Base Quick receipt does not satisfy a supported strict contract.");
  }
  const receiptWorkspace = realpathSync(
    receipt.schemaVersion === "OwlCodaQuickVerificationReceiptV3"
      ? receipt.sourceWorkspaceRoot
      : receipt.exactCommand.cwd,
  );
  if (receiptWorkspace !== root) throw new Error("Base Quick receipt belongs to another workspace.");
  if (
    receipt.mutationDecision !== "source_unchanged"
    || receipt.exitResult.exitCode !== 0
    || receipt.exitResult.signal !== null
  ) {
    throw new Error("Base Quick receipt must record a passed, source-unchanged command.");
  }
  const attested = attestQuickReceiptDetails({ receiptPath: absolute, workspaceRoot: root });
  const disallowed = attested.attestation.issueCodes.filter(
    issue => !ALLOWED_BASE_ATTESTATION_ISSUES.has(issue),
  );
  if (disallowed.length > 0) {
    throw new Error(`Base Quick receipt evidence is not reusable: ${disallowed.join(",")}`);
  }
  return {
    absolute,
    bytes,
    receipt,
    receiptSha256: sha256Bytes(bytes),
    attestationIssueCodes: attested.attestation.issueCodes,
  };
}

function committedChangedPaths(root, beforeHead, afterHead) {
  if (beforeHead === afterHead) return [];
  if (beforeHead === null || afterHead === null) {
    throw new Error("Quick evidence reuse requires committed Git identities on both candidates.");
  }
  return git(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    beforeHead,
    afterHead,
    "--",
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function treeEntry(root, headCommit, relativePath) {
  if (headCommit === null) return null;
  const raw = git(root, ["ls-tree", "-z", "--full-tree", headCommit, "--", relativePath]);
  const records = raw.toString("utf8").split("\0").filter(Boolean);
  const record = records.find(value => value.slice(value.indexOf("\t") + 1) === relativePath);
  if (record === undefined) return null;
  const separator = record.indexOf("\t");
  const [mode, type, objectId] = record.slice(0, separator).split(" ");
  if (mode === "160000" || type === "commit") return `gitlink:${objectId}`;
  if (type !== "blob") throw new Error(`Unsupported Git tree entry for reuse: ${relativePath}`);
  const bytes = git(root, ["cat-file", "blob", objectId], {
    encoding: null,
    maxBuffer: MAX_GIT_BLOB_BYTES,
  });
  const hash = createHash("sha256")
    .update(mode === "120000" ? Buffer.concat([Buffer.from("symlink:"), bytes]) : bytes)
    .digest("hex");
  return `sha256:${hash}`;
}

function candidateIdentity(root, snapshot, relativePath) {
  const overlay = snapshot.dirtyOverlay.find(entry => entry.path === relativePath);
  if (overlay !== undefined) return overlay.state === "deleted" ? null : overlay.sha256;
  const submodule = snapshot.submodules.find(entry => entry.path === relativePath);
  if (submodule !== undefined) return `gitlink:${submodule.commit}`;
  return treeEntry(root, snapshot.headCommit, relativePath);
}

function ignoredBindingMap(snapshot) {
  return new Map((snapshot.ignoredPathBindings ?? []).map(entry => [
    entry.path,
    `${entry.state}:${entry.sha256 ?? "missing"}`,
  ]));
}

function currentDelta({ root, baseSnapshot, currentSnapshot }) {
  if (baseSnapshot.repositoryIdentity !== currentSnapshot.repositoryIdentity) {
    throw new Error("Base receipt repository identity differs from the current workspace.");
  }
  const possible = new Set([
    ...committedChangedPaths(root, baseSnapshot.headCommit, currentSnapshot.headCommit),
    ...baseSnapshot.dirtyOverlay.map(entry => entry.path),
    ...currentSnapshot.dirtyOverlay.map(entry => entry.path),
    ...baseSnapshot.submodules.map(entry => entry.path),
    ...currentSnapshot.submodules.map(entry => entry.path),
  ]);
  const baseIgnored = ignoredBindingMap(baseSnapshot);
  const currentIgnored = ignoredBindingMap(currentSnapshot);
  for (const ignoredPath of new Set([...baseIgnored.keys(), ...currentIgnored.keys()])) {
    if (baseIgnored.get(ignoredPath) !== currentIgnored.get(ignoredPath)) possible.add(ignoredPath);
  }
  return [...possible]
    .filter(relativePath => {
      if (baseIgnored.has(relativePath) || currentIgnored.has(relativePath)) {
        return baseIgnored.get(relativePath) !== currentIgnored.get(relativePath);
      }
      return candidateIdentity(root, baseSnapshot, relativePath)
        !== candidateIdentity(root, currentSnapshot, relativePath);
    })
    .sort(compareCodeUnits);
}

function captureStableCurrent(root, baseSnapshot) {
  const ignoredPaths = (baseSnapshot.ignoredPathBindings ?? []).map(entry => entry.path);
  const first = captureWorkspaceSnapshot(root, { ignoredPaths });
  const second = captureWorkspaceSnapshot(root, { ignoredPaths });
  if (first.sourceFingerprint !== second.sourceFingerprint) {
    throw new Error("Current workspace changed while planning Quick evidence reuse.");
  }
  return first;
}

function blockedResult(error) {
  return {
    status: "quick_evidence_reuse_input_invalid",
    exitCode: 3,
    ready: false,
    issues: [error instanceof Error ? error.message : String(error)],
    actualDeltaPaths: [],
    outOfScopePaths: [],
    unusedAllowedPaths: [],
    reuseReceiptPath: null,
    authorizationGranted: false,
  };
}

function withBaseReceipt(result, receipt) {
  Object.defineProperty(result, "_baseReceipt", {
    value: receipt,
    enumerable: false,
  });
  return result;
}

export function planQuickEvidenceReuse({ workspaceRoot, baseReceiptPath, allowedPaths }) {
  try {
    const root = realpathSync(workspaceRoot);
    const gitRoot = realpathSync(git(root, ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
    if (gitRoot !== root) throw new Error("Quick evidence reuse requires the exact Git worktree root.");
    const allowed = selectedPaths(allowedPaths, "Allowed delta paths");
    const base = readBaseReceipt(root, baseReceiptPath);
    const current = captureStableCurrent(root, base.receipt.workspaceAfter);
    const actualDeltaPaths = currentDelta({
      root,
      baseSnapshot: base.receipt.workspaceAfter,
      currentSnapshot: current,
    });
    const allowedSet = new Set(allowed);
    const actualSet = new Set(actualDeltaPaths);
    const outOfScopePaths = actualDeltaPaths.filter(value => !allowedSet.has(value));
    const unusedAllowedPaths = allowed.filter(value => !actualSet.has(value));
    const common = {
      schemaVersion: "OwlCodaQuickEvidenceReusePlanV1",
      baseReceipt: {
        receiptId: base.receipt.receiptId,
        path: path.relative(root, base.absolute).split(path.sep).join("/"),
        sha256: base.receiptSha256,
        sourceFingerprint: base.receipt.workspaceAfter.sourceFingerprint,
        attestationIssueCodes: base.attestationIssueCodes,
      },
      allowedPaths: allowed,
      actualDeltaPaths,
      outOfScopePaths,
      unusedAllowedPaths,
      currentSourceFingerprint: current.sourceFingerprint,
      authorizationGranted: false,
    };
    if (outOfScopePaths.length > 0) {
      return withBaseReceipt({
        ...common,
        status: "quick_evidence_reuse_blocked",
        exitCode: 2,
        ready: false,
        issues: ["Current candidate includes delta paths outside the explicit allowance."],
      }, base.receipt);
    }
    if (actualDeltaPaths.length === 0) {
      return withBaseReceipt({
        ...common,
        status: "quick_evidence_reuse_not_needed",
        exitCode: 0,
        ready: false,
        issues: [],
      }, base.receipt);
    }
    return withBaseReceipt({
      ...common,
      status: "quick_evidence_reuse_ready",
      exitCode: 0,
      ready: true,
      issues: [],
    }, base.receipt);
  } catch (error) {
    return blockedResult(error);
  }
}

function ensureReuseDirectory(root) {
  let current = root;
  for (const segment of REUSE_ROOT.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      try {
        mkdirSync(current);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !withinRoot(root, realpathSync(current))) {
      throw new Error("Quick evidence reuse store must be a real in-workspace directory.");
    }
  }
  return current;
}

function persistReuseReceipt(root, body) {
  const receipt = { ...body, receiptSha256: sha256Canonical(body) };
  const directory = ensureReuseDirectory(root);
  const receiptPath = path.join(directory, `${body.reuseId}.json`);
  const temporary = `${receiptPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, receiptPath);
  return { receipt, receiptPath };
}

function validReuseReceiptShape(receipt) {
  return hasExactKeys(receipt, [
    "schemaVersion",
    "reuseId",
    "baseReceipt",
    "delta",
    "decision",
    "reasonCodes",
    "proven",
    "notProven",
    "createdAt",
    "authorizationGranted",
    "receiptSha256",
  ])
    && receipt.schemaVersion === "OwlCodaQuickEvidenceReuseReceiptV1"
    && /^[A-Za-z0-9._-]+$/u.test(receipt.reuseId)
    && receipt.authorizationGranted === false
    && ["accepted", "rejected"].includes(receipt.decision)
    && Array.isArray(receipt.reasonCodes)
    && Array.isArray(receipt.proven)
    && receipt.proven.length >= 2
    && Array.isArray(receipt.notProven)
    && receipt.notProven.length >= 2
    && typeof receipt.createdAt === "string"
    && Number.isFinite(Date.parse(receipt.createdAt))
    && hasExactKeys(receipt.baseReceipt, [
      "receiptId", "path", "sha256", "sourceFingerprint", "attestationIssueCodes",
    ])
    && safeQuickArtifactPath(receipt.baseReceipt.path)
    && typeof receipt.baseReceipt.receiptId === "string"
    && Array.isArray(receipt.baseReceipt.attestationIssueCodes)
    && hasExactKeys(receipt.delta, [
      "allowedPaths",
      "actualPaths",
      "unusedAllowedPaths",
      "currentSourceFingerprint",
      "receiptId",
      "receiptPath",
      "receiptSha256",
      "command",
    ])
    && safeQuickArtifactPath(receipt.delta.receiptPath)
    && Array.isArray(receipt.delta.allowedPaths)
    && Array.isArray(receipt.delta.actualPaths)
    && Array.isArray(receipt.delta.unusedAllowedPaths)
    && hasExactKeys(receipt.delta.command, ["executable", "argv"])
    && typeof receipt.delta.command.executable === "string"
    && Array.isArray(receipt.delta.command.argv)
    && receipt.delta.command.argv.every(value => typeof value === "string")
    && /^sha256:[a-f0-9]{64}$/u.test(receipt.receiptSha256)
    && /^sha256:[a-f0-9]{64}$/u.test(receipt.baseReceipt.sha256)
    && /^sha256:[a-f0-9]{64}$/u.test(receipt.baseReceipt.sourceFingerprint)
    && /^sha256:[a-f0-9]{64}$/u.test(receipt.delta.receiptSha256)
    && /^sha256:[a-f0-9]{64}$/u.test(receipt.delta.currentSourceFingerprint);
}

export function verifyQuickEvidenceReuseReceipt({ workspaceRoot, receiptPath }) {
  const issues = [];
  try {
    const root = realpathSync(workspaceRoot);
    const absolute = path.resolve(root, receiptPath);
    if (!withinRoot(root, absolute)) throw new Error("Reuse receipt escapes the workspace.");
    const { bytes } = readFileBytesBounded(absolute);
    const receipt = parseJsonStrict(decodeUtf8Strict(bytes));
    if (!validReuseReceiptShape(receipt)) throw new Error("Reuse receipt shape is invalid.");
    const { receiptSha256, ...body } = receipt;
    if (sha256Canonical(body) !== receiptSha256) issues.push("reuse_receipt_hash_mismatch");

    const basePath = path.resolve(root, receipt.baseReceipt.path);
    const baseBytes = readFileBytesBounded(basePath).bytes;
    const base = parseJsonStrict(decodeUtf8Strict(baseBytes));
    if (
      sha256Bytes(baseBytes) !== receipt.baseReceipt.sha256
      || !validQuickReceiptShape(base)
      || base.receiptId !== receipt.baseReceipt.receiptId
      || base.workspaceAfter.sourceFingerprint !== receipt.baseReceipt.sourceFingerprint
    ) {
      issues.push("reuse_base_receipt_mismatch");
    }

    const deltaPath = path.resolve(root, receipt.delta.receiptPath);
    const deltaBytes = readFileBytesBounded(deltaPath).bytes;
    const delta = parseJsonStrict(decodeUtf8Strict(deltaBytes));
    if (
      sha256Bytes(deltaBytes) !== receipt.delta.receiptSha256
      || !validQuickReceiptShape(delta)
      || delta.receiptId !== receipt.delta.receiptId
      || delta.workspaceAfter.sourceFingerprint !== receipt.delta.currentSourceFingerprint
      || delta.exactCommand.executable !== receipt.delta.command.executable
      || JSON.stringify(delta.exactCommand.argv) !== JSON.stringify(receipt.delta.command.argv)
    ) {
      issues.push("reuse_delta_receipt_mismatch");
    }
    const deltaAttestation = attestQuickReceiptDetails({
      receiptPath: deltaPath,
      workspaceRoot: root,
    });
    if (deltaAttestation.attestation.decision !== "GO") {
      issues.push("reuse_delta_attestation_failed");
      issues.push(...deltaAttestation.attestation.issueCodes.filter(
        issue => !NON_DECISIONAL_DELTA_ATTESTATION_ISSUES.has(issue),
      ));
    }

    if (receipt.decision === "accepted") {
      if (
        receipt.reasonCodes.length !== 0
        || delta.mutationDecision !== "source_unchanged"
        || delta.exitResult.exitCode !== 0
        || delta.exitResult.signal !== null
      ) {
        issues.push("reuse_accepted_delta_not_passed");
      }
      const plan = planQuickEvidenceReuse({
        workspaceRoot: root,
        baseReceiptPath: receipt.baseReceipt.path,
        allowedPaths: receipt.delta.allowedPaths,
      });
      if (
        plan.status !== "quick_evidence_reuse_ready"
        || plan.currentSourceFingerprint !== receipt.delta.currentSourceFingerprint
        || JSON.stringify(plan.actualDeltaPaths) !== JSON.stringify(receipt.delta.actualPaths)
        || JSON.stringify(plan.unusedAllowedPaths) !== JSON.stringify(receipt.delta.unusedAllowedPaths)
      ) {
        issues.push("reuse_current_candidate_mismatch");
      }
    }
    return {
      status: issues.length === 0 ? "quick_evidence_reuse_receipt_valid" : "quick_evidence_reuse_receipt_invalid",
      exitCode: issues.length === 0 && receipt.decision === "accepted" ? 0 : 1,
      decision: issues.length === 0 && receipt.decision === "accepted" ? "GO" : "NO_GO",
      issueCodes: [...new Set(issues)].sort(),
      receiptPath: absolute,
      receiptSha256: sha256Bytes(bytes),
      authorizationGranted: false,
    };
  } catch (error) {
    return {
      status: "quick_evidence_reuse_receipt_invalid",
      exitCode: 1,
      decision: "NO_GO",
      issueCodes: ["reuse_receipt_unreadable_or_invalid"],
      issues: [error instanceof Error ? error.message : String(error)],
      authorizationGranted: false,
    };
  }
}

export async function runQuickEvidenceReuse({
  workspaceRoot,
  baseReceiptPath,
  allowedPaths,
  commandArgv,
  stdinFile,
  apply = false,
}) {
  const plan = planQuickEvidenceReuse({ workspaceRoot, baseReceiptPath, allowedPaths });
  const { _baseReceipt: baseReceipt, ...publicPlan } = plan;
  if (!plan.ready || apply !== true) {
    return { ...publicPlan, reuseReceiptPath: null };
  }
  if (!Array.isArray(commandArgv) || commandArgv.length === 0) {
    return blockedResult(new Error("An exact delta command is required after --."));
  }
  const root = realpathSync(workspaceRoot);
  const baseIgnoredPaths = (baseReceipt.workspaceAfter.ignoredPathBindings ?? [])
    .map(entry => entry.path);
  const baseDependencyRoot = baseReceipt.executionIsolation?.dependencyEnvironment?.root;
  const isolate = baseReceipt.executionIsolation !== null
    && baseReceipt.executionIsolation !== undefined;
  const delta = await runQuickVerification({
    workspaceRoot: root,
    commandArgv,
    stdinFile,
    isolate,
    dependencyRoot: baseDependencyRoot,
    ignoredPaths: baseIgnoredPaths,
  });
  if (delta.receiptPath === null || delta.receiptPath === undefined) {
    return {
      ...publicPlan,
      status: "quick_evidence_reuse_blocked",
      exitCode: delta.exitCode,
      ready: false,
      issues: delta.issues,
      reuseReceiptPath: null,
    };
  }
  const deltaBytes = readFileSync(delta.receiptPath);
  const deltaReceipt = JSON.parse(deltaBytes.toString("utf8"));
  const accepted = delta.status === "quick_verification_passed"
    && deltaReceipt.workspaceBefore.sourceFingerprint === plan.currentSourceFingerprint
    && deltaReceipt.workspaceAfter.sourceFingerprint === plan.currentSourceFingerprint;
  const reasonCodes = accepted
    ? []
    : delta.status === "quick_verification_failed"
      ? ["delta_verification_command_failed"]
      : ["delta_candidate_or_environment_mutated"];
  const reuseId = `reuse-${Date.now()}-${randomUUID()}`;
  const body = {
    schemaVersion: "OwlCodaQuickEvidenceReuseReceiptV1",
    reuseId,
    baseReceipt: publicPlan.baseReceipt,
    delta: {
      allowedPaths: publicPlan.allowedPaths,
      actualPaths: publicPlan.actualDeltaPaths,
      unusedAllowedPaths: publicPlan.unusedAllowedPaths,
      currentSourceFingerprint: plan.currentSourceFingerprint,
      receiptId: deltaReceipt.receiptId,
      receiptPath: path.relative(root, delta.receiptPath).split(path.sep).join("/"),
      receiptSha256: sha256Bytes(deltaBytes),
      command: {
        executable: deltaReceipt.exactCommand.executable,
        argv: deltaReceipt.exactCommand.argv,
      },
    },
    decision: accepted ? "accepted" : "rejected",
    reasonCodes,
    proven: [
      "The base Quick receipt is strict, passed, source-unchanged, and material-readable.",
      "Every current candidate delta is an explicitly allowed literal path.",
      ...(accepted ? ["The exact delta verification command passed without candidate drift."] : []),
    ],
    notProven: [
      "Formal, UX, deployment, production, and business acceptance are not proven.",
      "No Git, release, deployment, production, or business authority is granted.",
    ],
    createdAt: new Date().toISOString(),
    authorizationGranted: false,
  };
  const persisted = persistReuseReceipt(root, body);
  const verification = verifyQuickEvidenceReuseReceipt({
    workspaceRoot: root,
    receiptPath: persisted.receiptPath,
  });
  if (accepted && verification.decision !== "GO") {
    throw new Error(`Persisted Quick evidence reuse receipt failed verification: ${verification.issueCodes.join(",")}`);
  }
  return {
    ...publicPlan,
    status: accepted ? "quick_evidence_reuse_accepted" : "quick_evidence_reuse_rejected",
    exitCode: accepted ? 0 : 1,
    decision: persisted.receipt.decision,
    reasonCodes,
    deltaReceiptPath: delta.receiptPath,
    reuseReceiptPath: persisted.receiptPath,
    reuseReceiptSha256: persisted.receipt.receiptSha256,
    outputSummary: delta.outputSummary,
    evidenceStorage: delta.evidenceStorage,
    verification,
    authorizationGranted: false,
  };
}
