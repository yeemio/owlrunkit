import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  CORE_VERSION,
  initializeProjectRunKit,
  inspectProjectUpgradeSafety,
} from "./core-contract.mjs";
import { inspectInstalledSkillCompatibility } from "./install-codex-skill.mjs";
import {
  readAdoptionReadiness,
  readLocalInstallBinding,
  readRegistryExact,
  resolveBoundedWorkspaceRoot,
  runDoctor,
} from "./onboarding-doctor.mjs";
import {
  detectProfilesV3,
  reconcileProfilesV2,
  validateProfiles,
} from "./profile-onboarding.mjs";
import { sha256Canonical } from "./quick-canonical.mjs";
import { runRegistryAdoption } from "./registry-adoption.mjs";
import { OFFICIAL_NPM_REGISTRY } from "./registry-adoption-gate.mjs";
import { writeJsonExclusiveAtomically } from "./provenance-common.mjs";

const PACKAGE_NAME = "owlrunkit";
const EXACT_SPEC = `${PACKAGE_NAME}@${CORE_VERSION}`;
const RUNTIME_RELATIVE = path.join(".owlcoda", "runkit");
const TRANSACTION_PATHS = Object.freeze([
  "config.json",
  "profiles.json",
  "config-migration-receipts",
  "profile-apply-receipts",
  "profile-reconcile-receipts",
  "adoption",
]);

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function requestedSuccessorSpec(value) {
  return /^owlrunkit@[0-9]+\.[0-9]+\.[0-9]+$/u.test(value ?? "")
    ? value
    : null;
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

function captureEntry(filePath) {
  if (!pathEntryExists(filePath)) return { kind: "missing" };
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error("bootstrap_transaction_symlink_rejected");
  if (stat.isFile()) {
    if (realpathSync(filePath) !== path.resolve(filePath)) {
      throw new Error("bootstrap_transaction_file_alias_rejected");
    }
    return {
      kind: "file",
      bytes: readFileSync(filePath),
    };
  }
  if (!stat.isDirectory() || realpathSync(filePath) !== path.resolve(filePath)) {
    throw new Error("bootstrap_transaction_entry_invalid");
  }
  return {
    kind: "directory",
    entries: readdirSync(filePath)
      .sort()
      .map(name => ({
        name,
        snapshot: captureEntry(path.join(filePath, name)),
      })),
  };
}

function restoreEntry(filePath, snapshot) {
  rmSync(filePath, { recursive: true, force: true });
  if (snapshot.kind === "missing") return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (snapshot.kind === "file") {
    writeFileSync(filePath, snapshot.bytes, { flag: "wx" });
    return;
  }
  mkdirSync(filePath);
  for (const entry of snapshot.entries) {
    restoreEntry(path.join(filePath, entry.name), entry.snapshot);
  }
}

function captureTransactionPreimage(root) {
  const owlcodaRoot = path.join(root, ".owlcoda");
  const runtimeRoot = path.join(root, RUNTIME_RELATIVE);
  return {
    owlcodaExisted: pathEntryExists(owlcodaRoot),
    runtimeExisted: pathEntryExists(runtimeRoot),
    executionsExisted: pathEntryExists(path.join(runtimeRoot, "executions")),
    entries: TRANSACTION_PATHS.map(relativePath => ({
      relativePath,
      snapshot: captureEntry(path.join(runtimeRoot, relativePath)),
    })),
  };
}

function rollbackTransaction(root, preimage) {
  const runtimeRoot = path.join(root, RUNTIME_RELATIVE);
  const restoredPaths = [];
  for (const entry of preimage.entries) {
    restoreEntry(path.join(runtimeRoot, entry.relativePath), entry.snapshot);
    restoredPaths.push(path.posix.join(".owlcoda/runkit", entry.relativePath));
  }
  const executionsRoot = path.join(runtimeRoot, "executions");
  if (!preimage.executionsExisted && existsSync(executionsRoot)) {
    if (readdirSync(executionsRoot).length !== 0) {
      throw new Error("bootstrap_rollback_unexpected_execution_state");
    }
    rmSync(executionsRoot, { recursive: true });
    restoredPaths.push(".owlcoda/runkit/executions");
  }
  return restoredPaths.sort();
}

function ensureBootstrapLock(root) {
  const owlcodaRoot = path.join(root, ".owlcoda");
  if (!existsSync(owlcodaRoot)) mkdirSync(owlcodaRoot);
  const owlcodaStat = lstatSync(owlcodaRoot);
  if (
    owlcodaStat.isSymbolicLink()
    || !owlcodaStat.isDirectory()
    || realpathSync(owlcodaRoot) !== owlcodaRoot
  ) {
    throw new Error("bootstrap_control_directory_untrusted");
  }
  const lockPath = path.join(owlcodaRoot, ".runkit-bootstrap.lock");
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("bootstrap_transaction_active");
    throw error;
  }
  return () => rmSync(lockPath, { recursive: true, force: true });
}

function trustedDirectory(directory, issueCode) {
  const stat = lstatSync(directory);
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || realpathSync(directory) !== path.resolve(directory)
  ) {
    throw new Error(issueCode);
  }
}

function acquireProjectControlLock(root) {
  const runtimeRoot = path.join(root, RUNTIME_RELATIVE);
  const executionsRoot = path.join(runtimeRoot, "executions");
  const runtimeExisted = existsSync(runtimeRoot);
  const executionsExisted = existsSync(executionsRoot);
  try {
    if (!runtimeExisted) mkdirSync(runtimeRoot);
    trustedDirectory(runtimeRoot, "bootstrap_runtime_directory_untrusted");
    if (!executionsExisted) mkdirSync(executionsRoot);
    trustedDirectory(executionsRoot, "bootstrap_executions_directory_untrusted");
    const lockPath = path.join(runtimeRoot, "control.lock");
    try {
      mkdirSync(lockPath);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("bootstrap_project_control_transaction_active");
      }
      throw error;
    }
    return {
      runtimeExisted,
      executionsExisted,
      release() {
        rmSync(lockPath, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (!executionsExisted && existsSync(executionsRoot)) {
      try {
        if (readdirSync(executionsRoot).length === 0) {
          rmSync(executionsRoot, { recursive: true });
        }
      } catch {
        // The original acquisition failure remains the governing error.
      }
    }
    if (!runtimeExisted && existsSync(runtimeRoot)) {
      try {
        if (readdirSync(runtimeRoot).length === 0) {
          rmSync(runtimeRoot, { recursive: true });
        }
      } catch {
        // The original acquisition failure remains the governing error.
      }
    }
    throw error;
  }
}

function registryMatchesLocal(registry, local) {
  return registry.status === "registry_verified"
    && local.status === "bound"
    && registry.packageName === PACKAGE_NAME
    && registry.version === CORE_VERSION
    && registry.integrity === local.integrity
    && registry.tarballUrl === local.resolved;
}

function profilePlan(root, projectToolResolver) {
  const profilesPath = path.join(root, RUNTIME_RELATIVE, "profiles.json");
  if (!existsSync(profilesPath)) {
    const detection = detectProfilesV3({
      workspaceRoot: root,
      projectToolResolver,
    });
    return {
      status: detection.applyStatus === "ready_to_apply"
        ? "ready"
        : "blocked",
      action: "detect_then_reconcile",
      issueCodes: detection.issueCodes,
      evidenceRef: detection.detectionSha256,
    };
  }
  const reconcile = reconcileProfilesV2({
    workspaceRoot: root,
    projectToolResolver,
  });
  return {
    status: new Set([
      "profiles_already_current",
      "profiles_reconcile_ready",
    ]).has(reconcile.status)
      ? "ready"
      : "blocked",
    action: reconcile.status === "profiles_already_current"
      ? "validate_current"
      : "reconcile",
    issueCodes: reconcile.issueCodes ?? [],
    evidenceRef: reconcile.reconcileSha256 ?? null,
  };
}

async function registryEvidence(registryClient) {
  return registryClient
    ? registryClient.readExact({
        registry: OFFICIAL_NPM_REGISTRY,
        packageName: PACKAGE_NAME,
        version: CORE_VERSION,
      })
    : readRegistryExact({
        registryUrl: OFFICIAL_NPM_REGISTRY,
        packageName: PACKAGE_NAME,
        version: CORE_VERSION,
      });
}

function normalizeSharedSkill(inspectedSkill) {
  const sourceStatus = inspectedSkill.status;
  const status = new Set(["valid", "version_mismatch"]).has(sourceStatus)
    ? sourceStatus
    : "invalid";
  const fallbackIssue = {
    missing: "installed_skill_missing",
    unmanaged: "installed_skill_unmanaged",
    drifted: "installed_skill_drifted",
  }[sourceStatus] ?? "installed_skill_invalid";
  return {
    status,
    blocking: false,
    issueCodes: [...new Set([
      ...(inspectedSkill.issues ?? []),
      ...(status === "invalid" ? [fallbackIssue] : []),
    ])].sort(),
    nextCommand: status === "valid"
      ? null
      : "run the explicit fleet-safe Skill installer after reviewing active executions and leases",
  };
}

export async function planOnboardingBootstrapV1({
  workspaceRoot,
  exactSpec,
  registryClient,
  projectToolResolver,
  skillRoot,
  skillInspector = inspectInstalledSkillCompatibility,
} = {}) {
  const root = resolveBoundedWorkspaceRoot(workspaceRoot);
  const issueCodes = [];
  const requestedSuccessor = requestedSuccessorSpec(exactSpec);
  if (exactSpec !== EXACT_SPEC) issueCodes.push("bootstrap_exact_spec_required");
  const local = readLocalInstallBinding({ workspaceRoot: root });
  if (local.status !== "bound") {
    issueCodes.push(...(local.issueCodes ?? ["registry_install_binding_mismatch"]));
  }
  const registry = await registryEvidence(registryClient);
  if (registry.status !== "registry_verified") {
    issueCodes.push(...(registry.issueCodes ?? ["registry_release_not_verified"]));
  } else if (!registryMatchesLocal(registry, local)) {
    issueCodes.push("registry_install_binding_mismatch");
  }
  const configExists = existsSync(path.join(root, RUNTIME_RELATIVE, "config.json"));
  const upgradeSafety = configExists
    ? inspectProjectUpgradeSafety({ workspaceRoot: root })
    : { status: "safe", issues: [] };
  if (upgradeSafety.status !== "safe") {
    issueCodes.push(...(upgradeSafety.issues ?? ["bootstrap_project_upgrade_unsafe"]));
  }
  const profiles = profilePlan(root, projectToolResolver);
  if (profiles.status !== "ready") issueCodes.push(...profiles.issueCodes);
  let adoption = { status: "missing" };
  try {
    adoption = readAdoptionReadiness({ workspaceRoot: root });
  } catch {
    adoption = { status: "missing" };
  }
  let sharedSkill;
  if (skillRoot === undefined) {
    sharedSkill = {
      status: "not_checked",
      blocking: false,
      issueCodes: [],
      nextCommand: "rerun bootstrap with --skill-root <installed-skill-directory>",
    };
  } else {
    const inspectedSkill = await skillInspector({ targetRoot: skillRoot });
    sharedSkill = normalizeSharedSkill(inspectedSkill);
  }
  const steps = [
    { id: "exact_package_binding", action: "verify", writes: 0 },
    { id: "initialize_core", action: configExists ? "verify_or_upgrade" : "initialize", writes: 1 },
    { id: "reconcile_profiles", action: profiles.action, writes: 1 },
    { id: "validate_profiles", action: "validate", writes: 0 },
    { id: "adopt_registry_release", action: adoption.status === "ok" ? "verify_current" : "adopt", writes: 1 },
    { id: "doctor", action: "read_back", writes: 0 },
  ];
  const body = {
    schemaVersion: "OwlCodaRunKitOnboardingBootstrapPlanV1",
    status: issueCodes.length === 0 ? "bootstrap_ready" : "bootstrap_blocked",
    exitCode: issueCodes.length === 0 ? 0 : 2,
    dryRun: true,
    writesPerformed: 0,
    workspaceRoot: root,
    exactSpec: EXACT_SPEC,
    localBinding: local.status === "bound"
      ? {
          status: "bound",
          version: local.version,
          resolved: local.resolved,
          integrity: local.integrity,
        }
      : { status: local.status },
    registry: registry.status === "registry_verified"
      ? {
          status: "verified",
          version: registry.version,
          shasum: registry.shasum,
          integrity: registry.integrity,
          tarballUrl: registry.tarballUrl,
        }
      : {
          status: registry.status,
          issueCodes: registry.issueCodes ?? [],
        },
    upgradeSafety: upgradeSafety.status,
    profiles,
    sharedSkill,
    steps,
    estimatedAdditionalSteps: steps.length,
    estimatedEvidenceObjects: 3,
    rollbackScope: TRANSACTION_PATHS.map(value => path.posix.join(".owlcoda/runkit", value)),
    issueCodes: [...new Set(issueCodes)].sort(),
    nextCommand: issueCodes.length === 0
      ? `npx --no-install owlrunkit bootstrap --workspace ${JSON.stringify(root)} --exact ${EXACT_SPEC} --apply`
      : issueCodes.includes("bootstrap_exact_spec_required") && requestedSuccessor !== null
        ? `cd ${shellQuote(root)} && npm install --save-exact ${requestedSuccessor} && npx --no-install owlrunkit bootstrap --workspace ${shellQuote(root)} --exact ${requestedSuccessor} --dry-run`
      : "repair bootstrap preflight issues and rerun --dry-run",
    authorizationGranted: false,
  };
  return {
    ...body,
    planSha256: sha256Canonical(body),
  };
}

function stepFailure(stepId, result) {
  const issues = result?.issueCodes ?? result?.issues ?? [];
  const suffix = issues.length > 0 ? `:${issues.join(",")}` : "";
  return new Error(`bootstrap_step_failed:${stepId}${suffix}`);
}

function writeBootstrapReceipt(root, receipt) {
  const relativePath = path.posix.join(
    ".owlcoda/runkit/bootstrap-receipts",
    `${receipt.bootstrapId}.json`,
  );
  writeJsonExclusiveAtomically(path.join(root, relativePath), receipt);
  return relativePath;
}

function blockedBootstrapApply(plan, issueCode) {
  return {
    ...plan,
    status: "bootstrap_blocked",
    exitCode: 2,
    writesPerformed: 0,
    issueCodes: [...new Set([...plan.issueCodes, issueCode])].sort(),
    nextCommand: issueCode === "bootstrap_transaction_active"
      ? "wait for the active bootstrap transaction to finish, then rerun --dry-run"
      : "rerun --dry-run against the current project state",
    authorizationGranted: false,
  };
}

export async function applyOnboardingBootstrapV1({
  workspaceRoot,
  exactSpec,
  registryClient,
  projectToolResolver,
  skillRoot,
  skillInspector,
  onAfterStep,
} = {}) {
  const root = resolveBoundedWorkspaceRoot(workspaceRoot);
  const plan = await planOnboardingBootstrapV1({
    workspaceRoot: root,
    exactSpec,
    registryClient,
    projectToolResolver,
    skillRoot,
    skillInspector,
  });
  if (plan.status !== "bootstrap_ready") return plan;

  const bootstrapId = `bootstrap-${randomUUID()}`;
  const owlcodaRoot = path.join(root, ".owlcoda");
  const owlcodaExistedBefore = existsSync(owlcodaRoot);
  let releaseLock = null;
  let projectControl = null;
  try {
    releaseLock = ensureBootstrapLock(root);
    projectControl = acquireProjectControlLock(root);
  } catch (error) {
    releaseLock?.();
    if (
      !owlcodaExistedBefore
      && existsSync(owlcodaRoot)
      && readdirSync(owlcodaRoot).length === 0
    ) {
      rmSync(owlcodaRoot, { recursive: true });
    }
    const issueCode = error instanceof Error ? error.message : String(error);
    return blockedBootstrapApply(plan, issueCode);
  }
  const releaseEarly = () => {
    const acquiredControl = projectControl;
    acquiredControl?.release();
    projectControl = null;
    const runtimeRoot = path.join(root, RUNTIME_RELATIVE);
    const executionsRoot = path.join(runtimeRoot, "executions");
    if (
      !acquiredControl?.executionsExisted
      && existsSync(executionsRoot)
      && readdirSync(executionsRoot).length === 0
    ) {
      rmSync(executionsRoot, { recursive: true });
    }
    if (
      !acquiredControl?.runtimeExisted
      && existsSync(runtimeRoot)
      && readdirSync(runtimeRoot).length === 0
    ) {
      rmSync(runtimeRoot, { recursive: true });
    }
    releaseLock?.();
    releaseLock = null;
    if (
      !owlcodaExistedBefore
      && existsSync(owlcodaRoot)
      && readdirSync(owlcodaRoot).length === 0
    ) {
      rmSync(owlcodaRoot, { recursive: true });
    }
  };
  let lockedPlan;
  try {
    lockedPlan = await planOnboardingBootstrapV1({
      workspaceRoot: root,
      exactSpec,
      registryClient,
      projectToolResolver,
      skillRoot,
      skillInspector,
    });
  } catch (error) {
    releaseEarly();
    throw error;
  }
  if (lockedPlan.planSha256 !== plan.planSha256) {
    releaseEarly();
    return blockedBootstrapApply(lockedPlan, "bootstrap_preflight_drift");
  }
  let preimage;
  try {
    preimage = captureTransactionPreimage(root);
    preimage.executionsExisted = projectControl.executionsExisted;
  } catch (error) {
    releaseEarly();
    return blockedBootstrapApply(
      lockedPlan,
      error instanceof Error ? error.message : String(error),
    );
  }
  let failedStep = null;
  const completedSteps = [];
  const startedAt = new Date().toISOString();
  try {
    const runStep = async (stepId, operation, validStatuses) => {
      failedStep = stepId;
      const result = await operation();
      if (!validStatuses.has(result.status)) throw stepFailure(stepId, result);
      completedSteps.push({ id: stepId, status: result.status });
      await onAfterStep?.(stepId, result);
      return result;
    };

    await runStep(
      "initialize_core",
      () => initializeProjectRunKit({ workspaceRoot: root }),
      new Set(["initialized", "upgraded"]),
    );
    const reconciled = await runStep(
      "reconcile_profiles",
      () => reconcileProfilesV2({
        workspaceRoot: root,
        apply: true,
        projectToolResolver,
      }),
      new Set(["profiles_already_current", "profiles_reconciled"]),
    );
    await runStep(
      "validate_profiles",
      () => validateProfiles({ workspaceRoot: root }),
      new Set(["valid"]),
    );
    let adoption = readAdoptionReadiness({ workspaceRoot: root });
    if (adoption.status !== "ok") {
      adoption = await runStep(
        "adopt_registry_release",
        () => runRegistryAdoption({
          workspaceRoot: root,
          exactSpec,
          registryClient,
        }),
        new Set(["adopted"]),
      );
    } else {
      completedSteps.push({ id: "adopt_registry_release", status: "already_current" });
      await onAfterStep?.("adopt_registry_release", adoption);
    }
    const doctor = await runStep(
      "doctor",
      () => runDoctor({
        workspaceRoot: root,
        discoverSharedSkill: true,
        registryUrl: OFFICIAL_NPM_REGISTRY,
        registryClient,
      }),
      new Set(["ready"]),
    );
    failedStep = null;
    const receipt = {
      schemaVersion: "OwlCodaRunKitOnboardingBootstrapReceiptV1",
      status: "bootstrapped",
      exitCode: 0,
      bootstrapId,
      planSha256: plan.planSha256,
      exactSpec: EXACT_SPEC,
      startedAt,
      completedAt: new Date().toISOString(),
      completedSteps,
      profileStatus: reconciled.status,
      adoptionStatus: adoption.status,
      doctorStatus: doctor.status,
      rollbackPerformed: false,
      rollbackOutcome: "not_required",
      authorizationGranted: false,
    };
    const receiptPath = writeBootstrapReceipt(root, receipt);
    return {
      ...receipt,
      receiptPath,
      nextAllowedAction: "plan_project_work",
    };
  } catch (error) {
    let rollbackOutcome = "restored";
    let restoredPaths = [];
    let rollbackIssue = null;
    try {
      restoredPaths = rollbackTransaction(root, preimage);
    } catch (rollbackError) {
      rollbackOutcome = "failed";
      rollbackIssue = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
    }
    const receipt = {
      schemaVersion: "OwlCodaRunKitOnboardingBootstrapReceiptV1",
      status: "bootstrap_failed",
      exitCode: 2,
      bootstrapId,
      planSha256: plan.planSha256,
      exactSpec: EXACT_SPEC,
      startedAt,
      completedAt: new Date().toISOString(),
      completedSteps,
      failedStep,
      issueCodes: [
        error instanceof Error ? error.message : String(error),
        ...(rollbackIssue === null ? [] : [rollbackIssue]),
      ],
      rollbackPerformed: true,
      rollbackOutcome,
      restoredPaths,
      authorizationGranted: false,
    };
    let receiptPath = null;
    try {
      receiptPath = writeBootstrapReceipt(root, receipt);
    } catch (receiptError) {
      receipt.issueCodes.push(
        `bootstrap_failure_receipt_write_failed:${receiptError instanceof Error ? receiptError.message : String(receiptError)}`,
      );
    }
    return {
      ...receipt,
      receiptPath,
      nextAllowedAction: rollbackOutcome === "restored"
        ? "repair_failed_step_and_retry_bootstrap"
        : "recover_bootstrap_transaction",
    };
  } finally {
    projectControl?.release();
    releaseLock?.();
  }
}

export function formatOnboardingBootstrapHumanV1(result) {
  if (result.status === "bootstrap_ready") {
    return [
      `Bootstrap ready for ${result.exactSpec}.`,
      `Profiles: ${result.profiles.action}; shared Skill: ${result.sharedSkill.status}.`,
      `Expected steps: ${result.estimatedAdditionalSteps}; evidence objects: ${result.estimatedEvidenceObjects}.`,
      `Next: ${result.nextCommand}`,
      "Git, release, deployment, production, and business authority remain false.",
      "",
    ].join("\n");
  }
  if (result.status === "bootstrapped") {
    return [
      `Bootstrapped ${result.exactSpec}; doctor is ${result.doctorStatus}.`,
      `Receipt: ${result.receiptPath}`,
      "Git, release, deployment, production, and business authority remain false.",
      "",
    ].join("\n");
  }
  const issues = result.issueCodes?.join(", ") || "unknown issue";
  return [
    `Bootstrap blocked: ${issues}`,
    ...(result.nextCommand ? [`Repair: ${result.nextCommand}`] : []),
    `Rollback: ${result.rollbackOutcome ?? "not_required"}.`,
    ...(result.receiptPath ? [`Receipt: ${result.receiptPath}`] : []),
    "No Git, release, deployment, production, or business authority was granted.",
    "",
  ].join("\n");
}
