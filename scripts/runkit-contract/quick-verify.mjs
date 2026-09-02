import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  openSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { readFileBytesBounded } from "../../packages/attest/src/formal.mjs";
import { currentCoreIdentity } from "./core-contract.mjs";
import {
  closeQuickOutputFiles,
  createQuickReceiptStore,
  persistQuickInputArtifact,
  persistQuickReceipt,
} from "./quick-receipt.mjs";
import {
  inspectQuickIsolation,
  prepareQuickIsolation,
  removeQuickIsolation,
} from "./quick-isolation.mjs";
import {
  captureWorkspaceSnapshot,
  workspaceSourceStateFingerprint,
} from "./quick-workspace-snapshot.mjs";
import {
  captureCanonicalCandidateIdentityV1,
  captureForeignWorkspaceFilesystemIdentityV1,
} from "../../packages/attest/src/candidate-identity.mjs";
import {
  captureRuntimeTransition,
  runtimeReportPath,
} from "./runtime-transition.mjs";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function quickAttestCommand(workspaceRoot, receiptPath) {
  return `npx --no-install owlrunkit quick-attest --workspace ${shellQuote(workspaceRoot)} --receipt ${shellQuote(receiptPath)}`;
}

function runExactCommand({ executable, argv, cwd, stdinPath, stdoutFd, stderrFd, env }) {
  return new Promise((resolve) => {
    let settled = false;
    let stdinFd;
    let child;
    try {
      stdinFd = stdinPath === undefined
        ? undefined
        : openSync(stdinPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      child = spawn(executable, argv, {
        cwd,
        shell: false,
        stdio: [stdinFd ?? "ignore", stdoutFd, stderrFd],
        env: env ?? process.env,
      });
    } catch (error) {
      if (stdinFd !== undefined) closeSync(stdinFd);
      resolve({
        exitCode: null,
        signal: null,
        launchError: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (stdinFd !== undefined) closeSync(stdinFd);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: null, signal: null, launchError: error.message });
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, signal, launchError: null });
    });
  });
}

function inputArtifactResult(stdinArtifact) {
  return stdinArtifact === null
    ? {}
    : { inputArtifacts: { stdin: stdinArtifact } };
}

function mutationTruth({
  workspaceBefore,
  workspaceAfter,
  isolationResult,
  cleanupStatus,
  foreignWorkspace = null,
}) {
  const workspaceSourceChanged = workspaceSourceStateFingerprint(workspaceBefore)
    !== workspaceSourceStateFingerprint(workspaceAfter);
  const boundIgnoredChanged = workspaceBefore.ignoredPathsBound === true
    && workspaceBefore.ignoredPathsFingerprint !== workspaceAfter.ignoredPathsFingerprint;
  const dependencyChanged = isolationResult?.dependencyChanged === true;
  const consumerSourceChanged = (isolationResult?.consumerDelta.sourcePaths.length ?? 0) > 0;
  const cleanupFailed = cleanupStatus === "cleanup_failed";
  const foreignChanged = foreignWorkspace !== null
    && foreignWorkspace.zeroWriteObserved !== true;
  const issueCodes = [
    ...(workspaceSourceChanged ? ["source_mutated_during_verification"] : []),
    ...(boundIgnoredChanged ? ["bound_ignored_path_mutated_during_verification"] : []),
    ...(dependencyChanged ? ["dependency_environment_mutated_during_verification"] : []),
    ...(consumerSourceChanged ? ["consumer_source_mutated_during_verification"] : []),
    ...(cleanupFailed ? ["quick_isolation_cleanup_failed"] : []),
    ...(foreignChanged ? ["foreign_workspace_mutated_during_verification"] : []),
  ];
  const decisions = [
    ...(workspaceSourceChanged ? ["invalidated_by_command_source_mutation"] : []),
    ...(boundIgnoredChanged ? ["invalidated_by_bound_ignored_mutation"] : []),
    ...(dependencyChanged ? ["invalidated_by_dependency_environment_mutation"] : []),
    ...(consumerSourceChanged ? ["invalidated_by_consumer_source_mutation"] : []),
    ...(cleanupFailed ? ["invalidated_by_isolation_cleanup_failure"] : []),
    ...(foreignChanged ? ["invalidated_by_foreign_workspace_mutation"] : []),
  ];
  return {
    mutationDecision: decisions.length === 0
      ? "source_unchanged"
      : decisions.length === 1
        ? decisions[0]
        : "invalidated_by_multiple_mutations",
    issueCodes,
    mutationClasses: {
      workspaceSource: workspaceSourceChanged ? "changed" : "unchanged",
      boundIgnoredPaths: workspaceBefore.ignoredPathsBound !== true
        ? "not_bound"
        : boundIgnoredChanged ? "changed" : "unchanged",
      dependencyEnvironment: isolationResult?.dependencyEnvironmentAfter === null
        || isolationResult?.dependencyEnvironmentAfter === undefined
        ? "not_bound"
        : dependencyChanged ? "changed" : "unchanged",
      consumerSource: isolationResult === null
        ? "not_isolated"
        : consumerSourceChanged ? "changed" : "unchanged",
      consumerIgnoredArtifacts: (isolationResult?.consumerDelta.ignoredPaths.length ?? 0) > 0
        ? "changed_and_discarded"
        : isolationResult === null ? "not_isolated" : "none",
      ...(foreignWorkspace === null
        ? {}
        : { foreignTarget: foreignChanged ? "changed" : "unchanged" }),
    },
  };
}

function rootsOverlap(left, right) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  return leftToRight === ""
    || rightToLeft === ""
    || (leftToRight !== ".."
      && !leftToRight.startsWith(`..${path.sep}`)
      && !path.isAbsolute(leftToRight))
    || (rightToLeft !== ".."
      && !rightToLeft.startsWith(`..${path.sep}`)
      && !path.isAbsolute(rightToLeft));
}

function isolationReceipt(isolation, isolationResult, cleanupStatus) {
  if (isolation === null) return null;
  return {
    schemaVersion: isolation.schemaVersion,
    mode: "temporary_consumer",
    consumerRoot: isolation.consumerRoot,
    sourceCopy: {
      fileCount: isolation.sourceCopy.fileCount,
      totalBytes: isolation.sourceCopy.totalBytes,
      fingerprint: isolation.sourceCopy.fingerprint,
    },
    cacheEnvironmentVariables: isolation.environment.environmentVariables,
    dependencyEnvironment: isolation.dependencyEnvironment,
    dependencyEnvironmentAfter: isolationResult.dependencyEnvironmentAfter,
    consumerDelta: isolationResult.consumerDelta,
    cleanupStatus,
  };
}

export async function runQuickVerification({
  workspaceRoot,
  foreignWorkspaceRoot,
  commandArgv,
  stdinFile,
  isolate = false,
  dependencyRoot,
  ignoredPaths = [],
  captureRuntime = false,
}) {
  if (!Array.isArray(commandArgv) || commandArgv.length === 0 || !commandArgv.every((value) => typeof value === "string")) {
    return {
      status: "quick_verification_input_invalid",
      exitCode: 3,
      issues: ["An exact command is required after --."],
      authorizationGranted: false,
    };
  }
  let controllerRoot;
  let sourceRoot;
  try {
    controllerRoot = realpathSync(workspaceRoot);
    sourceRoot = foreignWorkspaceRoot === undefined
      ? controllerRoot
      : realpathSync(foreignWorkspaceRoot);
    if (foreignWorkspaceRoot !== undefined && rootsOverlap(controllerRoot, sourceRoot)) {
      throw new Error("Controller and source workspace overlap.");
    }
  } catch {
    return {
      status: "quick_verification_input_invalid",
      exitCode: 3,
      issues: ["Controller or source workspace does not exist or is not safely separated."],
      authorizationGranted: false,
    };
  }
  const foreignMode = foreignWorkspaceRoot !== undefined;
  const effectiveIsolation = isolate === true || foreignMode;
  if (dependencyRoot !== undefined && effectiveIsolation !== true) {
    return {
      status: "quick_verification_input_invalid",
      exitCode: 3,
      issues: ["--dependency-root requires --isolate."],
      authorizationGranted: false,
    };
  }
  if (foreignMode && captureRuntime === true) {
    return {
      status: "quick_verification_input_invalid",
      exitCode: 3,
      issues: ["Foreign Quick does not capture external runtime transitions."],
      authorizationGranted: false,
    };
  }
  if (!Array.isArray(ignoredPaths) || ignoredPaths.some(value => typeof value !== "string")) {
    return {
      status: "quick_verification_input_invalid",
      exitCode: 3,
      issues: ["--bind-ignored must contain literal workspace-relative paths."],
      authorizationGranted: false,
    };
  }

  let stdinBytes;
  if (stdinFile !== undefined) {
    if (typeof stdinFile !== "string" || stdinFile.length === 0) {
      return {
        status: "quick_verification_input_invalid",
        exitCode: 3,
        issues: ["--stdin-file requires a non-empty regular file path."],
        authorizationGranted: false,
      };
    }
    try {
      const selected = path.isAbsolute(stdinFile)
        ? stdinFile
        : path.resolve(sourceRoot, stdinFile);
      stdinBytes = readFileBytesBounded(selected).bytes;
    } catch (error) {
      return {
        status: "quick_verification_input_invalid",
        exitCode: 3,
        issues: [`Quick stdin file is invalid: ${error instanceof Error ? error.message : String(error)}`],
        authorizationGranted: false,
      };
    }
  }

  let workspaceBefore;
  let foreignWorkspaceBefore = null;
  let store;
  let stdinArtifact = null;
  let persistedStdinPath;
  let isolation = null;
  try {
    workspaceBefore = captureWorkspaceSnapshot(sourceRoot, { ignoredPaths });
    if (foreignMode) {
      foreignWorkspaceBefore = {
        candidate: captureCanonicalCandidateIdentityV1(sourceRoot),
        filesystem: captureForeignWorkspaceFilesystemIdentityV1(sourceRoot),
      };
    }
    store = createQuickReceiptStore(controllerRoot);
    if (stdinBytes !== undefined) {
      const persistedInput = persistQuickInputArtifact({
        workspaceRoot: controllerRoot,
        store,
        bytes: stdinBytes,
      });
      stdinArtifact = persistedInput.artifact;
      persistedStdinPath = persistedInput.inputPath;
    }
    if (effectiveIsolation === true) {
      isolation = prepareQuickIsolation({ workspaceRoot: sourceRoot, dependencyRoot });
      const stableSource = captureWorkspaceSnapshot(sourceRoot, { ignoredPaths });
      if (stableSource.sourceFingerprint !== workspaceBefore.sourceFingerprint) {
        throw new Error("Source workspace changed while the temporary consumer was being prepared.");
      }
    }
  } catch (error) {
    if (isolation !== null) removeQuickIsolation(isolation);
    if (store !== undefined) closeQuickOutputFiles(store);
    return {
      status: "quick_verification_input_invalid",
      exitCode: 3,
      issues: [error instanceof Error ? error.message : String(error)],
      authorizationGranted: false,
    };
  }

  const [executable, ...argv] = commandArgv;
  const executionCwd = isolation?.consumerRoot ?? sourceRoot;
  const expectedRuntimeReportPath = captureRuntime
    ? runtimeReportPath(store.receiptRoot)
    : null;
  const executionEnvironment = isolation === null
    ? { ...process.env }
    : { ...process.env, ...isolation.environment.overrides };
  delete executionEnvironment.OWLRUNKIT_RUNTIME_REPORT;
  if (expectedRuntimeReportPath !== null) {
    executionEnvironment.OWLRUNKIT_RUNTIME_REPORT = expectedRuntimeReportPath;
  }
  const startedAt = new Date().toISOString();
  const execution = await runExactCommand({
    executable,
    argv,
    cwd: executionCwd,
    stdinPath: persistedStdinPath,
    stdoutFd: store.stdoutFd,
    stderrFd: store.stderrFd,
    env: executionEnvironment,
  });
  closeQuickOutputFiles(store);
  const finishedAt = new Date().toISOString();

  let workspaceAfter;
  let foreignWorkspace = null;
  let isolationResult = null;
  let cleanupStatus = "not_required";
  try {
    if (isolation !== null) {
      isolationResult = inspectQuickIsolation(isolation);
      cleanupStatus = removeQuickIsolation(isolation);
    }
    workspaceAfter = captureWorkspaceSnapshot(sourceRoot, { ignoredPaths });
    if (foreignMode) {
      const candidateAfter = captureCanonicalCandidateIdentityV1(sourceRoot);
      const filesystemAfter = captureForeignWorkspaceFilesystemIdentityV1(sourceRoot);
      foreignWorkspace = {
        candidateBefore: foreignWorkspaceBefore.candidate,
        candidateAfter,
        filesystemBefore: foreignWorkspaceBefore.filesystem,
        filesystemAfter,
        zeroWriteObserved: foreignWorkspaceBefore.candidate.candidateFingerprint
            === candidateAfter.candidateFingerprint
          && foreignWorkspaceBefore.filesystem.filesystemFingerprint
            === filesystemAfter.filesystemFingerprint,
      };
    }
  } catch (error) {
    if (isolation !== null && cleanupStatus === "not_required") {
      removeQuickIsolation(isolation);
    }
    return {
      status: "quick_verification_source_mutated",
      exitCode: 2,
      receiptPath: null,
      receiptSha256: null,
      issues: [error instanceof Error ? error.message : String(error)],
      authorizationGranted: false,
    };
  }

  const mutation = mutationTruth({
    workspaceBefore,
    workspaceAfter,
    isolationResult,
    cleanupStatus,
    foreignWorkspace,
  });
  const sourceMutated = mutation.mutationDecision !== "source_unchanged";
  const receiptV4 = foreignMode;
  const receiptV3 = !receiptV4 && (effectiveIsolation === true || ignoredPaths.length > 0);
  let persisted;
  try {
    persisted = persistQuickReceipt({
      workspaceRoot: controllerRoot,
      store,
      receipt: {
      schemaVersion: receiptV4
        ? "OwlCodaQuickVerificationReceiptV4"
        : receiptV3
        ? "OwlCodaQuickVerificationReceiptV3"
        : stdinArtifact === null
        ? "OwlCodaQuickVerificationReceiptV1"
        : "OwlCodaQuickVerificationReceiptV2",
      receiptId: store.receiptId,
      assurance: "captured_verification",
      authorizationGranted: false,
      coreIdentity: {
        contractVersion: currentCoreIdentity().contractVersion,
        coreVersion: currentCoreIdentity().coreVersion,
        coreManifestSha256: currentCoreIdentity().coreManifestSha256,
      },
      workspaceBefore,
      exactCommand: {
        executable,
        argv,
        cwd: executionCwd,
      },
      ...(receiptV3 || receiptV4
        ? {
            sourceWorkspaceRoot: sourceRoot,
            executionIsolation: isolationReceipt(isolation, isolationResult, cleanupStatus),
            mutationClasses: mutation.mutationClasses,
          }
        : {}),
      ...(receiptV4
        ? {
            controllerWorkspaceRoot: controllerRoot,
            foreignWorkspace,
          }
        : {}),
      ...(stdinArtifact === null
        ? {}
        : { inputArtifacts: { stdin: stdinArtifact } }),
      verificationContext: {
        platform: process.platform,
        architecture: process.arch,
        runtime: process.version,
      },
      startedAt,
      finishedAt,
      exitResult: {
        exitCode: execution.exitCode,
        signal: execution.signal,
      },
      workspaceAfter,
      mutationDecision: mutation.mutationDecision,
        issueCodes: mutation.issueCodes,
      },
    });
  } catch (error) {
    return {
      status: "quick_verification_control_invalid",
      exitCode: 1,
      receiptPath: null,
      receiptSha256: null,
      sourceFingerprint: workspaceAfter.sourceFingerprint,
      commandExitCode: execution.exitCode,
      mutationDecision: mutation.mutationDecision,
      issueCodes: [...mutation.issueCodes, "quick_receipt_store_invalid"],
      ...inputArtifactResult(stdinArtifact),
      issues: [error instanceof Error ? error.message : String(error)],
      nextAllowedAction: "repair_quick_receipt_store_and_rerun",
      authorizationGranted: false,
    };
  }

  const { outputSummary, evidenceStorage } = persisted;
  let runtimeTransition = null;
  if (expectedRuntimeReportPath !== null) {
    try {
      runtimeTransition = captureRuntimeTransition({
        workspaceRoot: controllerRoot,
        quickReceiptPath: persisted.receiptPath,
        runtimeReportPath: expectedRuntimeReportPath,
      });
    } catch (error) {
      runtimeTransition = {
        status: "runtime_transition_invalid",
        receiptPath: null,
        issues: [error instanceof Error ? error.message : String(error)],
        authorizationGranted: false,
      };
    }
  }
  const runtimeFields = runtimeTransition === null ? {} : { runtimeTransition };

  if (sourceMutated) {
    const attestCommand = quickAttestCommand(controllerRoot, persisted.receiptPath);
    return {
      status: "quick_verification_source_mutated",
      exitCode: 2,
      receiptPath: persisted.receiptPath,
      receiptSha256: persisted.receiptSha256,
      sourceFingerprint: workspaceAfter.sourceFingerprint,
      commandExitCode: execution.exitCode,
      mutationDecision: mutation.mutationDecision,
      issueCodes: mutation.issueCodes,
      ...(foreignMode ? { targetZeroWrite: foreignWorkspace.zeroWriteObserved } : {}),
      ...inputArtifactResult(stdinArtifact),
      outputSummary,
      evidenceStorage,
      ...runtimeFields,
      attestCommand,
      issues: [],
      nextAllowedAction: "restore_source_or_run_a_new_quick_verification",
      authorizationGranted: false,
    };
  }
  if (runtimeTransition?.status === "runtime_transition_invalid") {
    const attestCommand = quickAttestCommand(controllerRoot, persisted.receiptPath);
    return {
      status: "quick_verification_runtime_truth_invalid",
      exitCode: 1,
      quickVerificationStatus: execution.launchError || execution.exitCode !== 0
        ? "quick_verification_failed"
        : "quick_verification_passed",
      receiptPath: persisted.receiptPath,
      receiptSha256: persisted.receiptSha256,
      sourceFingerprint: workspaceAfter.sourceFingerprint,
      commandExitCode: execution.exitCode,
      mutationDecision: "source_unchanged",
      issueCodes: mutation.issueCodes,
      ...(foreignMode ? { targetZeroWrite: foreignWorkspace.zeroWriteObserved } : {}),
      ...inputArtifactResult(stdinArtifact),
      outputSummary,
      evidenceStorage,
      runtimeTransition,
      attestCommand,
      issues: runtimeTransition.issues,
      nextAllowedAction: "repair_runtime_report_and_run_a_new_quick_verification",
      authorizationGranted: false,
    };
  }
  if (execution.launchError || execution.exitCode !== 0) {
    const attestCommand = quickAttestCommand(controllerRoot, persisted.receiptPath);
    return {
      status: "quick_verification_failed",
      exitCode: 1,
      receiptPath: persisted.receiptPath,
      receiptSha256: persisted.receiptSha256,
      sourceFingerprint: workspaceAfter.sourceFingerprint,
      commandExitCode: execution.exitCode,
      mutationDecision: "source_unchanged",
      issueCodes: mutation.issueCodes,
      ...(foreignMode ? { targetZeroWrite: foreignWorkspace.zeroWriteObserved } : {}),
      ...inputArtifactResult(stdinArtifact),
      outputSummary,
      evidenceStorage,
      ...runtimeFields,
      attestCommand,
      issues: execution.launchError ? [execution.launchError] : [],
      nextAllowedAction: "inspect_output_and_rerun",
      authorizationGranted: false,
    };
  }
  const attestCommand = quickAttestCommand(controllerRoot, persisted.receiptPath);
  return {
    status: "quick_verification_passed",
    exitCode: 0,
    receiptPath: persisted.receiptPath,
    receiptSha256: persisted.receiptSha256,
    sourceFingerprint: workspaceAfter.sourceFingerprint,
    commandExitCode: 0,
    mutationDecision: "source_unchanged",
    issueCodes: mutation.issueCodes,
    ...(foreignMode ? { targetZeroWrite: foreignWorkspace.zeroWriteObserved } : {}),
    ...inputArtifactResult(stdinArtifact),
    outputSummary,
    evidenceStorage,
    ...runtimeFields,
    attestCommand,
    issues: [],
    nextAllowedAction: attestCommand,
    authorizationGranted: false,
  };
}
