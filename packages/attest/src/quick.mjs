import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  isPlainJsonObject,
  decodeUtf8Strict,
  parseJsonStrict,
  readFileBytesBounded,
  resolveRegularFilePath,
  sha256Bytes,
} from "./formal.mjs";
import {
  quickSnapshotFingerprintValid,
  validQuickReceiptShape,
} from "./quick-receipt-contract.mjs";
import { captureDependencyEnvironment } from "./dependency-environment.mjs";
import { captureWorkspaceSnapshot } from "./workspace-snapshot.mjs";
import {
  captureCanonicalCandidateIdentityV1,
  captureForeignWorkspaceFilesystemIdentityV1,
} from "./candidate-identity.mjs";

export { validQuickReceiptShape } from "./quick-receipt-contract.mjs";

export const SUPPORTED_QUICK_CORE_IDENTITIES = Object.freeze([
  {
    contractVersion: "0.2",
    coreVersion: "0.23.0",
    coreManifestSha256: "sha256:cf9c1c5985cd0e960640f13fba66f92f0135449b6bc5036bc68ee9021053b9e4",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.22.1",
    coreManifestSha256: "sha256:41447517f78b74a070802bd67c8b066a833eedde72e2606e3127fa1258c289a4",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.22.0",
    coreManifestSha256: "sha256:e79d2123d88ada0e2e31f62fabee83b1d661ca02e93a383691a502f721ae1e7e",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.21.1",
    coreManifestSha256: "sha256:ff9e3756d6f385f1843d842c29baa6525101a84f3273148ad6b00f1187078c6e",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.21.0",
    coreManifestSha256: "sha256:f85b9bf8c32705d5f5dfebdb653e83ac8d1ac0468214c17f230cbd2de04246fd",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.20.1",
    coreManifestSha256: "sha256:8af2b9792731efa37f596255a7677dcec6e2fd3cc079dfdb0e6ff29e8017e784",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.20.0",
    coreManifestSha256: "sha256:30098aa9344c17c1ed0b5ed45ef1c590b3214b824402f584029c1ecb38ca7a70",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.19.2",
    coreManifestSha256: "sha256:c46ae9d8ed0572e5636ab5725f922f8db3ee5bf0f966b200bce7b2287c9267c8",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.19.1",
    coreManifestSha256: "sha256:291ef97c93a513eed24a29f75c400b61cefd6a8c0ab228401cf2c6a73ea9e622",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.19.0",
    coreManifestSha256: "sha256:803fb7de76a6ccffd1ec5e0164eeff15a580209fa6dfbef9e561345ab616b403",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.18.4",
    coreManifestSha256: "sha256:372d4c247e4b40b0fd2f3fe0f5bf928548095bfb7e2e92e9ac66790e2717f77d",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.18.3",
    coreManifestSha256: "sha256:cc7a923649592084150828f24f0d90f280af92514bafdbc4999f4015b3175d5c",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.18.2",
    coreManifestSha256: "sha256:abe17ff794b4019d8d476f09eb5d4105bae1070b1df0aab53e6c94c7ec8b65a6",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.18.1",
    coreManifestSha256: "sha256:349b4157d3d089462b172de1619ccd169b5c1669b9322e2580ac6ec4f8616b07",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.18.0",
    coreManifestSha256: "sha256:72c481dbafe06a9c56cd940d74a3fe109a82b73a3c43d0bb54923ea6c584c04e",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.17.2",
    coreManifestSha256: "sha256:67b883b8a763253b873fb6047c7e7e01c81123aa5250a0db5feaabd13cc4d860",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.17.1",
    coreManifestSha256: "sha256:5376f3736dd17c07598df8b655a6bbceb3b64b44f3e6630e69f966e420d82e26",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.17.0",
    coreManifestSha256: "sha256:0c0c52e7f6299bdd3d3ea49005c8ceef0b28831d60af25d77da65a4e4de714c9",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.16.1",
    coreManifestSha256: "sha256:38ac9110e328c38a81db05f1359734ca810b991c9f4de77647f9719f5e6af78b",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.16.0",
    coreManifestSha256: "sha256:320fb1d97b4459d1a14b0b67807dcf2bc6b03970492cb9fb2c6245b17912c81e",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.15.1",
    coreManifestSha256: "sha256:e8ca57522a8e473da356ceb3768bb650267894638d450d5e49463ab6f51c752b",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.15.0",
    coreManifestSha256: "sha256:06d7616c369b4b3ece3aca32f05c505d4b30781d3ca87a13bd8d7293c1491f64",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.14.0",
    coreManifestSha256: "sha256:d3b498562bebb2fa180d6861cb834ce3551288bf499ce0d769ee6c64b2663231",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.12.0",
    coreManifestSha256: "sha256:c415b10cb00d2a7891744b7257774fa501ddf40f8ec2f290356505a17fefb40f",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.12.0",
    coreManifestSha256: "sha256:be4b079fb0bc29e71858af03a1e579f864d4414c815ac612c3b514d8d663d07b",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.13.0",
    coreManifestSha256: "sha256:0e3233a417365afb4e2ce22db5260608a9c697a819cd5c02897276d6454dde1f",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.13.0",
    coreManifestSha256: "sha256:037c012751b32abbbb48ce8a8d2cd8faa4fc2c38d6797db391205477e667065f",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.13.0",
    coreManifestSha256: "sha256:2f840d1884b34656902f8f23af3bd8052dde3212aa516dac2cbb0e0b29627ea1",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.13.0",
    coreManifestSha256: "sha256:febf2551317fce9e4bb412b833a392a20376d702dda09c57d6116e8a3ca4f857",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.13.0",
    coreManifestSha256: "sha256:4b72f572b6964f149c4a6fe5c2c9da85f73b8060c88023dc96ba5ca50a036972",
  },
  {
    contractVersion: "0.2",
    coreVersion: "0.13.0",
    coreManifestSha256: "sha256:0455c847bf2df77703583c6f19c20cf103206bafc4f122795bf34d3f85f0263d",
  },
].map(identity => Object.freeze(identity)));

function dependencyEnvironmentCurrent(binding, materials) {
  if (binding === null || binding === undefined) return true;
  try {
    const current = captureDependencyEnvironment(binding.root);
    if (current.root !== binding.root || current.fingerprint !== binding.fingerprint) return false;
    for (const material of current.materials) {
      materials.push({
        path: resolveBoundMaterial(current.root, material.path),
        sha256: material.sha256,
      });
    }
    return true;
  } catch {
    return false;
  }
}

function resolveBoundMaterial(root, relativePath) {
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("material path must be workspace-relative");
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("material path contains unsafe segments");
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("material path traverses a symlink");
  }
  const resolved = realpathSync(current);
  const remainder = path.relative(root, resolved);
  if (remainder === "" || remainder === ".." || remainder.startsWith(`..${path.sep}`) || path.isAbsolute(remainder)) {
    throw new Error("material path escapes the workspace");
  }
  if (!statSync(resolved).isFile()) throw new Error("material must be a regular file");
  return resolved;
}

function check(status, issueCode) {
  return issueCode === undefined ? { status } : { status, issueCode };
}

function resultTemplate({ receipt, receiptPath, receiptSha256, decision, issues, checks, materials }) {
  return {
    schemaVersion: "OwlCodaAttestationResultV1",
    decision,
    subjectRef: {
      schemaVersion: "OwlCodaAttestationRefV1",
      receiptId: receipt.receiptId,
      receiptSha256,
      coreIdentity: {
        contractVersion: receipt.coreIdentity.contractVersion,
        coreManifestSha256: receipt.coreIdentity.coreManifestSha256,
      },
    },
    verifiedAt: new Date().toISOString(),
    policy: {
      id: "owlcoda-quick-minimum",
      version: "1.0.0",
    },
    checks,
    authorizationBoundary: {
      authorizationGranted: false,
      statement: "attestation_never_grants_repository_or_business_authority",
    },
    issueCodes: [...new Set(issues)].sort(),
    verifiedMaterials: [
      { path: receiptPath, sha256: receiptSha256 },
      ...materials,
    ],
  };
}

function attestQuickReceiptDetailsFromBytesWithCatalog({
  receiptPath,
  receiptBytes,
  workspaceRoot,
}, supportedCoreIdentities) {
  const absoluteReceiptPath = resolveRegularFilePath(receiptPath);
  let receipt;
  try {
    receipt = parseJsonStrict(decodeUtf8Strict(receiptBytes));
  } catch (error) {
    if (error?.code === "DUPLICATE_OBJECT_KEY") {
      error.code = "receipt_duplicate_key";
    }
    throw error;
  }
  if (!isPlainJsonObject(receipt) || !validQuickReceiptShape(receipt)) {
    const error = new Error("Quick receipt does not satisfy a supported strict shape");
    error.code = "receipt_schema_invalid";
    throw error;
  }

  const issues = [
    ...receipt.issueCodes.filter((issue) => issue !== "quick_ignored_artifact_unbound"),
    "signature_absent",
    "anchor_absent",
  ];
  const materials = [];
  let materialMissing = false;
  let materialMismatch = false;

  const coreValid = supportedCoreIdentities.some((core) =>
    receipt.coreIdentity.contractVersion === core.contractVersion
    && receipt.coreIdentity.coreVersion === core.coreVersion
    && receipt.coreIdentity.coreManifestSha256 === core.coreManifestSha256);
  if (!coreValid) issues.push("core_identity_mismatch");
  const contextValid = receipt.verificationContext.platform === process.platform
    && receipt.verificationContext.architecture === process.arch
    && receipt.verificationContext.runtime === process.version;
  if (!contextValid) issues.push("verification_context_mismatch");

  const snapshotBindingsValid = quickSnapshotFingerprintValid(receipt.workspaceBefore)
    && quickSnapshotFingerprintValid(receipt.workspaceAfter);
  const sourceUnchanged = receipt.workspaceBefore.sourceFingerprint
    === receipt.workspaceAfter.sourceFingerprint;
  const receiptSourceValid = receipt.mutationDecision === "source_unchanged"
    ? snapshotBindingsValid && sourceUnchanged && !receipt.issueCodes.includes("source_mutated_during_verification")
    : snapshotBindingsValid && !sourceUnchanged && receipt.issueCodes.includes("source_mutated_during_verification");
  const selectedWorkspaceRoot = workspaceRoot === undefined
    ? undefined
    : realpathSync(workspaceRoot);
  const foreignReceipt = receipt.schemaVersion === "OwlCodaQuickVerificationReceiptV4";
  if (selectedWorkspaceRoot === undefined) {
    issues.push("current_workspace_not_checked");
  }
  let receiptWorkspaceRoot;
  let receiptSourceRoot;
  if (selectedWorkspaceRoot !== undefined) {
    try {
      receiptWorkspaceRoot = realpathSync(foreignReceipt
        ? receipt.controllerWorkspaceRoot
        : receipt.schemaVersion === "OwlCodaQuickVerificationReceiptV3"
          ? receipt.sourceWorkspaceRoot
          : receipt.exactCommand.cwd);
      receiptSourceRoot = realpathSync(foreignReceipt
        ? receipt.sourceWorkspaceRoot
        : receiptWorkspaceRoot);
    } catch {
      receiptWorkspaceRoot = undefined;
      receiptSourceRoot = undefined;
    }
  }
  const commandWorkspaceMatches = selectedWorkspaceRoot !== undefined
    && receiptWorkspaceRoot === selectedWorkspaceRoot;
  if (commandWorkspaceMatches) {
    const boundArtifacts = [
      ...(receipt.inputArtifacts === undefined ? [] : [receipt.inputArtifacts.stdin]),
      receipt.outputArtifacts.stdout,
      receipt.outputArtifacts.stderr,
    ];
    for (const artifact of boundArtifacts) {
      try {
        const materialPath = resolveBoundMaterial(receiptWorkspaceRoot, artifact.path);
        const { bytes } = readFileBytesBounded(materialPath);
        const actualSha256 = sha256Bytes(bytes);
        materials.push({ path: materialPath, sha256: actualSha256 });
        if (actualSha256 !== artifact.sha256 || bytes.byteLength !== artifact.sizeBytes) {
          materialMismatch = true;
        }
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          materialMissing = true;
        } else {
          materialMismatch = true;
        }
      }
    }
  }
  if (materialMissing) issues.push("attestation_material_missing");
  if (materialMismatch) issues.push("receipt_material_hash_mismatch");
  const ignoredPaths = receipt.workspaceAfter.ignoredPathsBound === true
    ? receipt.workspaceAfter.ignoredPathBindings.map(entry => entry.path)
    : [];
  let currentSourceValid = selectedWorkspaceRoot === undefined;
  if (selectedWorkspaceRoot !== undefined && commandWorkspaceMatches && receiptSourceRoot !== undefined) {
    try {
      currentSourceValid = captureWorkspaceSnapshot(receiptSourceRoot, { ignoredPaths }).sourceFingerprint
          === receipt.workspaceAfter.sourceFingerprint;
      if (foreignReceipt) {
        const currentCandidate = captureCanonicalCandidateIdentityV1(receiptSourceRoot);
        const currentFilesystem = captureForeignWorkspaceFilesystemIdentityV1(receiptSourceRoot);
        currentSourceValid = currentSourceValid
          && receipt.foreignWorkspace.zeroWriteObserved === true
          && currentCandidate.candidateFingerprint
            === receipt.foreignWorkspace.candidateAfter.candidateFingerprint
          && currentFilesystem.filesystemFingerprint
            === receipt.foreignWorkspace.filesystemAfter.filesystemFingerprint;
      }
    } catch {
      currentSourceValid = false;
    }
  }
  const dependencyEnvironmentValid = dependencyEnvironmentCurrent(
    receipt.executionIsolation?.dependencyEnvironment,
    materials,
  );
  if (!dependencyEnvironmentValid) issues.push("receipt_dependency_environment_mismatch");
  const sourceValid = receiptSourceValid && currentSourceValid && dependencyEnvironmentValid;
  if (!sourceValid || receipt.mutationDecision !== "source_unchanged") {
    issues.push("receipt_source_mismatch");
  }
  const commandPassed = receipt.exitResult.exitCode === 0 && receipt.exitResult.signal === null;
  if (!commandPassed) issues.push("verification_command_failed");
  const deterministicFailure = !coreValid
    || !contextValid
    || materialMismatch
    || !dependencyEnvironmentValid
    || !sourceValid
    || receipt.mutationDecision !== "source_unchanged"
    || !commandPassed;
  const decision = deterministicFailure
    ? "NO_GO"
    : selectedWorkspaceRoot === undefined || materialMissing
      ? "INDETERMINATE"
      : "GO";
  const receiptSha256 = sha256Bytes(receiptBytes);

  const attestation = resultTemplate({
    receipt,
    receiptPath: absoluteReceiptPath,
    receiptSha256,
    decision,
    issues,
    materials,
    checks: {
      schema: check("passed"),
      canonicalization: check("passed"),
      lineage: check("passed"),
      source: selectedWorkspaceRoot === undefined
        ? check("not_checked", "current_workspace_not_checked")
        : sourceValid && receipt.mutationDecision === "source_unchanged"
          ? check("passed")
          : check("failed", "receipt_source_mismatch"),
      context: !coreValid
        ? check("failed", "core_identity_mismatch")
        : contextValid
          ? check("passed")
          : check("failed", "verification_context_mismatch"),
      signature: check("not_checked", "signature_absent"),
      key: check("not_checked", "signature_absent"),
      anchor: check("not_checked", "anchor_absent"),
    },
  });
  return {
    attestation,
    sourceFingerprint: receipt.workspaceAfter.sourceFingerprint,
    exitCode: decision === "GO"
      ? 0
      : !sourceValid || receipt.mutationDecision !== "source_unchanged"
        ? 2
        : decision === "INDETERMINATE"
          ? 3
          : 1,
  };
}

export function attestQuickReceiptDetailsFromBytes(options) {
  return attestQuickReceiptDetailsFromBytesWithCatalog(
    options,
    SUPPORTED_QUICK_CORE_IDENTITIES,
  );
}

export function attestQuickReceiptDetailsFromBytesWithCoreCatalog(
  options,
  supportedCoreIdentities,
) {
  if (
    !Array.isArray(supportedCoreIdentities)
    || supportedCoreIdentities.length === 0
    || supportedCoreIdentities.some((identity) => (
      identity?.contractVersion !== "0.2"
      || typeof identity?.coreVersion !== "string"
      || !/^sha256:[a-f0-9]{64}$/u.test(identity?.coreManifestSha256 ?? "")
    ))
  ) {
    throw new Error("trusted Quick Core catalog is invalid");
  }
  return attestQuickReceiptDetailsFromBytesWithCatalog(
    options,
    supportedCoreIdentities,
  );
}

export function attestQuickReceiptDetails({ receiptPath, workspaceRoot }) {
  const { absolutePath, bytes } = readFileBytesBounded(receiptPath);
  return attestQuickReceiptDetailsFromBytes({
    receiptPath: absolutePath,
    receiptBytes: bytes,
    workspaceRoot,
  });
}

export function attestQuickReceipt(options) {
  return attestQuickReceiptDetails(options).attestation;
}
