const RUNTIME_LEVEL_BY_DECISION = Object.freeze({
  external_transition_passed: "reported_passed",
  external_transition_failed_recovered: "reported_failed_recovered",
  external_transition_failed_unrecovered: "reported_failed_unrecovered",
  external_transition_indeterminate: "reported_indeterminate",
  external_transition_invalidated: "reported_indeterminate",
});

function verificationLevel(result) {
  const status = result.quickVerificationStatus ?? result.status;
  if (status === "quick_verification_passed") return "passed";
  if (status === "quick_verification_failed") return "failed";
  if (status === "quick_verification_source_mutated") return "invalidated";
  return "not_proven";
}

function workspaceLevel(result) {
  if (result.mutationDecision === "source_unchanged") return "unchanged";
  if (typeof result.mutationDecision === "string") return "changed";
  return "not_proven";
}

function candidateLevel(result) {
  if (result.attestationDecision === "NO_GO") return "not_proven";
  const verification = verificationLevel(result);
  if (verification === "invalidated" || workspaceLevel(result) === "changed") {
    return "invalidated";
  }
  return typeof result.receiptPath === "string" && workspaceLevel(result) === "unchanged"
    ? "bound"
    : "not_proven";
}

function runtimeLevel(result) {
  const transition = result.runtimeTransition;
  if (!transition || transition.status === "runtime_transition_invalid") return "not_proven";
  return RUNTIME_LEVEL_BY_DECISION[transition.transitionDecision] ?? "reported_indeterminate";
}

function resultDecision(result) {
  if (candidateLevel(result) === "invalidated") return "invalidated";
  if (result.attestationDecision === "NO_GO"
    || [
      "quick_verification_control_invalid",
      "quick_verification_input_invalid",
      "quick_verification_runtime_truth_invalid",
    ].includes(result.status)) {
    return "indeterminate";
  }
  const verification = verificationLevel(result);
  if (verification === "passed") return "pass";
  if (verification === "failed") return "fail";
  return "indeterminate";
}

function headline(result, acceptanceLevels) {
  const decision = resultDecision(result);
  if (decision === "invalidated") {
    return "The verification candidate was invalidated by a workspace or execution-environment change.";
  }
  if (decision === "fail") {
    return "The exact verification command failed for the bound source candidate.";
  }
  if (decision === "indeterminate") {
    return "RunKit did not establish a reusable verification result.";
  }
  if (acceptanceLevels.deploymentRuntime === "reported_failed_recovered") {
    return "Verification passed, and the exact command reported a failed external transition with successful rollback.";
  }
  if (acceptanceLevels.deploymentRuntime === "reported_failed_unrecovered") {
    return "Verification passed, but the exact command reported an unrecovered external transition failure.";
  }
  if (acceptanceLevels.deploymentRuntime === "reported_passed") {
    return "Verification passed, and the exact command reported a successful external transition.";
  }
  return "The exact verification command passed for the bound source candidate.";
}

export function projectQuickOutcomeV1(result) {
  const acceptanceLevels = {
    candidateIdentity: candidateLevel(result),
    workspaceAttestation: workspaceLevel(result),
    verificationCommand: verificationLevel(result),
    productExperience: "not_proven",
    deploymentRuntime: runtimeLevel(result),
    productionBusiness: "not_proven",
  };
  const proven = [];
  if (acceptanceLevels.candidateIdentity === "bound") {
    proven.push("Quick evidence binds the exact command to the captured source candidate.");
  }
  if (acceptanceLevels.workspaceAttestation === "unchanged") {
    proven.push("The bound workspace state remained unchanged during the command.");
  }
  if (acceptanceLevels.verificationCommand === "passed") {
    proven.push("The exact verification command exited successfully.");
  } else if (acceptanceLevels.verificationCommand === "failed") {
    proven.push("The exact verification command failure was preserved.");
  }
  if (result.attestationDecision === "GO") {
    proven.push("The Quick receipt attestation decision is GO.");
  }
  if (acceptanceLevels.deploymentRuntime !== "not_proven") {
    proven.push("The exact command supplied a bounded external-runtime transition report.");
  }
  const notProven = [
    ...(result.attestationDecision === "NO_GO"
      ? ["Quick attestation did not establish a reusable candidate binding."]
      : []),
    "Product or UX acceptance was not performed by Quick Verification.",
    ...(acceptanceLevels.deploymentRuntime === "not_proven"
      ? ["Deployment or runtime activation was not proven."]
      : ["RunKit did not independently observe the external runtime beyond the exact command report."]),
    "Production or business effectiveness was not proven.",
    "No Git, release, deployment, production, or business authority was granted.",
  ];
  return {
    schemaVersion: "OwlCodaRunKitOutcomeSummaryV1",
    result: resultDecision(result),
    headline: headline(result, acceptanceLevels),
    proofLevel: typeof result.receiptPath === "string"
      ? "captured_verification"
      : "no_reusable_evidence",
    acceptanceLevels,
    proven,
    notProven,
    nextAction: typeof result.nextAllowedAction === "string"
      ? result.nextAllowedAction
      : "inspect_result",
    authorizationGranted: false,
  };
}

function display(value) {
  return value.replaceAll("_", " ");
}

function humanNextAction(nextAction) {
  if (nextAction.includes(" quick-attest ")) return "Attest this Quick result.";
  const friendly = {
    consume_attestation: "Use the attested verification evidence at the next named gate.",
    inspect_attestation_issues: "Inspect the attestation issues before relying on this result.",
    inspect_output_and_rerun: "Inspect the failed command output, repair the cause, and rerun.",
    restore_source_or_run_a_new_quick_verification: "Restore or freeze the intended candidate, then run a new verification.",
    repair_runtime_report_and_run_a_new_quick_verification: "Repair the runtime report and run a new verification.",
  };
  return friendly[nextAction] ?? nextAction.replaceAll("_", " ");
}

export function formatQuickOutcomeHumanV1(outcome) {
  const label = {
    pass: "PASS",
    fail: "FAIL",
    invalidated: "INVALIDATED",
    indeterminate: "INDETERMINATE",
  }[outcome.result];
  const levels = outcome.acceptanceLevels;
  return [
    `Result: ${label} — ${outcome.headline}`,
    `Proved: ${outcome.proven.length > 0 ? outcome.proven.join(" ") : "No reusable verification claim."}`,
    "Acceptance: "
      + `Candidate: ${display(levels.candidateIdentity)}; `
      + `workspace: ${display(levels.workspaceAttestation)}; `
      + `verification: ${display(levels.verificationCommand)}; `
      + "Product/UX: not proven; "
      + `Deployment/runtime: ${display(levels.deploymentRuntime)}; `
      + "Production/business: not proven.",
    `Next: ${humanNextAction(outcome.nextAction)}`,
    "Authority: no Git, release, deployment, production, or business authority granted.",
  ].join("\n");
}
