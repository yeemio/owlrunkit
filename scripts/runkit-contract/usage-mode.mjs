import { RUNKIT_RISK_CATEGORIES } from "./assurance-router.mjs";

const USER_MODES = new Set(["auto", "off", "light", "managed", "formal"]);

const BOOLEAN_FACTS = [
  "needsDurableEvidence",
  "mayMutateProject",
  "externalSideEffects",
  "crossSession",
  "longRunning",
  "interruptionRecovery",
  "dirtyParallelWorkspace",
  "irreversibleChange",
  "rollbackUncertain",
  "permissionSensitive",
  "securitySensitive",
  "fundsAtRisk",
  "schemaOrDataMigration",
  "needsFormalAcceptance",
];

const MATERIAL_RISK_CATEGORIES = new Map([
  ["destructive", "risk_destructive"],
  ["foreign_write", "risk_foreign_write"],
  ["funds", "funds_at_risk"],
  ["migration", "schema_or_data_migration"],
]);

const KNOWN_RISK_CATEGORIES = new Set(RUNKIT_RISK_CATEGORIES);

const AUTHORITY_BOUNDARY = Object.freeze({
  authorizationGranted: false,
  git: false,
  release: false,
  deployment: false,
  production: false,
  business: false,
});

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function requireFacts(input) {
  if (!USER_MODES.has(input?.requestedMode)) {
    throw new Error("requestedMode must be auto, off, light, managed, or formal");
  }
  for (const field of BOOLEAN_FACTS) {
    if (typeof input[field] !== "boolean") throw new Error(`${field} must be boolean`);
  }
  for (const field of ["exactCommandCount", "writerCount"]) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0) {
      throw new Error(`${field} must be a non-negative safe integer`);
    }
  }
  if (!Array.isArray(input.riskCategories)
    || !input.riskCategories.every((value) => typeof value === "string")) {
    throw new Error("riskCategories must be an array of strings");
  }
  const unknownCategories = uniqueSorted(
    input.riskCategories.filter((value) => !KNOWN_RISK_CATEGORIES.has(value)),
  );
  if (unknownCategories.length > 0) {
    throw new Error(
      `riskCategories contains an unknown category: ${unknownCategories.join(", ")}. `
      + `Allowed: ${RUNKIT_RISK_CATEGORIES.join(", ")}`,
    );
  }
}

function formalReasonCodes(input) {
  return uniqueSorted([
    ...(input.writerCount > 1 ? ["multiple_writers"] : []),
    ...(input.permissionSensitive ? ["permission_sensitive"] : []),
    ...(input.securitySensitive ? ["security_sensitive"] : []),
    ...(input.fundsAtRisk ? ["funds_at_risk"] : []),
    ...(input.irreversibleChange ? ["irreversible_change"] : []),
    ...(input.rollbackUncertain ? ["rollback_uncertain"] : []),
    ...(input.schemaOrDataMigration ? ["schema_or_data_migration"] : []),
    ...(input.needsFormalAcceptance ? ["formal_acceptance_required"] : []),
    ...input.riskCategories
      .filter((category) => MATERIAL_RISK_CATEGORIES.has(category))
      .map((category) => MATERIAL_RISK_CATEGORIES.get(category)),
  ]);
}

function continuityReasonCodes(input) {
  return uniqueSorted([
    ...(input.crossSession ? ["cross_session_continuity"] : []),
    ...(input.longRunning ? ["long_running_continuity"] : []),
    ...(input.interruptionRecovery ? ["interruption_recovery_continuity"] : []),
    ...(input.dirtyParallelWorkspace ? ["dirty_workspace_continuity"] : []),
    ...(input.writerCount > 1 ? ["multi_writer_continuity"] : []),
  ]);
}

function estimateOverhead(continuity, assurance) {
  const continuitySteps = continuity === "project_driver" ? 2 : 0;
  const assuranceSteps = assurance === "quick" ? 1 : assurance === "formal" ? 3 : 0;
  const continuityArtifacts = continuity === "project_driver" ? 1 : 0;
  const assuranceArtifacts = assurance === "quick" ? 1 : assurance === "formal" ? 4 : 0;
  return {
    additionalSteps: continuitySteps + assuranceSteps,
    evidenceArtifacts: continuityArtifacts + assuranceArtifacts,
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function nextCommand({ workspaceRoot, continuity, assurance, commandPrefix }) {
  const workspace = shellQuote(workspaceRoot ?? ".");
  if (assurance === "formal") {
    return `${commandPrefix} formal start --workspace ${workspace}`;
  }
  if (continuity === "project_driver") {
    return `${commandPrefix} project status --workspace ${workspace}`;
  }
  if (assurance === "quick") {
    return `${commandPrefix} quick-verify --workspace ${workspace} -- <command> [args...]`;
  }
  return null;
}

function rejectedModes(recommendedMode, reasonCodes) {
  const lighter = {
    off: [],
    light: ["off"],
    managed: ["off", "light"],
    formal: ["off", "light", "managed"],
  }[recommendedMode];
  return lighter.map((mode) => ({ mode, reasonCodes }));
}

function recommendUsageMode(input, { schemaVersion, commandPrefix }) {
  requireFacts(input);
  const forcedFormalReasons = formalReasonCodes(input);
  const continuityReasons = continuityReasonCodes(input);
  const requestedMode = input.requestedMode;
  const projectDriverPresent = input.projectDriverPresent === true;

  let continuity = "none";
  let assurance = "none";
  const triggerReasons = [];

  if (requestedMode === "managed"
    || (requestedMode === "auto" && (continuityReasons.length > 0 || projectDriverPresent))) {
    continuity = "project_driver";
    triggerReasons.push(...(continuityReasons.length > 0
      ? continuityReasons
      : projectDriverPresent
        ? ["project_driver_already_initialized"]
        : ["managed_mode_requested"]));
  }

  if (forcedFormalReasons.length > 0) {
    assurance = "formal";
    if (continuityReasons.length > 0) continuity = "project_driver";
    triggerReasons.push(...forcedFormalReasons);
  } else if (requestedMode === "formal") {
    assurance = "formal";
    triggerReasons.push("formal_mode_requested");
  } else if (requestedMode === "light") {
    assurance = "quick";
    triggerReasons.push("light_mode_requested");
  } else if (requestedMode !== "off" && input.needsDurableEvidence) {
    if (input.exactCommandCount === 1) {
      assurance = "quick";
      triggerReasons.push("single_bounded_verification");
    } else {
      triggerReasons.push("quick_exact_command_required");
    }
  } else if (requestedMode === "off") {
    triggerReasons.push("off_mode_requested");
  } else if (continuity === "none") {
    triggerReasons.push("durable_evidence_not_required");
  }

  const recommendedMode = assurance === "formal"
    ? "formal"
    : continuity === "project_driver"
      ? "managed"
      : assurance === "quick"
        ? "light"
        : "off";
  const blockingReasons = forcedFormalReasons.length > 0
    ? forcedFormalReasons
    : uniqueSorted(triggerReasons);
  const downgradeAllowed = forcedFormalReasons.length === 0;

  return {
    schemaVersion,
    status: "mode_recommended",
    requestedMode,
    recommendedMode,
    continuity,
    assurance,
    triggerReasons: uniqueSorted(triggerReasons),
    rejectedLighterModes: rejectedModes(recommendedMode, blockingReasons),
    estimatedOverhead: estimateOverhead(continuity, assurance),
    nextCommand: nextCommand({
      workspaceRoot: input.workspaceRoot,
      continuity,
      assurance,
      commandPrefix,
    }),
    downgrade: {
      allowed: downgradeAllowed,
      reasonCodes: downgradeAllowed ? [] : forcedFormalReasons,
    },
    authorityBoundary: { ...AUTHORITY_BOUNDARY },
    authorizationGranted: false,
  };
}

export function recommendUsageModeV1(input) {
  return recommendUsageMode(input, {
    schemaVersion: "OwlCodaRunKitUsageModeRecommendationV1",
    commandPrefix: "owlrunkit",
  });
}

export function recommendUsageModeV2(input) {
  return recommendUsageMode(input, {
    schemaVersion: "OwlCodaRunKitUsageModeRecommendationV2",
    commandPrefix: "npx --no-install owlrunkit",
  });
}

export function formatUsageModeHumanV1(result) {
  const triggers = result.triggerReasons.length > 0
    ? result.triggerReasons.join(", ")
    : "none";
  const rejected = result.rejectedLighterModes.length > 0
    ? result.rejectedLighterModes
      .map((entry) => `${entry.mode} (${entry.reasonCodes.join(", ")})`)
      .join("; ")
    : "none";
  return [
    `Recommended mode: ${result.recommendedMode}`,
    `Continuity: ${result.continuity}`,
    `Assurance: ${result.assurance}`,
    `Why: ${triggers}`,
    `Rejected lighter modes: ${rejected}`,
    `Estimated overhead: ${result.estimatedOverhead.additionalSteps} steps, ${result.estimatedOverhead.evidenceArtifacts} evidence artifacts`,
    `Next command: ${result.nextCommand ?? "none"}`,
    `User downgrade allowed: ${result.downgrade.allowed ? "yes" : "no"}`,
    "Authority: no Git, release, deployment, production, or business authorization granted.",
    "",
  ].join("\n");
}

export const formatUsageModeHumanV2 = formatUsageModeHumanV1;
