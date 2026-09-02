const BOOLEAN_FACTS = [
  "needsDurableEvidence",
  "needsFormalAcceptance",
  "mayMutateProject",
  "externalSideEffects",
  "longRunning",
  "interruptionRecovery",
  "dirtyParallelWorkspace",
  "irreversibleChange",
  "rollbackUncertain",
  "permissionSensitive",
  "securitySensitive",
  "fundsAtRisk",
  "schemaOrDataMigration",
];

export const RUNKIT_RISK_CATEGORIES = Object.freeze([
  "backtest",
  "deployment",
  "destructive",
  "foreign_write",
  "funds",
  "integration",
  "migration",
  "production",
  "release",
]);

const RISK_CATEGORIES = new Set(RUNKIT_RISK_CATEGORIES);

const MATERIAL_RISK_CATEGORIES = new Set([
  "destructive",
  "foreign_write",
  "funds",
  "migration",
]);

function incompleteReasons(input) {
  const reasons = [];
  for (const field of BOOLEAN_FACTS) {
    if (typeof input?.[field] !== "boolean") {
      reasons.push(`unknown_${field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`);
    }
  }
  if (!Number.isInteger(input?.exactCommandCount) || input.exactCommandCount < 0) {
    reasons.push("unknown_exact_command_count");
  }
  if (!Number.isInteger(input?.writerCount) || input.writerCount < 0) {
    reasons.push("unknown_writer_count");
  }
  if (!Array.isArray(input?.riskCategories)) {
    reasons.push("unknown_risk_categories");
  } else if (input.riskCategories.some(category => !RISK_CATEGORIES.has(category))) {
    reasons.push("unknown_risk_category");
  }
  return [...new Set(reasons)].sort();
}

function result({ schemaVersion, lane, riskMode, reasonCodes, nextCommand }) {
  return {
    schemaVersion,
    status: "routed",
    lane,
    riskMode,
    reasonCodes,
    nextCommand,
    authorizationGranted: false,
  };
}

function routeRunKitAssurance(input, { schemaVersion, commandPrefix }) {
  const incomplete = incompleteReasons(input);
  if (incomplete.length > 0) {
    return result({
      schemaVersion,
      lane: "formal",
      riskMode: "full",
      reasonCodes: ["assurance_input_incomplete", ...incomplete],
      nextCommand: `${commandPrefix} formal start`,
    });
  }

  const categories = [...new Set(input.riskCategories)].sort();
  const formalReasons = [
    ...(input.needsFormalAcceptance ? ["formal_acceptance_required"] : []),
    ...(input.writerCount > 1 ? ["multiple_writers"] : []),
    ...(input.permissionSensitive === true ? ["permission_sensitive"] : []),
    ...(input.securitySensitive === true ? ["security_sensitive"] : []),
    ...(input.fundsAtRisk === true ? ["funds_at_risk"] : []),
    ...(input.irreversibleChange === true ? ["irreversible_change"] : []),
    ...(input.rollbackUncertain === true ? ["rollback_uncertain"] : []),
    ...(input.schemaOrDataMigration === true ? ["schema_or_data_migration"] : []),
    ...categories
      .filter(category => MATERIAL_RISK_CATEGORIES.has(category))
      .map(category => `risk_${category}`),
  ];
  if (formalReasons.length > 0) {
    return result({
      schemaVersion,
      lane: "formal",
      riskMode: "full",
      reasonCodes: [...new Set(formalReasons)].sort(),
      nextCommand: `${commandPrefix} formal start`,
    });
  }

  if (!input.needsDurableEvidence) {
    return result({
      schemaVersion,
      lane: "none",
      riskMode: "lightweight",
      reasonCodes: ["durable_evidence_not_required"],
      nextCommand: null,
    });
  }

  if (input.exactCommandCount !== 1) {
    return result({
      schemaVersion,
      lane: "none",
      riskMode: "lightweight",
      reasonCodes: ["quick_exact_command_required"],
      nextCommand: null,
    });
  }

  return result({
    schemaVersion,
    lane: "quick",
    riskMode: "lightweight",
    reasonCodes: ["single_bounded_verification"],
    nextCommand: `${commandPrefix} quick-verify`,
  });
}

export function routeRunKitAssuranceV1(input) {
  return routeRunKitAssurance(input, {
    schemaVersion: "OwlCodaRunKitAssuranceRouteV1",
    commandPrefix: "owlrunkit",
  });
}

export function routeRunKitAssuranceV2(input) {
  return routeRunKitAssurance(input, {
    schemaVersion: "OwlCodaRunKitAssuranceRouteV2",
    commandPrefix: "npx --no-install owlrunkit",
  });
}
