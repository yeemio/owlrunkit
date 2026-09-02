import path from "node:path";

import { currentCoreIdentity } from "./core-contract.mjs";
import { discoverFleet } from "./fleet-discovery.mjs";
import {
  inspectInstalledSkillCompatibility,
  inspectProjectForSkillChange,
} from "./install-codex-skill.mjs";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function fleetSourceArguments({
  workspaceRoots,
  fleetManifestPath,
  fleetRoots,
  fleetRegistryPath,
}, { install = false } = {}) {
  if (Array.isArray(workspaceRoots)) {
    const flag = install ? "--workspace" : "--workspace-root";
    return workspaceRoots.flatMap(root => [flag, shellQuote(root)]).join(" ");
  }
  if (Array.isArray(fleetRoots)) {
    return fleetRoots.flatMap(root => ["--fleet-root", shellQuote(root)]).join(" ");
  }
  if (typeof fleetManifestPath === "string") {
    return `--fleet-manifest ${shellQuote(fleetManifestPath)}`;
  }
  return typeof fleetRegistryPath === "string"
    ? `--registry ${shellQuote(fleetRegistryPath)}`
    : "";
}

export async function planFleetSkillUpgradeV1({
  repositoryRoot,
  targetRoot,
  archiveRoot,
  workspaceRoots = null,
  fleetManifestPath = null,
  fleetRoots = null,
  fleetRegistryPath = null,
} = {}) {
  for (const [name, value] of Object.entries({ repositoryRoot, targetRoot, archiveRoot })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${name} is required`);
    }
  }
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedTargetRoot = path.resolve(targetRoot);
  const resolvedArchiveRoot = path.resolve(archiveRoot);
  const source = { workspaceRoots, fleetManifestPath, fleetRoots, fleetRegistryPath };
  const blockers = [];
  let discovery = null;
  try {
    discovery = await discoverFleet(source);
  } catch (error) {
    blockers.push({
      code: error?.message === "fleet_registry_missing"
        ? "fleet_registry_missing"
        : "fleet_discovery_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (discovery !== null && !discovery.complete) {
    for (const workspaceRoot of discovery.unreachableRoots) {
      blockers.push({ code: "fleet_root_unreachable", workspaceRoot });
    }
    for (const issue of discovery.issues) {
      blockers.push({
        code: "fleet_discovery_issue",
        detail: `${issue.code}:${issue.path}`,
      });
    }
  }

  const affectedProjects = [];
  for (const workspaceRoot of discovery?.workspaceRoots ?? []) {
    const inspected = await inspectProjectForSkillChange(workspaceRoot);
    affectedProjects.push(inspected.project);
    blockers.push(...inspected.blockers);
  }
  affectedProjects.sort((left, right) => (
    left.workspaceRoot < right.workspaceRoot ? -1 : left.workspaceRoot > right.workspaceRoot ? 1 : 0
  ));

  const sharedSkill = await inspectInstalledSkillCompatibility({
    targetRoot: resolvedTargetRoot,
  });
  if (new Set(["unmanaged", "drifted"]).has(sharedSkill.status)) {
    blockers.push({ code: "shared_skill_integrity_invalid", detail: sharedSkill.status });
  }
  blockers.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));

  const planSourceArgs = fleetSourceArguments(source);
  const installSourceArgs = fleetSourceArguments(source, { install: true });
  const commonPlan = [
    "npx --no-install owlrunkit fleet skill-plan",
    `--skill-root ${shellQuote(resolvedTargetRoot)}`,
    `--archive-root ${shellQuote(resolvedArchiveRoot)}`,
    planSourceArgs,
  ].filter(Boolean).join(" ");
  const installerPath = path.join(
    resolvedRepositoryRoot,
    "scripts/runkit-contract/install-codex-skill.mjs",
  );
  const installCommand = [
    `node ${shellQuote(installerPath)} install`,
    `--repository ${shellQuote(resolvedRepositoryRoot)}`,
    `--target ${shellQuote(resolvedTargetRoot)}`,
    `--archive ${shellQuote(resolvedArchiveRoot)}`,
    installSourceArgs,
  ].filter(Boolean).join(" ");
  const rollbackCommand = [
    `node ${shellQuote(installerPath)} restore`,
    `--target ${shellQuote(resolvedTargetRoot)}`,
    `--archive ${shellQuote(resolvedArchiveRoot)}`,
    "--receipt <upgrade-receipt.json>",
  ].join(" ");

  return {
    schemaVersion: "OwlCodaRunKitFleetSkillUpgradePlanV1",
    status: blockers.length === 0 ? "ready" : "blocked",
    expectedCore: currentCoreIdentity(),
    sharedSkill: {
      targetRoot: resolvedTargetRoot,
      status: sharedSkill.status,
      installedSkillVersion: sharedSkill.installedSkillVersion ?? null,
      installedConfigCoreVersion: sharedSkill.installedConfigCoreVersion ?? null,
      issues: sharedSkill.issues ?? [],
    },
    discovery: discovery === null ? null : {
      source: discovery.source,
      complete: discovery.complete,
      workspaceCount: discovery.workspaceRoots.length,
      unreachableRoots: discovery.unreachableRoots,
      issues: discovery.issues,
    },
    affectedProjects,
    blockers,
    commands: {
      dryRun: commonPlan,
      install: installCommand,
      rollback: rollbackCommand,
    },
    authorizationGranted: false,
  };
}

export function formatFleetSkillUpgradePlanHumanV1(plan) {
  const lines = [
    `Shared Skill fleet plan: ${plan.status}.`,
    `Expected Core: ${plan.expectedCore.coreVersion} (${plan.expectedCore.coreManifestSha256}).`,
    `Installed Skill: ${plan.sharedSkill.status} (${plan.sharedSkill.installedSkillVersion ?? "unknown"}).`,
    `Affected projects: ${plan.affectedProjects.length}.`,
  ];
  if (plan.blockers.length > 0) {
    lines.push("Blockers:");
    for (const blocker of plan.blockers) {
      lines.push(`- ${blocker.code}${blocker.workspaceRoot ? `: ${blocker.workspaceRoot}` : ""}${blocker.artifactId ? ` (${blocker.artifactId})` : ""}${blocker.detail ? `: ${blocker.detail}` : ""}`);
    }
  }
  lines.push(
    `Dry run: ${plan.commands.dryRun}`,
    `Install after blockers clear: ${plan.commands.install}`,
    `Rollback after installation: ${plan.commands.rollback}`,
    "Authority: not granted; no shared Skill or project was modified.",
    "",
  );
  return lines.join("\n");
}
