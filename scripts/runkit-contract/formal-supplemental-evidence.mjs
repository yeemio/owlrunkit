import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  attestCoreBoundQuickReceiptDetailsFromBytes,
} from "./quick-attest.mjs";
import {
  decodeUtf8Strict,
  parseJsonStrict,
  readFileBytesBounded,
} from "../../packages/attest/src/formal.mjs";
import { persistEvidenceBytes } from "./evidence-store.mjs";
import { readFormalChecksV1 } from "./formal-workflow.mjs";
import {
  readWorkspaceBytesBounded,
  readWorkspaceFileBounded,
  readWorkspaceJsonBounded,
} from "./onboarding-doctor.mjs";
import { withControlTransaction } from "./lease-lifecycle.mjs";
import {
  loadActiveExecution,
  relativeToWorkspace,
  safeIdentifier,
  safeRelativePath,
  sha256,
  writeJsonExclusiveAtomically,
} from "./provenance-common.mjs";
import { verifySourceCandidateDetailsV2 } from "./source-candidate.mjs";

const SUPPLEMENTAL_SCHEMA = "OwlCodaRunKitFormalSupplementalEvidenceV1";
const SUMMARY_SCHEMA = "OwlCodaRunKitFormalEvidenceSummaryV1";
const KINDS = new Set(["supplemental-local", "networked"]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Formal supplemental evidence is not canonical JSON.");
  return encoded;
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function readRegularJson(filePath, label) {
  try {
    const { bytes } = readFileBytesBounded(filePath);
    return parseJsonStrict(decodeUtf8Strict(bytes));
  } catch (error) {
    throw new Error(`${label} must be a bounded regular JSON file without symlinks.`, {
      cause: error,
    });
  }
}

function writeOrResume(filePath, value, label) {
  if (!existsSync(filePath)) {
    writeJsonExclusiveAtomically(filePath, value);
    return { value, resumed: false };
  }
  const existing = readRegularJson(filePath, label);
  if (canonical(existing) !== canonical(value)) {
    throw new Error(`Existing ${label} differs from the resumed command.`);
  }
  return { value: existing, resumed: true };
}

function supplementalRoot(executionRoot) {
  return path.join(executionRoot, "formal-supplemental-evidence");
}

function ensureRegularDirectory(directory, label) {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const stat = lstatSync(directory);
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || realpathSync(directory) !== path.resolve(directory)
  ) {
    throw new Error(`${label} must be a regular directory without symlinks.`);
  }
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function validHash(value, prefixed = false) {
  return new RegExp(prefixed ? "^sha256:[a-f0-9]{64}$" : "^[a-f0-9]{64}$", "u")
    .test(value ?? "");
}

function frozenQuickMaterials({ workspaceRoot, receiptPath, attestation }) {
  const receiptRoot = path.dirname(receiptPath);
  return attestation.verifiedMaterials
    .filter(material => within(receiptRoot, material.path) || material.path === receiptPath)
    .map(material => {
      const { bytes, absolutePath } = readFileBytesBounded(material.path);
      if (absolutePath !== material.path) {
        throw new Error("Formal supplemental material path must not use symlinks.");
      }
      const stored = persistEvidenceBytes({
        workspaceRoot,
        bytes,
        encoding: "raw",
      });
      if (stored.sha256 !== material.sha256) {
        throw new Error("Formal supplemental material changed after Quick attestation.");
      }
      return {
        sourcePath: relativeToWorkspace(workspaceRoot, material.path),
        evidenceObjectPath: stored.path,
        sha256: stored.sha256,
        sizeBytes: stored.sizeBytes,
      };
    })
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "en"));
}

function validateFrozenMaterial(value, workspaceRoot) {
  if (!exactKeys(value, [
    "sourcePath", "evidenceObjectPath", "sha256", "sizeBytes",
  ])) return false;
  let sourcePath;
  let evidenceObjectPath;
  try {
    sourcePath = safeRelativePath(value.sourcePath, "frozen material sourcePath");
    evidenceObjectPath = safeRelativePath(
      value.evidenceObjectPath,
      "frozen material evidenceObjectPath",
    );
  } catch {
    return false;
  }
  if (
    sourcePath !== value.sourcePath
    || evidenceObjectPath !== value.evidenceObjectPath
    || !evidenceObjectPath.startsWith(".owlcoda/runkit/evidence/raw-sha256/")
    || !validHash(value.sha256, true)
    || !Number.isSafeInteger(value.sizeBytes)
    || value.sizeBytes < 0
  ) return false;
  try {
    const bytes = readWorkspaceBytesBounded(
      workspaceRoot,
      evidenceObjectPath,
      { maxBytes: Math.max(value.sizeBytes, 1) },
    );
    const sourceBytes = readWorkspaceBytesBounded(
      workspaceRoot,
      sourcePath,
      { maxBytes: Math.max(value.sizeBytes, 1) },
    );
    return bytes.byteLength === value.sizeBytes
      && sourceBytes.byteLength === value.sizeBytes
      && `sha256:${sha256(bytes)}` === value.sha256
      && `sha256:${sha256(sourceBytes)}` === value.sha256;
  } catch {
    return false;
  }
}

function validateSupplemental(value, { runId, evidenceId, workspaceRoot }) {
  const { supplementalEvidenceSha256, ...body } = value ?? {};
  let receiptPath;
  let candidatePath;
  try {
    receiptPath = safeRelativePath(value?.quickEvidence?.receiptPath, "receiptPath");
    candidatePath = safeRelativePath(value?.sourceBinding?.candidatePath, "candidatePath");
  } catch {
    return false;
  }
  return exactKeys(value, [
    "schemaVersion", "runId", "evidenceId", "kind", "classificationBasis",
    "status", "gating", "sourceBinding", "quickEvidence", "limitations",
    "frozenMaterials", "authorizationGranted", "supplementalEvidenceSha256",
  ])
    && value.schemaVersion === SUPPLEMENTAL_SCHEMA
    && value.runId === runId
    && value.evidenceId === evidenceId
    && KINDS.has(value.kind)
    && value.classificationBasis === "operator_declared_not_attested"
    && value.status === "attached"
    && value.gating === false
    && value.authorizationGranted === false
    && supplementalEvidenceSha256 === sha256(canonical(body))
    && exactKeys(value.sourceBinding, [
      "candidatePath", "candidateSha256", "sourceFingerprint", "quickWorkspaceFingerprint",
    ])
    && candidatePath === value.sourceBinding.candidatePath
    && validHash(value.sourceBinding.candidateSha256, true)
    && validHash(value.sourceBinding.sourceFingerprint)
    && validHash(value.sourceBinding.quickWorkspaceFingerprint, true)
    && exactKeys(value.quickEvidence, [
      "receiptId", "receiptPath", "receiptSha256", "receiptSchemaVersion",
      "exactCommand", "attestationDecision", "attestationIssueCodes",
    ])
    && receiptPath === value.quickEvidence.receiptPath
    && typeof value.quickEvidence.receiptId === "string"
    && value.quickEvidence.receiptId.length > 0
    && validHash(value.quickEvidence.receiptSha256, true)
    && typeof value.quickEvidence.receiptSchemaVersion === "string"
    && value.quickEvidence.receiptSchemaVersion.length > 0
    && value.quickEvidence.exactCommand !== null
    && typeof value.quickEvidence.exactCommand === "object"
    && !Array.isArray(value.quickEvidence.exactCommand)
    && value.quickEvidence.attestationDecision === "GO"
    && Array.isArray(value.quickEvidence.attestationIssueCodes)
    && value.quickEvidence.attestationIssueCodes.every(code => typeof code === "string")
    && Array.isArray(value.frozenMaterials)
    && value.frozenMaterials.length > 0
    && value.frozenMaterials.every(material => validateFrozenMaterial(material, workspaceRoot))
    && value.frozenMaterials.some(material => (
      material.sourcePath === value.quickEvidence.receiptPath
      && material.sha256 === value.quickEvidence.receiptSha256
    ))
    && Array.isArray(value.limitations)
    && value.limitations.length > 0
    && value.limitations.every(limit => typeof limit === "string" && limit.length > 0);
}

function readSupplementals(workspaceRoot, executionRoot, runId) {
  const root = supplementalRoot(executionRoot);
  if (!existsSync(root)) return [];
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Formal supplemental evidence root must be a regular directory.");
  }
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(`Formal supplemental evidence must be a regular file: ${entry.name}`);
      }
      const artifactPath = path.join(root, entry.name);
      const value = readWorkspaceJsonBounded(
        workspaceRoot,
        relativeToWorkspace(workspaceRoot, artifactPath),
      );
      const evidenceId = entry.name.slice(0, -".json".length);
      if (!validateSupplemental(value, { runId, evidenceId, workspaceRoot })) {
        throw new Error(`Formal supplemental evidence contract is invalid: ${entry.name}`);
      }
      return value;
    });
}

function latestCurrentCandidate({ workspaceRoot, executionRoot, runId }) {
  const checks = readFormalChecksV1({ workspaceRoot, executionRoot, runId });
  if (checks.length === 0) {
    throw new Error("Formal supplemental evidence requires at least one existing Formal check candidate.");
  }
  const latest = checks.at(-1);
  const details = verifySourceCandidateDetailsV2({
    workspaceRoot,
    candidatePath: latest.candidatePath,
  });
  if (
    details.gate.status !== "valid"
    || details.gate.candidatePath !== latest.candidatePath
    || details.gate.candidateSha256 !== latest.candidateSha256
    || details.gate.sourceFingerprint !== latest.sourceFingerprint
  ) {
    throw new Error("Formal supplemental evidence requires the latest source candidate to remain current.");
  }
  const candidate = details.candidateDocument;
  return { checks, latest, candidate };
}

function quickReceiptMatchesCandidate(receipt, candidate) {
  if (receipt.workspaceAfter.headCommit !== candidate.baseline.head) return false;
  const expected = new Map();
  for (const entry of candidate.sourceManifest.entries) {
    if (entry.operation === "deleted") {
      expected.set(entry.path, { path: entry.path, state: "deleted", sha256: null });
      continue;
    }
    if (entry.operation === "renamed") {
      expected.set(entry.previousPath, {
        path: entry.previousPath,
        state: "deleted",
        sha256: null,
      });
    }
    expected.set(entry.path, {
      path: entry.path,
      state: entry.status === "??" ? "untracked" : "modified",
      sha256: `sha256:${entry.sha256}`,
    });
  }
  const actual = [...receipt.workspaceAfter.dirtyOverlay]
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const projected = [...expected.values()]
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  return canonical(actual) === canonical(projected);
}

function attachWithinControlTransaction({
  workspaceRoot,
  runId,
  evidenceId,
  kind,
  receiptPath,
}) {
  safeIdentifier(evidenceId, "evidenceId");
  if (!KINDS.has(kind)) {
    throw new Error("Formal supplemental evidence kind must be supplemental-local or networked.");
  }
  const root = realpathSync(workspaceRoot);
  const { executionRoot, pinGate } = loadActiveExecution(root, runId);
  if (pinGate.status !== "valid") return { ...pinGate, authorizationGranted: false };
  if (existsSync(path.join(executionRoot, "closeout-receipt.json"))) {
    throw new Error(`Execution is already closed: ${runId}`);
  }
  const requestedPath = path.resolve(receiptPath);
  if (!within(root, requestedPath)) {
    throw new Error("Formal supplemental Quick receipt must remain inside the workspace.");
  }
  const requestedRelativePath = relativeToWorkspace(root, requestedPath);
  const requestedText = readWorkspaceFileBounded(root, requestedRelativePath);
  const requestedReceipt = {
    absolutePath: requestedPath,
    bytes: Buffer.from(requestedText, "utf8"),
  };
  const receipt = parseJsonStrict(decodeUtf8Strict(requestedReceipt.bytes));
  const attested = attestCoreBoundQuickReceiptDetailsFromBytes({
    receiptPath: requestedReceipt.absolutePath,
    receiptBytes: requestedReceipt.bytes,
    workspaceRoot: root,
  });
  if (attested.attestation.decision !== "GO") {
    throw new Error(
      `Formal supplemental Quick attestation must be GO: ${attested.attestation.issueCodes.join(",")}.`,
    );
  }
  const { latest, candidate } = latestCurrentCandidate({
    workspaceRoot: root,
    executionRoot,
    runId,
  });
  if (!quickReceiptMatchesCandidate(receipt, candidate)) {
    throw new Error("Formal supplemental Quick receipt does not describe the current source candidate.");
  }
  const frozenMaterials = frozenQuickMaterials({
    workspaceRoot: root,
    receiptPath: requestedReceipt.absolutePath,
    attestation: attested.attestation,
  });
  if (frozenMaterials.length === 0) {
    throw new Error("Formal supplemental evidence requires frozen Quick receipt materials.");
  }
  const body = {
    schemaVersion: SUPPLEMENTAL_SCHEMA,
    runId,
    evidenceId,
    kind,
    classificationBasis: "operator_declared_not_attested",
    status: "attached",
    gating: false,
    sourceBinding: {
      candidatePath: latest.candidatePath,
      candidateSha256: candidate.candidateSha256,
      sourceFingerprint: latest.sourceFingerprint,
      quickWorkspaceFingerprint: attested.sourceFingerprint,
    },
    quickEvidence: {
      receiptId: receipt.receiptId,
      receiptPath: requestedRelativePath,
      receiptSha256: attested.attestation.subjectRef.receiptSha256,
      receiptSchemaVersion: receipt.schemaVersion,
      exactCommand: structuredClone(receipt.exactCommand),
      attestationDecision: attested.attestation.decision,
      attestationIssueCodes: [...attested.attestation.issueCodes],
    },
    limitations: [
      "supplemental_evidence_is_not_formal_sandbox_evidence",
      "network_classification_is_operator_declared_not_attested",
      "supplemental_evidence_cannot_grant_acceptance_or_authority",
    ],
    frozenMaterials,
    authorizationGranted: false,
  };
  const value = {
    ...body,
    supplementalEvidenceSha256: sha256(canonical(body)),
  };
  const evidenceRoot = supplementalRoot(executionRoot);
  ensureRegularDirectory(evidenceRoot, "Formal supplemental evidence root");
  const artifactPath = path.join(evidenceRoot, `${evidenceId}.json`);
  const written = writeOrResume(artifactPath, value, "Formal supplemental evidence");
  return {
    status: "formal_supplemental_evidence_attached",
    exitCode: 0,
    runId,
    evidenceId,
    kind,
    sourceFingerprint: latest.sourceFingerprint,
    quickWorkspaceFingerprint: attested.sourceFingerprint,
    evidencePath: relativeToWorkspace(root, artifactPath),
    supplementalEvidenceSha256: written.value.supplementalEvidenceSha256,
    gating: false,
    resumed: written.resumed,
    authorizationGranted: false,
  };
}

export function attachFormalSupplementalEvidenceV1(options) {
  const root = realpathSync(options.workspaceRoot);
  return withControlTransaction(root, () => attachWithinControlTransaction({
    ...options,
    workspaceRoot: root,
  }));
}

export function summarizeFormalEvidenceWithinControlTransaction({
  workspaceRoot,
  runId,
  summaryId,
}) {
  safeIdentifier(summaryId, "summaryId");
  const root = realpathSync(workspaceRoot);
  const { executionRoot, pinGate } = loadActiveExecution(root, runId);
  if (pinGate.status !== "valid") return { ...pinGate, authorizationGranted: false };
  const { checks, latest, candidate } = latestCurrentCandidate({
    workspaceRoot: root,
    executionRoot,
    runId,
  });
  const allSupplemental = readSupplementals(root, executionRoot, runId);
  const currentSupplemental = allSupplemental.filter(row => (
    row.runId === runId
    && row.sourceBinding.candidatePath === latest.candidatePath
    && row.sourceBinding.sourceFingerprint === latest.sourceFingerprint
    && row.sourceBinding.candidateSha256 === candidate.candidateSha256
  ));
  for (const row of currentSupplemental) {
    const receiptText = readWorkspaceFileBounded(
      root,
      row.quickEvidence.receiptPath,
    );
    const quickReceipt = {
      absolutePath: path.join(root, row.quickEvidence.receiptPath),
      bytes: Buffer.from(receiptText, "utf8"),
    };
    const receipt = parseJsonStrict(decodeUtf8Strict(quickReceipt.bytes));
    const attested = attestCoreBoundQuickReceiptDetailsFromBytes({
      receiptPath: quickReceipt.absolutePath,
      receiptBytes: quickReceipt.bytes,
      workspaceRoot: root,
    });
    if (
      attested.attestation.decision !== "GO"
      || attested.attestation.subjectRef.receiptSha256
        !== row.quickEvidence.receiptSha256
      || attested.sourceFingerprint
        !== row.sourceBinding.quickWorkspaceFingerprint
      || receipt.receiptId !== row.quickEvidence.receiptId
      || receipt.schemaVersion !== row.quickEvidence.receiptSchemaVersion
      || canonical(receipt.exactCommand) !== canonical(row.quickEvidence.exactCommand)
      || canonical(attested.attestation.issueCodes)
        !== canonical(row.quickEvidence.attestationIssueCodes)
      || !quickReceiptMatchesCandidate(receipt, candidate)
    ) {
      throw new Error(
        `Formal supplemental Quick attestation must remain GO: ${row.evidenceId}.`,
      );
    }
  }
  const currentChecks = checks.filter(row => (
    row.sourceFingerprint === latest.sourceFingerprint
    && row.verificationContextFingerprint
      === latest.verificationContextFingerprint
  ));
  const body = {
    schemaVersion: SUMMARY_SCHEMA,
    runId,
    summaryId,
    sourceBinding: {
      candidatePath: latest.candidatePath,
      candidateSha256: candidate.candidateSha256,
      sourceFingerprint: latest.sourceFingerprint,
    },
    formalChecks: currentChecks.map(row => ({
      checkId: row.checkId,
      status: row.status,
      failureCategory: row.failureCategory ?? null,
      formalEligible: row.status === "formal_check_passed",
      snapshotPath: row.snapshotPath,
      envelopeReceiptPath: row.envelopeReceiptPath ?? null,
    })),
    supplementalEvidence: currentSupplemental.map(row => ({
      evidenceId: row.evidenceId,
      kind: row.kind,
      classificationBasis: row.classificationBasis,
      evidencePath: relativeToWorkspace(
        root,
        path.join(supplementalRoot(executionRoot), `${row.evidenceId}.json`),
      ),
      supplementalEvidenceSha256: row.supplementalEvidenceSha256,
      gating: false,
    })),
    staleFormalCheckCount: checks.length - currentChecks.length,
    staleSupplementalEvidenceCount: allSupplemental.length - currentSupplemental.length,
    formalAcceptanceDerivedOnlyFromFormalChecks: true,
    limitations: [
      "supplemental_evidence_is_non_gating",
      "network_classification_is_operator_declared_not_attested",
      "source_acceptance_does_not_grant_git_release_deployment_or_business_authority",
    ],
    authorizationGranted: false,
  };
  const value = { ...body, evidenceSummarySha256: sha256(canonical(body)) };
  const artifactPath = path.join(
    executionRoot,
    "formal-evidence-summaries",
    `${summaryId}.json`,
  );
  ensureRegularDirectory(
    path.dirname(artifactPath),
    "Formal evidence summary root",
  );
  const written = writeOrResume(artifactPath, value, "Formal evidence summary");
  return {
    status: "formal_evidence_summarized",
    exitCode: 0,
    runId,
    evidenceSummaryPath: relativeToWorkspace(root, artifactPath),
    evidenceSummarySha256: written.value.evidenceSummarySha256,
    formalCheckCount: written.value.formalChecks.length,
    supplementalEvidenceCount: written.value.supplementalEvidence.length,
    staleSupplementalEvidenceCount: written.value.staleSupplementalEvidenceCount,
    resumed: written.resumed,
    authorizationGranted: false,
  };
}

export function summarizeFormalEvidenceV1(options) {
  const root = realpathSync(options.workspaceRoot);
  return withControlTransaction(root, () => summarizeFormalEvidenceWithinControlTransaction({
    ...options,
    workspaceRoot: root,
  }));
}

function validateSummaryDocument(value, {
  workspaceRoot,
  runId,
  summaryId,
}) {
  const { evidenceSummarySha256, ...body } = value ?? {};
  if (
    !exactKeys(value, [
      "schemaVersion",
      "runId",
      "summaryId",
      "sourceBinding",
      "formalChecks",
      "supplementalEvidence",
      "staleFormalCheckCount",
      "staleSupplementalEvidenceCount",
      "formalAcceptanceDerivedOnlyFromFormalChecks",
      "limitations",
      "authorizationGranted",
      "evidenceSummarySha256",
    ])
    || value.schemaVersion !== SUMMARY_SCHEMA
    || value.runId !== runId
    || value.summaryId !== summaryId
    || evidenceSummarySha256 !== sha256(canonical(body))
    || !exactKeys(value.sourceBinding, [
      "candidatePath", "candidateSha256", "sourceFingerprint",
    ])
    || !validHash(value.sourceBinding.candidateSha256, true)
    || !validHash(value.sourceBinding.sourceFingerprint)
    || !Array.isArray(value.formalChecks)
    || !Array.isArray(value.supplementalEvidence)
    || !Number.isSafeInteger(value.staleFormalCheckCount)
    || value.staleFormalCheckCount < 0
    || !Number.isSafeInteger(value.staleSupplementalEvidenceCount)
    || value.staleSupplementalEvidenceCount < 0
    || value.formalAcceptanceDerivedOnlyFromFormalChecks !== true
    || !Array.isArray(value.limitations)
    || value.limitations.length === 0
    || value.limitations.some(limit => typeof limit !== "string" || limit.length === 0)
    || value.authorizationGranted !== false
  ) {
    throw new Error("Formal evidence summary contract is invalid.");
  }
  for (const check of value.formalChecks) {
    if (
      !exactKeys(check, [
        "checkId",
        "status",
        "failureCategory",
        "formalEligible",
        "snapshotPath",
        "envelopeReceiptPath",
      ])
      || typeof check.checkId !== "string"
      || !new Set(["formal_check_passed", "formal_check_failed"]).has(check.status)
      || typeof check.snapshotPath !== "string"
      || !(check.envelopeReceiptPath === null
        || typeof check.envelopeReceiptPath === "string")
      || (check.status === "formal_check_passed"
        ? check.formalEligible !== true || check.failureCategory !== null
        : check.formalEligible !== false
          || !new Set([
            "source_check_failed",
            "envelope_capability_missing",
            "toolchain_resolution_failed",
            "network_policy_blocked",
          ]).has(check.failureCategory))
    ) {
      throw new Error("Formal evidence summary check contract is invalid.");
    }
  }
  for (const row of value.supplementalEvidence) {
    if (!exactKeys(row, [
      "evidenceId",
      "kind",
      "classificationBasis",
      "evidencePath",
      "supplementalEvidenceSha256",
      "gating",
    ])) {
      throw new Error("Formal evidence summary supplemental row is invalid.");
    }
    safeIdentifier(row.evidenceId, "evidenceId");
    const expectedPath = `.owlcoda/runkit/executions/${runId}`
      + `/formal-supplemental-evidence/${row.evidenceId}.json`;
    if (
      row.evidencePath !== expectedPath
      || !KINDS.has(row.kind)
      || row.classificationBasis !== "operator_declared_not_attested"
      || !validHash(row.supplementalEvidenceSha256)
      || row.gating !== false
    ) {
      throw new Error("Formal evidence summary supplemental row is invalid.");
    }
    const artifact = readWorkspaceJsonBounded(workspaceRoot, row.evidencePath);
    if (
      !validateSupplemental(artifact, {
        runId,
        evidenceId: row.evidenceId,
        workspaceRoot,
      })
      || artifact.supplementalEvidenceSha256
        !== row.supplementalEvidenceSha256
    ) {
      throw new Error("Formal evidence summary supplemental binding is invalid.");
    }
  }
  return value;
}

export function readFormalEvidenceSummaryV1({
  workspaceRoot,
  runId,
  summaryId,
}) {
  safeIdentifier(runId, "runId");
  safeIdentifier(summaryId, "summaryId");
  const root = realpathSync(workspaceRoot);
  const artifactPath = path.join(
    root,
    ".owlcoda",
    "runkit",
    "executions",
    runId,
    "formal-evidence-summaries",
    `${summaryId}.json`,
  );
  if (!existsSync(artifactPath)) return null;
  const value = validateSummaryDocument(
    readWorkspaceJsonBounded(
      root,
      relativeToWorkspace(root, artifactPath),
    ),
    { workspaceRoot: root, runId, summaryId },
  );
  const { evidenceSummarySha256 } = value;
  return {
    evidenceSummaryPath: relativeToWorkspace(root, artifactPath),
    evidenceSummarySha256,
    formalCheckCount: value.formalChecks.length,
    supplementalEvidenceCount: value.supplementalEvidence.length,
    staleSupplementalEvidenceCount: value.staleSupplementalEvidenceCount,
    summaryDocument: value,
    authorizationGranted: false,
  };
}

export function reattestFormalEvidenceSummaryV1(options) {
  return readFormalEvidenceSummaryV1(options);
}
