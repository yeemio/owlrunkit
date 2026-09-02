import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  quickSnapshotFingerprintValid,
  validWorkspaceSnapshotShape,
} from "../../packages/attest/src/quick-receipt-contract.mjs";
import { captureWorkspaceSnapshot } from "./quick-workspace-snapshot.mjs";
import { readTeamProjectStatusV4 } from "./team-project.mjs";

const AUTHORITY_BOUNDARY = Object.freeze({
  agentDispatch: false,
  git: false,
  release: false,
  deployment: false,
  production: false,
  business: false,
  automation: false,
  money: false,
});

const MAX_CHANGED_PATHS = 256;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Completion continuity value is not canonical JSON.");
  return encoded;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

function canonicalGitRoot(workspaceRoot) {
  const requested = path.resolve(workspaceRoot);
  const stat = lstatSync(requested);
  const resolved = realpathSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory() || requested !== resolved) {
    throw new Error("Successor source workspace must be a real directory without symlink traversal.");
  }
  const gitRoot = realpathSync(execFileSync(
    "git",
    ["-C", resolved, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    },
  ).trim());
  if (gitRoot !== resolved) {
    throw new Error(`Successor source workspace must be the exact Git worktree root: ${gitRoot}.`);
  }
  return resolved;
}

function stableWorkspaceSnapshot(workspaceRoot) {
  const before = captureWorkspaceSnapshot(workspaceRoot);
  const after = captureWorkspaceSnapshot(workspaceRoot);
  if (canonical(before) !== canonical(after)) {
    throw new Error("Successor source workspace changed while its read-only snapshot was captured.");
  }
  return after;
}

function readBaselineEvent(controllerRoot, delivery) {
  const runtimeRoot = path.join(controllerRoot, ".owlcoda", "runkit");
  const requested = path.resolve(runtimeRoot, delivery.truthRef);
  const relative = path.relative(runtimeRoot, requested);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Completion continuity source delivery truth ref escapes the RunKit root.");
  }
  const stat = lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(requested) !== requested) {
    throw new Error("Completion continuity source delivery must be a regular file without symlinks.");
  }
  const event = JSON.parse(readFileSync(requested, "utf8"));
  if (event.type !== "source_delivery_imported"
    || event.deliveryId !== delivery.deliveryId
    || event.workspaceSnapshotFingerprint !== delivery.workspaceSnapshotFingerprint
    || !validWorkspaceSnapshotShape(event.targetSnapshot)
    || !quickSnapshotFingerprintValid(event.targetSnapshot)
    || event.targetSnapshot.sourceFingerprint !== delivery.workspaceSnapshotFingerprint) {
    throw new Error("Completion continuity source delivery baseline is invalid.");
  }
  return event;
}

function changedOverlayPaths(before, after) {
  const beforeRows = new Map(before.dirtyOverlay.map(row => [row.path, canonical(row)]));
  const afterRows = new Map(after.dirtyOverlay.map(row => [row.path, canonical(row)]));
  return uniqueSorted([...beforeRows.keys(), ...afterRows.keys()].filter(filePath => (
    beforeRows.get(filePath) !== afterRows.get(filePath)
  )));
}

function committedPaths(root, beforeHead, afterHead) {
  if (beforeHead === afterHead) return { paths: [], complete: true };
  if (beforeHead === null || afterHead === null) return { paths: [], complete: false };
  try {
    const raw = execFileSync(
      "git",
      [
        "-C", root, "diff", "--name-status", "-z", "--find-renames",
        beforeHead, afterHead, "--",
      ],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
    );
    const fields = raw.split("\0");
    if (fields.at(-1) === "") fields.pop();
    const paths = [];
    for (let index = 0; index < fields.length;) {
      const status = fields[index];
      index += 1;
      if (!/^[A-Z][0-9]*$/u.test(status ?? "") || !fields[index]) {
        throw new Error("Committed source delta is not valid Git name-status output.");
      }
      paths.push(fields[index]);
      index += 1;
      if (status.startsWith("R") || status.startsWith("C")) {
        if (!fields[index]) {
          throw new Error("Committed rename or copy is missing its destination path.");
        }
        paths.push(fields[index]);
        index += 1;
      }
    }
    return {
      paths: uniqueSorted(paths),
      complete: true,
    };
  } catch {
    return { paths: [], complete: false };
  }
}

function dependencyPaths(before, after) {
  const beforeRows = new Map(before.dependencyLockfiles.map(row => [row.path, row.sha256]));
  const afterRows = new Map(after.dependencyLockfiles.map(row => [row.path, row.sha256]));
  return uniqueSorted([...beforeRows.keys(), ...afterRows.keys()].filter(filePath => (
    beforeRows.get(filePath) !== afterRows.get(filePath)
  )));
}

function sourceDelta(root, baseline, current) {
  const committed = committedPaths(root, baseline.headCommit, current.headCommit);
  const overlayPaths = changedOverlayPaths(baseline, current);
  const dependencyEnvironmentPaths = dependencyPaths(baseline, current);
  const allPaths = uniqueSorted([
    ...committed.paths,
    ...overlayPaths,
    ...dependencyEnvironmentPaths,
  ]);
  return {
    baselineHead: baseline.headCommit,
    currentHead: current.headCommit,
    headChanged: baseline.headCommit !== current.headCommit,
    trackedTreeChanged: baseline.trackedTreeIdentity !== current.trackedTreeIdentity,
    submodulesChanged: canonical(baseline.submodules) !== canonical(current.submodules),
    committedPaths: committed.paths.slice(0, MAX_CHANGED_PATHS),
    overlayPaths: overlayPaths.slice(0, MAX_CHANGED_PATHS),
    dependencyEnvironmentPaths: dependencyEnvironmentPaths.slice(0, MAX_CHANGED_PATHS),
    changedPaths: allPaths.slice(0, MAX_CHANGED_PATHS),
    changedPathCount: allPaths.length,
    changedPathsTruncated: allPaths.length > MAX_CHANGED_PATHS,
    pathEvidenceComplete: committed.complete,
  };
}

function baselineDelivery(status, targetRoot) {
  return [...status.sourceDeliveries]
    .filter(delivery => path.resolve(delivery.targetWorkspaceRef) === targetRoot)
    .sort((left, right) => (
      compareCodeUnits(left.occurredAt, right.occurredAt)
      || compareCodeUnits(left.deliveryId, right.deliveryId)
    ))
    .at(-1) ?? null;
}

function continuityProjection({ controllerRoot, status, targetWorkspaceRoot = null }) {
  if (status.overall !== "completed") {
    return {
      schemaVersion: "OwlCodaRunKitProjectCompletionContinuityV1",
      status: "not_applicable",
      projectId: status.projectId,
      projectTruthHash: status.projectTruthHash,
      disposition: "project_work_ledger_incomplete",
      targetWorkspaceRef: null,
      baseline: null,
      current: null,
      delta: null,
      nextAction: null,
      readOnly: true,
      writesPerformed: false,
      authorityBoundary: { ...AUTHORITY_BOUNDARY },
      authorizationGranted: false,
    };
  }

  const requestedTarget = targetWorkspaceRoot === null
    ? status.sourceDeliveries.at(-1)?.targetWorkspaceRef ?? null
    : targetWorkspaceRoot;
  if (requestedTarget === null) {
    return {
      schemaVersion: "OwlCodaRunKitProjectCompletionContinuityV1",
      status: "baseline_missing",
      projectId: status.projectId,
      projectTruthHash: status.projectTruthHash,
      disposition: "completed_project_source_baseline_missing",
      targetWorkspaceRef: null,
      baseline: null,
      current: null,
      delta: null,
      nextAction: "Review the current workspace and bind an explicit source baseline before deciding whether the project is terminal.",
      readOnly: true,
      writesPerformed: false,
      authorityBoundary: { ...AUTHORITY_BOUNDARY },
      authorizationGranted: false,
    };
  }

  let targetRoot;
  try {
    targetRoot = canonicalGitRoot(requestedTarget);
  } catch {
    return {
      schemaVersion: "OwlCodaRunKitProjectCompletionContinuityV1",
      status: "source_unverifiable",
      projectId: status.projectId,
      projectTruthHash: status.projectTruthHash,
      disposition: "completed_project_source_unverifiable",
      targetWorkspaceRef: path.resolve(requestedTarget),
      baseline: null,
      current: null,
      delta: null,
      nextAction: "Restore or explicitly replace the modeled source workspace before deciding whether the project is terminal.",
      readOnly: true,
      writesPerformed: false,
      authorityBoundary: { ...AUTHORITY_BOUNDARY },
      authorizationGranted: false,
    };
  }

  const delivery = baselineDelivery(status, targetRoot);
  if (delivery === null) {
    const current = stableWorkspaceSnapshot(targetRoot);
    return {
      schemaVersion: "OwlCodaRunKitProjectCompletionContinuityV1",
      status: "baseline_missing",
      projectId: status.projectId,
      projectTruthHash: status.projectTruthHash,
      disposition: "completed_project_source_baseline_missing",
      targetWorkspaceRef: targetRoot,
      baseline: null,
      current: {
        headCommit: current.headCommit,
        workspaceSnapshotFingerprint: current.sourceFingerprint,
      },
      delta: null,
      nextAction: "Review the current workspace and bind an explicit source baseline before deciding whether the project is terminal.",
      readOnly: true,
      writesPerformed: false,
      authorityBoundary: { ...AUTHORITY_BOUNDARY },
      authorizationGranted: false,
    };
  }

  const event = readBaselineEvent(controllerRoot, delivery);
  const current = stableWorkspaceSnapshot(targetRoot);
  const refreshed = readTeamProjectStatusV4({ workspaceRoot: controllerRoot });
  if (refreshed.projectTruthHash !== status.projectTruthHash) {
    throw new Error("Project truth changed while completion continuity was being inspected.");
  }
  const drifted = current.sourceFingerprint !== event.targetSnapshot.sourceFingerprint;
  return {
    schemaVersion: "OwlCodaRunKitProjectCompletionContinuityV1",
    status: drifted ? "workspace_drift" : "terminal",
    projectId: status.projectId,
    projectTruthHash: status.projectTruthHash,
    disposition: drifted
      ? "completed_project_with_unmodeled_workspace_drift"
      : "completed_project_terminal",
    targetWorkspaceRef: targetRoot,
    baseline: {
      kind: "imported_source_delivery",
      deliveryId: delivery.deliveryId,
      occurredAt: delivery.occurredAt,
      targetHead: delivery.targetHead,
      workspaceSnapshotFingerprint: delivery.workspaceSnapshotFingerprint,
      truthRef: delivery.truthRef,
    },
    current: {
      headCommit: current.headCommit,
      workspaceSnapshotFingerprint: current.sourceFingerprint,
    },
    delta: drifted ? sourceDelta(targetRoot, event.targetSnapshot, current) : null,
    nextAction: drifted
      ? "Review the unmodeled workspace drift and author a successor only after confirming its objective and scope."
      : null,
    readOnly: true,
    writesPerformed: false,
    authorityBoundary: { ...AUTHORITY_BOUNDARY },
    authorizationGranted: false,
  };
}

function hasExplicitDeliveryTruth(status) {
  return status.externalGates.length > 0
    || status.deliveryLifecycle.stages.some(stage => stage.truthRef !== null);
}

function continuityDominantGap(continuity) {
  if (continuity.disposition === "completed_project_with_unmodeled_workspace_drift") {
    return {
      kind: "unmodeled_workspace_drift",
      id: "workspace-drift",
      title: "Unmodeled workspace drift",
      workItemId: null,
      agentId: null,
      reason: "The completed Project Driver ledger is older than the bound source workspace.",
      truthRefs: [continuity.baseline.truthRef],
    };
  }
  if (continuity.disposition === "completed_project_source_baseline_missing") {
    return {
      kind: "source_baseline",
      id: "last-modeled-source",
      title: "Source baseline missing",
      workItemId: null,
      agentId: null,
      reason: "The completed Project Driver ledger has no explicit source snapshot baseline.",
      truthRefs: ["project/definition.json"],
    };
  }
  if (continuity.disposition === "completed_project_source_unverifiable") {
    return {
      kind: "source_baseline",
      id: "last-modeled-source",
      title: "Source baseline unverifiable",
      workItemId: null,
      agentId: null,
      reason: "The modeled source workspace cannot be verified as an exact Git worktree root.",
      truthRefs: ["project/definition.json"],
    };
  }
  return {
    kind: "none",
    id: null,
    title: null,
    workItemId: null,
    agentId: null,
    reason: null,
    truthRefs: continuity.baseline === null
      ? ["project/definition.json"]
      : [continuity.baseline.truthRef],
  };
}

export function readTeamProjectStatusV5({ workspaceRoot }) {
  const controllerRoot = realpathSync(path.resolve(workspaceRoot));
  const status = readTeamProjectStatusV4({ workspaceRoot: controllerRoot });
  const completionContinuity = continuityProjection({ controllerRoot, status });
  const explicitDeliveryTruth = hasExplicitDeliveryTruth(status);
  const shouldProjectContinuity = status.overall === "completed" && (
    completionContinuity.status === "workspace_drift"
    || !explicitDeliveryTruth
  );
  if (!shouldProjectContinuity) {
    return {
      ...status,
      schemaVersion: "OwlCodaRunKitTeamProjectStatusV5",
      completionContinuity,
    };
  }
  const dominantGap = continuityDominantGap(completionContinuity);
  const nextAction = completionContinuity.nextAction;
  return {
    ...status,
    schemaVersion: "OwlCodaRunKitTeamProjectStatusV5",
    completionContinuity,
    headline: dominantGap.kind === "none"
      ? "Completed project is terminal against its bound source baseline; authorizationGranted=false."
      : `Dominant gap: ${dominantGap.kind}; blocker: ${dominantGap.reason} next: ${nextAction}`,
    dominantGap,
    nextAction,
    nextActorId: null,
  };
}

function pathPrefix(rule) {
  return rule.endsWith("/**") ? rule.slice(0, -3) : null;
}

function pathCovered(rule, candidate) {
  if (rule === candidate) return true;
  const prefix = pathPrefix(rule);
  return prefix !== null && (candidate === prefix || candidate.startsWith(`${prefix}/`));
}

function scaffoldLanes(status, changedPaths) {
  const matches = new Map(status.workItems.map(item => [item.workItemId, []]));
  const unmatched = [];
  const conflicts = [];
  for (const changedPath of changedPaths) {
    const owners = status.workItems.filter(item => (
      item.ownedPaths.some(rule => pathCovered(rule, changedPath))
    ));
    if (owners.length === 0) unmatched.push(changedPath);
    for (const owner of owners) matches.get(owner.workItemId).push(changedPath);
    if (owners.length > 1) {
      conflicts.push({
        path: changedPath,
        historicalWorkItemIds: owners.map(item => item.workItemId).sort(compareCodeUnits),
      });
    }
  }
  const possibleLanes = status.workItems
    .filter(item => matches.get(item.workItemId).length > 0)
    .map(item => ({
      laneId: `historical-scope:${item.workItemId}`,
      basis: "historical_owned_paths_only",
      historicalWorkItemId: item.workItemId,
      suggestedOwnedPaths: uniqueSorted(matches.get(item.workItemId)),
      requiresHumanConfirmation: true,
    }));
  if (unmatched.length > 0) {
    possibleLanes.push({
      laneId: "unassigned-paths",
      basis: "unmatched_paths_only",
      historicalWorkItemId: null,
      suggestedOwnedPaths: uniqueSorted(unmatched),
      requiresHumanConfirmation: true,
    });
  }
  return { possibleLanes, pathConflicts: conflicts };
}

export function buildSuccessorScaffoldV1({ workspaceRoot, fromWorkspaceRoot }) {
  const controllerRoot = realpathSync(path.resolve(workspaceRoot));
  const status = readTeamProjectStatusV4({ workspaceRoot: controllerRoot });
  if (status.overall !== "completed") {
    throw new Error("Successor scaffold requires a completed Project Driver ledger.");
  }
  const targetRoot = canonicalGitRoot(fromWorkspaceRoot);
  const completionContinuity = continuityProjection({
    controllerRoot,
    status,
    targetWorkspaceRoot: targetRoot,
  });
  const changedPaths = completionContinuity.delta?.changedPaths ?? [];
  const { possibleLanes, pathConflicts } = scaffoldLanes(status, changedPaths);
  const drifted = completionContinuity.status === "workspace_drift";
  const baselineMissing = completionContinuity.status === "baseline_missing";
  return {
    schemaVersion: "OwlCodaRunKitSuccessorScaffoldV1",
    status: drifted
      ? "successor_review_required"
      : baselineMissing
        ? "successor_baseline_missing"
        : completionContinuity.status === "terminal"
          ? "successor_not_required"
          : "successor_source_unverifiable",
    exitCode: 0,
    project: {
      projectId: status.projectId,
      projectTruthHash: status.projectTruthHash,
      overall: status.overall,
    },
    completionContinuity,
    unmodeledCandidates: drifted
      ? [{
          candidateId: "workspace-drift",
          kind: "workspace_source_delta",
          targetWorkspaceRef: targetRoot,
          baselineFingerprint: completionContinuity.baseline.workspaceSnapshotFingerprint,
          currentFingerprint: completionContinuity.current.workspaceSnapshotFingerprint,
          changedPaths,
          changedPathCount: completionContinuity.delta.changedPathCount,
          changedPathsTruncated: completionContinuity.delta.changedPathsTruncated,
          pathEvidenceComplete: completionContinuity.delta.pathEvidenceComplete,
        }]
      : [],
    pathConflicts,
    possibleLanes,
    draft: {
      projectId: null,
      objective: null,
      workItems: possibleLanes.map(lane => ({
        draftLaneId: lane.laneId,
        title: null,
        ownedPaths: [...lane.suggestedOwnedPaths],
        ownerAgentId: null,
      })),
      requiresHumanConfirmation: [
        "project_id",
        "objective",
        "work_item_boundaries",
        "owners",
        "acceptance",
      ],
    },
    nextAction: completionContinuity.nextAction,
    persisted: false,
    readOnly: true,
    writesPerformed: false,
    authorityBoundary: { ...AUTHORITY_BOUNDARY },
    authorizationGranted: false,
  };
}

export function formatSuccessorScaffoldHumanV1(scaffold) {
  const continuity = scaffold.completionContinuity;
  const lines = [
    `Successor review: ${scaffold.status}`,
    `Project: ${scaffold.project.projectId} (${scaffold.project.overall})`,
    `Continuity: ${continuity.disposition}`,
    `Source: ${continuity.targetWorkspaceRef ?? "not bound"}`,
    `Unmodeled paths: ${scaffold.unmodeledCandidates[0]?.changedPathCount ?? 0}`,
    `Possible lanes: ${scaffold.possibleLanes.length}; conflicts: ${scaffold.pathConflicts.length}`,
    `Next: ${scaffold.nextAction ?? "stop; no successor is currently indicated"}`,
    "Read-only: yes; project/event writes: 0; Agent dispatch: false.",
    "Authorization: Git/release/deployment/production/business remain false.",
    "",
  ];
  return lines.join("\n");
}
