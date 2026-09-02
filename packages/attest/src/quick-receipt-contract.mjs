import {
  hasExactKeys,
  isSha256Ref,
  sha256Canonical,
} from "./formal.mjs";
import {
  validCanonicalCandidateIdentityV1,
  validForeignWorkspaceFilesystemIdentityV1,
} from "./candidate-identity.mjs";

const RECEIPT_REQUIRED_KEYS = [
  "schemaVersion",
  "receiptId",
  "assurance",
  "authorizationGranted",
  "coreIdentity",
  "workspaceBefore",
  "exactCommand",
  "verificationContext",
  "startedAt",
  "finishedAt",
  "exitResult",
  "outputArtifacts",
  "workspaceAfter",
  "mutationDecision",
  "issueCodes",
];
const SNAPSHOT_REQUIRED_KEYS = [
  "schemaVersion",
  "repositoryIdentity",
  "headCommit",
  "trackedTreeIdentity",
  "submodules",
  "dirtyOverlay",
  "dependencyLockfiles",
  "excludedRoots",
  "ignoredPathsBound",
  "policyVersion",
  "sourceFingerprint",
];
const SNAPSHOT_V2_REQUIRED_KEYS = [
  ...SNAPSHOT_REQUIRED_KEYS.filter(key => key !== "sourceFingerprint"),
  "ignoredPathBindings",
  "ignoredPathsFingerprint",
  "sourceStateFingerprint",
  "sourceFingerprint",
];
const KNOWN_RECEIPT_ISSUES = new Set([
  "quick_ignored_artifact_unbound",
  "source_mutated_during_verification",
]);
const V3_RECEIPT_ISSUES = new Set([
  ...KNOWN_RECEIPT_ISSUES,
  "bound_ignored_path_mutated_during_verification",
  "dependency_environment_mutated_during_verification",
  "consumer_source_mutated_during_verification",
  "quick_isolation_cleanup_failed",
]);
const V4_RECEIPT_ISSUES = new Set([
  ...V3_RECEIPT_ISSUES,
  "foreign_workspace_mutated_during_verification",
]);
const V3_MUTATION_DECISIONS = new Set([
  "source_unchanged",
  "invalidated_by_command_source_mutation",
  "invalidated_by_bound_ignored_mutation",
  "invalidated_by_dependency_environment_mutation",
  "invalidated_by_consumer_source_mutation",
  "invalidated_by_isolation_cleanup_failure",
  "invalidated_by_multiple_mutations",
]);
const V4_MUTATION_DECISIONS = new Set([
  ...V3_MUTATION_DECISIONS,
  "invalidated_by_foreign_workspace_mutation",
]);

function validDateTime(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validCoreIdentity(value) {
  return hasExactKeys(value, ["contractVersion", "coreVersion", "coreManifestSha256"])
    && typeof value.contractVersion === "string"
    && value.contractVersion.length > 0
    && typeof value.coreVersion === "string"
    && value.coreVersion.length > 0
    && isSha256Ref(value.coreManifestSha256);
}

function sourceStateFingerprint(value) {
  return sha256Canonical({
    repositoryIdentity: value.repositoryIdentity,
    headCommit: value.headCommit,
    trackedTreeIdentity: value.trackedTreeIdentity,
    submodules: value.submodules,
    dirtyOverlay: value.dirtyOverlay,
    dependencyLockfiles: value.dependencyLockfiles,
    excludedRoots: value.excludedRoots,
  });
}

export function validWorkspaceSnapshotShape(value) {
  const snapshotV1 = value?.schemaVersion === "OwlCodaWorkspaceSnapshotV1";
  const snapshotV2 = value?.schemaVersion === "OwlCodaWorkspaceSnapshotV2";
  if (!(snapshotV1 || snapshotV2)) return false;
  if (!hasExactKeys(value, snapshotV2 ? SNAPSHOT_V2_REQUIRED_KEYS : SNAPSHOT_REQUIRED_KEYS)) return false;
  if (
    typeof value.repositoryIdentity !== "string"
    || value.repositoryIdentity.length === 0
    || !(value.headCommit === null || /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value.headCommit))
    || !isSha256Ref(value.trackedTreeIdentity)
    || value.ignoredPathsBound !== snapshotV2
    || value.policyVersion !== (snapshotV2 ? "workspace-snapshot-v2" : "workspace-snapshot-v1")
    || !isSha256Ref(value.sourceFingerprint)
    || !Array.isArray(value.submodules)
    || !Array.isArray(value.dirtyOverlay)
    || !Array.isArray(value.dependencyLockfiles)
    || !Array.isArray(value.excludedRoots)
    || !value.excludedRoots.includes(".owlcoda/runkit")
  ) {
    return false;
  }
  if (!value.submodules.every((entry) =>
    hasExactKeys(entry, ["path", "commit"])
    && typeof entry.path === "string"
    && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(entry.commit))) {
    return false;
  }
  if (!value.dirtyOverlay.every((entry) =>
    hasExactKeys(entry, ["path", "state", "sha256"])
    && typeof entry.path === "string"
    && ["modified", "untracked", "deleted"].includes(entry.state)
    && (entry.sha256 === null || isSha256Ref(entry.sha256)))) {
    return false;
  }
  if (!value.dependencyLockfiles.every((entry) =>
    hasExactKeys(entry, ["path", "sha256"])
    && typeof entry.path === "string"
    && isSha256Ref(entry.sha256))) {
    return false;
  }
  if (snapshotV2 && (
    !Array.isArray(value.ignoredPathBindings)
    || value.ignoredPathBindings.length === 0
    || !isSha256Ref(value.ignoredPathsFingerprint)
    || !isSha256Ref(value.sourceStateFingerprint)
    || !value.ignoredPathBindings.every(entry =>
      hasExactKeys(entry, ["path", "state", "sha256"])
      && typeof entry.path === "string"
      && entry.path.length > 0
      && ["missing", "file", "directory"].includes(entry.state)
      && (entry.sha256 === null || isSha256Ref(entry.sha256)))
    || sha256Canonical(value.ignoredPathBindings) !== value.ignoredPathsFingerprint
    || sourceStateFingerprint(value) !== value.sourceStateFingerprint
  )) {
    return false;
  }
  return true;
}

export function quickSnapshotFingerprintValid(value) {
  const { sourceFingerprint, ...payload } = value;
  return sha256Canonical(payload) === sourceFingerprint;
}

function validOutputArtifact(value) {
  return hasExactKeys(value, ["path", "sha256", "sizeBytes"])
    && typeof value.path === "string"
    && value.path.length > 0
    && isSha256Ref(value.sha256)
    && Number.isInteger(value.sizeBytes)
    && value.sizeBytes >= 0;
}

function validDependencyEnvironment(value) {
  if (value === null) return true;
  if (!hasExactKeys(value, ["root", "materials", "fingerprint"])
    || typeof value.root !== "string"
    || value.root.length === 0
    || !Array.isArray(value.materials)
    || value.materials.length < 2
    || !isSha256Ref(value.fingerprint)
    || !value.materials.every(material =>
      hasExactKeys(material, ["path", "sha256"])
      && typeof material.path === "string"
      && material.path.length > 0
      && isSha256Ref(material.sha256))) {
    return false;
  }
  return sha256Canonical({ root: value.root, materials: value.materials }) === value.fingerprint;
}

function validExecutionIsolation(value, receipt) {
  if (value === null) {
    return receipt.mutationClasses.consumerSource === "not_isolated"
      && receipt.mutationClasses.consumerIgnoredArtifacts === "not_isolated";
  }
  return hasExactKeys(value, [
    "schemaVersion",
    "mode",
    "consumerRoot",
    "sourceCopy",
    "cacheEnvironmentVariables",
    "dependencyEnvironment",
    "dependencyEnvironmentAfter",
    "consumerDelta",
    "cleanupStatus",
  ])
    && value.schemaVersion === "OwlCodaRunKitQuickIsolationV1"
    && value.mode === "temporary_consumer"
    && typeof value.consumerRoot === "string"
    && value.consumerRoot.length > 0
    && value.consumerRoot === receipt.exactCommand.cwd
    && hasExactKeys(value.sourceCopy, ["fileCount", "totalBytes", "fingerprint"])
    && Number.isInteger(value.sourceCopy.fileCount)
    && value.sourceCopy.fileCount >= 0
    && Number.isInteger(value.sourceCopy.totalBytes)
    && value.sourceCopy.totalBytes >= 0
    && isSha256Ref(value.sourceCopy.fingerprint)
    && Array.isArray(value.cacheEnvironmentVariables)
    && value.cacheEnvironmentVariables.length > 0
    && new Set(value.cacheEnvironmentVariables).size === value.cacheEnvironmentVariables.length
    && value.cacheEnvironmentVariables.every(name => typeof name === "string" && name.length > 0)
    && validDependencyEnvironment(value.dependencyEnvironment)
    && validDependencyEnvironment(value.dependencyEnvironmentAfter)
    && (value.dependencyEnvironment !== null || value.dependencyEnvironmentAfter === null)
    && hasExactKeys(value.consumerDelta, ["sourcePaths", "ignoredPaths"])
    && [value.consumerDelta.sourcePaths, value.consumerDelta.ignoredPaths].every(paths =>
      Array.isArray(paths)
      && new Set(paths).size === paths.length
      && paths.every(entry => typeof entry === "string" && entry.length > 0))
    && ["removed", "cleanup_failed"].includes(value.cleanupStatus);
}

function validMutationClasses(value) {
  return hasExactKeys(value, [
    "workspaceSource",
    "boundIgnoredPaths",
    "dependencyEnvironment",
    "consumerSource",
    "consumerIgnoredArtifacts",
  ])
    && ["unchanged", "changed"].includes(value.workspaceSource)
    && ["not_bound", "unchanged", "changed"].includes(value.boundIgnoredPaths)
    && ["not_bound", "unchanged", "changed"].includes(value.dependencyEnvironment)
    && ["not_isolated", "unchanged", "changed"].includes(value.consumerSource)
    && ["not_isolated", "none", "changed_and_discarded"].includes(value.consumerIgnoredArtifacts);
}

function validForeignMutationClasses(value) {
  return hasExactKeys(value, [
    "workspaceSource",
    "boundIgnoredPaths",
    "dependencyEnvironment",
    "consumerSource",
    "consumerIgnoredArtifacts",
    "foreignTarget",
  ])
    && ["unchanged", "changed"].includes(value.workspaceSource)
    && ["not_bound", "unchanged", "changed"].includes(value.boundIgnoredPaths)
    && ["not_bound", "unchanged", "changed"].includes(value.dependencyEnvironment)
    && ["unchanged", "changed"].includes(value.consumerSource)
    && ["none", "changed_and_discarded"].includes(value.consumerIgnoredArtifacts)
    && ["unchanged", "changed"].includes(value.foreignTarget);
}

function validForeignWorkspace(value, sourceWorkspaceRoot) {
  if (!hasExactKeys(value, [
    "candidateBefore",
    "candidateAfter",
    "filesystemBefore",
    "filesystemAfter",
    "zeroWriteObserved",
  ])) return false;
  if (
    !validCanonicalCandidateIdentityV1(value.candidateBefore)
    || !validCanonicalCandidateIdentityV1(value.candidateAfter)
    || !validForeignWorkspaceFilesystemIdentityV1(value.filesystemBefore)
    || !validForeignWorkspaceFilesystemIdentityV1(value.filesystemAfter)
    || value.candidateBefore.workspaceRoot !== sourceWorkspaceRoot
    || value.candidateAfter.workspaceRoot !== sourceWorkspaceRoot
    || value.filesystemBefore.workspaceRoot !== sourceWorkspaceRoot
    || value.filesystemAfter.workspaceRoot !== sourceWorkspaceRoot
  ) return false;
  const unchanged = value.candidateBefore.candidateFingerprint
      === value.candidateAfter.candidateFingerprint
    && value.filesystemBefore.filesystemFingerprint
      === value.filesystemAfter.filesystemFingerprint;
  return value.zeroWriteObserved === unchanged;
}

function validV3MutationTruth(receipt) {
  const workspaceSourceChanged = sourceStateFingerprint(receipt.workspaceBefore)
    !== sourceStateFingerprint(receipt.workspaceAfter);
  const boundIgnored = receipt.workspaceBefore.ignoredPathsBound === true;
  const boundIgnoredChanged = boundIgnored
    && receipt.workspaceBefore.ignoredPathsFingerprint
      !== receipt.workspaceAfter.ignoredPathsFingerprint;
  const isolation = receipt.executionIsolation;
  const consumerSourceChanged = (isolation?.consumerDelta.sourcePaths.length ?? 0) > 0;
  const consumerIgnoredChanged = (isolation?.consumerDelta.ignoredPaths.length ?? 0) > 0;
  const dependencyBound = isolation !== null && isolation?.dependencyEnvironment !== null;
  const dependencyChanged = dependencyBound
    && (isolation.dependencyEnvironmentAfter === null
      || isolation.dependencyEnvironmentAfter.fingerprint
        !== isolation.dependencyEnvironment.fingerprint);
  const cleanupFailed = isolation?.cleanupStatus === "cleanup_failed";
  if (receipt.mutationClasses.workspaceSource !== (workspaceSourceChanged ? "changed" : "unchanged")
    || receipt.mutationClasses.boundIgnoredPaths !== (boundIgnored
      ? boundIgnoredChanged ? "changed" : "unchanged"
      : "not_bound")
    || receipt.mutationClasses.dependencyEnvironment !== (dependencyBound
      ? dependencyChanged ? "changed" : "unchanged"
      : "not_bound")
    || receipt.mutationClasses.consumerSource !== (isolation === null
      ? "not_isolated"
      : consumerSourceChanged ? "changed" : "unchanged")
    || receipt.mutationClasses.consumerIgnoredArtifacts !== (isolation === null
      ? "not_isolated"
      : consumerIgnoredChanged ? "changed_and_discarded" : "none")) {
    return false;
  }
  const facts = [
    [workspaceSourceChanged, "invalidated_by_command_source_mutation", "source_mutated_during_verification"],
    [boundIgnoredChanged, "invalidated_by_bound_ignored_mutation", "bound_ignored_path_mutated_during_verification"],
    [dependencyChanged, "invalidated_by_dependency_environment_mutation", "dependency_environment_mutated_during_verification"],
    [consumerSourceChanged, "invalidated_by_consumer_source_mutation", "consumer_source_mutated_during_verification"],
    [cleanupFailed, "invalidated_by_isolation_cleanup_failure", "quick_isolation_cleanup_failed"],
  ].filter(([active]) => active);
  const expectedDecision = facts.length === 0
    ? "source_unchanged"
    : facts.length === 1 ? facts[0][1] : "invalidated_by_multiple_mutations";
  const expectedIssues = facts.map(([, , issue]) => issue).sort();
  return receipt.mutationDecision === expectedDecision
    && JSON.stringify([...receipt.issueCodes].sort()) === JSON.stringify(expectedIssues);
}

function validV4MutationTruth(receipt) {
  const workspaceSourceChanged = sourceStateFingerprint(receipt.workspaceBefore)
    !== sourceStateFingerprint(receipt.workspaceAfter);
  const boundIgnored = receipt.workspaceBefore.ignoredPathsBound === true;
  const boundIgnoredChanged = boundIgnored
    && receipt.workspaceBefore.ignoredPathsFingerprint
      !== receipt.workspaceAfter.ignoredPathsFingerprint;
  const isolation = receipt.executionIsolation;
  const consumerSourceChanged = isolation.consumerDelta.sourcePaths.length > 0;
  const consumerIgnoredChanged = isolation.consumerDelta.ignoredPaths.length > 0;
  const dependencyBound = isolation.dependencyEnvironment !== null;
  const dependencyChanged = dependencyBound
    && (isolation.dependencyEnvironmentAfter === null
      || isolation.dependencyEnvironmentAfter.fingerprint
        !== isolation.dependencyEnvironment.fingerprint);
  const cleanupFailed = isolation.cleanupStatus === "cleanup_failed";
  const foreignChanged = receipt.foreignWorkspace.zeroWriteObserved !== true;
  if (receipt.mutationClasses.workspaceSource !== (workspaceSourceChanged ? "changed" : "unchanged")
    || receipt.mutationClasses.boundIgnoredPaths !== (boundIgnored
      ? boundIgnoredChanged ? "changed" : "unchanged"
      : "not_bound")
    || receipt.mutationClasses.dependencyEnvironment !== (dependencyBound
      ? dependencyChanged ? "changed" : "unchanged"
      : "not_bound")
    || receipt.mutationClasses.consumerSource !== (consumerSourceChanged ? "changed" : "unchanged")
    || receipt.mutationClasses.consumerIgnoredArtifacts !== (consumerIgnoredChanged
      ? "changed_and_discarded" : "none")
    || receipt.mutationClasses.foreignTarget !== (foreignChanged ? "changed" : "unchanged")) {
    return false;
  }
  const facts = [
    [workspaceSourceChanged, "invalidated_by_command_source_mutation", "source_mutated_during_verification"],
    [boundIgnoredChanged, "invalidated_by_bound_ignored_mutation", "bound_ignored_path_mutated_during_verification"],
    [dependencyChanged, "invalidated_by_dependency_environment_mutation", "dependency_environment_mutated_during_verification"],
    [consumerSourceChanged, "invalidated_by_consumer_source_mutation", "consumer_source_mutated_during_verification"],
    [cleanupFailed, "invalidated_by_isolation_cleanup_failure", "quick_isolation_cleanup_failed"],
    [foreignChanged, "invalidated_by_foreign_workspace_mutation", "foreign_workspace_mutated_during_verification"],
  ].filter(([active]) => active);
  const expectedDecision = facts.length === 0
    ? "source_unchanged"
    : facts.length === 1 ? facts[0][1] : "invalidated_by_multiple_mutations";
  const expectedIssues = facts.map(([, , issue]) => issue).sort();
  return receipt.mutationDecision === expectedDecision
    && JSON.stringify([...receipt.issueCodes].sort()) === JSON.stringify(expectedIssues);
}

export function validQuickReceiptShape(receipt) {
  const receiptV1 = receipt?.schemaVersion === "OwlCodaQuickVerificationReceiptV1";
  const receiptV2 = receipt?.schemaVersion === "OwlCodaQuickVerificationReceiptV2";
  const receiptV3 = receipt?.schemaVersion === "OwlCodaQuickVerificationReceiptV3";
  const receiptV4 = receipt?.schemaVersion === "OwlCodaQuickVerificationReceiptV4";
  const requiredKeys = receiptV4
    ? [...RECEIPT_REQUIRED_KEYS, "controllerWorkspaceRoot", "sourceWorkspaceRoot", "executionIsolation", "mutationClasses", "foreignWorkspace"]
    : receiptV3
    ? [...RECEIPT_REQUIRED_KEYS, "sourceWorkspaceRoot", "executionIsolation", "mutationClasses"]
    : receiptV2
    ? [...RECEIPT_REQUIRED_KEYS, "inputArtifacts"]
    : RECEIPT_REQUIRED_KEYS;
  const optionalKeys = receiptV3 || receiptV4 ? ["inputArtifacts", "signatureRef"] : ["signatureRef"];
  if (!(receiptV1 || receiptV2 || receiptV3 || receiptV4) || !hasExactKeys(receipt, requiredKeys, optionalKeys)) return false;
  if (
    typeof receipt.receiptId !== "string"
    || receipt.receiptId.length === 0
    || receipt.assurance !== "captured_verification"
    || receipt.authorizationGranted !== false
    || !validCoreIdentity(receipt.coreIdentity)
    || !validWorkspaceSnapshotShape(receipt.workspaceBefore)
    || !validWorkspaceSnapshotShape(receipt.workspaceAfter)
    || !hasExactKeys(receipt.exactCommand, ["executable", "argv", "cwd"])
    || typeof receipt.exactCommand.executable !== "string"
    || receipt.exactCommand.executable.length === 0
    || !Array.isArray(receipt.exactCommand.argv)
    || !receipt.exactCommand.argv.every((entry) => typeof entry === "string")
    || typeof receipt.exactCommand.cwd !== "string"
    || receipt.exactCommand.cwd.length === 0
    || !hasExactKeys(receipt.verificationContext, ["platform", "architecture", "runtime"])
    || !Object.values(receipt.verificationContext).every((entry) => typeof entry === "string" && entry.length > 0)
    || !validDateTime(receipt.startedAt)
    || !validDateTime(receipt.finishedAt)
    || Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)
    || !hasExactKeys(receipt.exitResult, ["exitCode", "signal"])
    || !(receipt.exitResult.exitCode === null || Number.isInteger(receipt.exitResult.exitCode))
    || !(receipt.exitResult.signal === null || typeof receipt.exitResult.signal === "string")
    || !hasExactKeys(receipt.outputArtifacts, ["stdout", "stderr"])
    || !validOutputArtifact(receipt.outputArtifacts.stdout)
    || !validOutputArtifact(receipt.outputArtifacts.stderr)
    || !(receiptV4
      ? V4_MUTATION_DECISIONS.has(receipt.mutationDecision)
      : receiptV3
      ? V3_MUTATION_DECISIONS.has(receipt.mutationDecision)
      : ["source_unchanged", "invalidated_by_command_source_mutation"].includes(receipt.mutationDecision))
    || !Array.isArray(receipt.issueCodes)
    || new Set(receipt.issueCodes).size !== receipt.issueCodes.length
    || !receipt.issueCodes.every((entry) => typeof entry === "string"
      && (receiptV4 ? V4_RECEIPT_ISSUES : receiptV3 ? V3_RECEIPT_ISSUES : KNOWN_RECEIPT_ISSUES).has(entry))
  ) {
    return false;
  }
  if (receiptV2 && (
    !hasExactKeys(receipt.inputArtifacts, ["stdin"])
    || !validOutputArtifact(receipt.inputArtifacts.stdin)
  )) {
    return false;
  }
  if (receiptV3 && (
    typeof receipt.sourceWorkspaceRoot !== "string"
    || receipt.sourceWorkspaceRoot.length === 0
    || !validMutationClasses(receipt.mutationClasses)
    || !validExecutionIsolation(receipt.executionIsolation, receipt)
    || receipt.inputArtifacts !== undefined
      && (!hasExactKeys(receipt.inputArtifacts, ["stdin"])
        || !validOutputArtifact(receipt.inputArtifacts.stdin))
    || !validV3MutationTruth(receipt)
  )) {
    return false;
  }
  if (receiptV4 && (
    typeof receipt.controllerWorkspaceRoot !== "string"
    || receipt.controllerWorkspaceRoot.length === 0
    || typeof receipt.sourceWorkspaceRoot !== "string"
    || receipt.sourceWorkspaceRoot.length === 0
    || receipt.controllerWorkspaceRoot === receipt.sourceWorkspaceRoot
    || !validForeignMutationClasses(receipt.mutationClasses)
    || !validExecutionIsolation(receipt.executionIsolation, receipt)
    || !validForeignWorkspace(receipt.foreignWorkspace, receipt.sourceWorkspaceRoot)
    || receipt.inputArtifacts !== undefined
      && (!hasExactKeys(receipt.inputArtifacts, ["stdin"])
        || !validOutputArtifact(receipt.inputArtifacts.stdin))
    || !validV4MutationTruth(receipt)
  )) {
    return false;
  }
  if (receipt.signatureRef !== undefined) {
    if (!hasExactKeys(receipt.signatureRef, ["path", "sha256"])
      || typeof receipt.signatureRef.path !== "string"
      || !isSha256Ref(receipt.signatureRef.sha256)) {
      return false;
    }
  }
  return true;
}
