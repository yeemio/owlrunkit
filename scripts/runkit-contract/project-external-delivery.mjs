import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { captureWorkspaceSnapshot } from "./quick-workspace-snapshot.mjs";
import {
  decodeUtf8Strict,
  readFileBytesBounded,
} from "../../packages/attest/src/formal.mjs";
import {
  quickSnapshotFingerprintValid,
  validWorkspaceSnapshotShape,
} from "../../packages/attest/src/quick-receipt-contract.mjs";
import { validateLeaseOwnedPaths } from "./core-contract.mjs";
import {
  relativeToWorkspace,
  safeIdentifier,
  writeJsonExclusiveAtomically,
} from "./provenance-common.mjs";
import { verifyDeliveryPacket } from "./source-fingerprint.mjs";
import { parseJsonStrict } from "./quick-canonical.mjs";
import {
  appendTeamProjectEventV1,
  normalizeTeamProjectDefinitionV1,
  readTeamProjectStatusV2,
  readTeamProjectStatusV3,
  teamProjectDefinitionBindingV1,
  withTeamProjectControlLockV1,
} from "./team-project.mjs";

const SNAPSHOT_SCHEMA = "OwlCodaRunKitTargetWorkspaceSnapshotV1";
const EVENT_SCHEMA = "OwlCodaRunKitTeamProjectEventV3";
const PROJECT_ROOT = ".owlcoda/runkit/project";
const SHA256 = /^[a-f0-9]{64}$/u;
const DEPENDENCY_ENVIRONMENT_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);
const TOOL_CACHE_SEGMENTS = new Set([
  ".cache",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".vite",
  ".vitest",
  "__pycache__",
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("External delivery artifact is not canonical JSON.");
  return encoded;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function artifactSha256(value) {
  return `sha256:${sha256(canonical(value))}`;
}

function validateTimestamp(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(
      `${label} must be an ISO-8601 UTC timestamp `
      + "(YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.sssZ).",
    );
  }
  return new Date(value).toISOString();
}

function compareIdentifiers(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareIdentifiers);
}

function pathPrefix(rule) {
  return rule.endsWith("/**") ? rule.slice(0, -3) : null;
}

function ruleCovers(rule, candidate) {
  if (rule === candidate) return true;
  const prefix = pathPrefix(rule);
  return prefix !== null && (candidate === prefix || candidate.startsWith(`${prefix}/`));
}

function allowedBy(filePath, rules) {
  return rules.some(rule => ruleCovers(rule, filePath));
}

function canonicalControllerRoot(workspaceRoot) {
  const requested = path.resolve(workspaceRoot);
  const stat = lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Controller workspace must be a real directory.");
  }
  return realpathSync(requested);
}

function canonicalTargetRoot(targetWorkspaceRoot) {
  const requested = path.resolve(targetWorkspaceRoot);
  const stat = lstatSync(requested);
  const resolved = realpathSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory() || resolved !== requested) {
    throw new Error(
      "Target workspace must be a real directory without symlink traversal. "
      + `Retry with --target-workspace '${resolved.replaceAll("'", `'\"'\"'`)}'.`,
    );
  }
  let gitRoot;
  try {
    gitRoot = realpathSync(execFileSync(
      "git",
      ["-C", resolved, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
    ).trim());
  } catch {
    throw new Error("Target workspace must be the exact Git worktree root.");
  }
  if (gitRoot !== resolved) {
    throw new Error(
      `Target workspace must be the exact Git worktree root: ${gitRoot}.`,
    );
  }
  return resolved;
}

function containedBy(parent, child) {
  const relative = path.relative(parent, child);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative));
}

function assertDisjointWorkspaces(controllerRoot, targetRoot) {
  if (containedBy(controllerRoot, targetRoot) || containedBy(targetRoot, controllerRoot)) {
    throw new Error(
      "Controller and target workspaces must be disjoint real directories.",
    );
  }
}

function readProjectDefinition(controllerRoot) {
  const definitionPath = path.join(controllerRoot, PROJECT_ROOT, "definition.json");
  const stat = lstatSync(definitionPath);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(definitionPath) !== definitionPath) {
    throw new Error("Team project definition must be a regular file without symlinks.");
  }
  return normalizeTeamProjectDefinitionV1(JSON.parse(readFileSync(definitionPath, "utf8")));
}

function resolveAllowedPaths(workItem, requested) {
  if (requested === undefined || requested.length === 0) return [...workItem.ownedPaths];
  const allowedPaths = validateLeaseOwnedPaths(requested);
  for (const rule of allowedPaths) {
    if (!workItem.ownedPaths.some(owner => (
      owner === rule
      || (pathPrefix(owner) !== null
        && (pathPrefix(rule) ?? rule) !== null
        && ruleCovers(owner, pathPrefix(rule) ?? rule))
    ))) {
      throw new Error(`Allowed target path is outside WorkItem ownership: ${rule}.`);
    }
  }
  return allowedPaths;
}

function stableWorkspaceSnapshot(targetRoot) {
  const before = captureWorkspaceSnapshot(targetRoot);
  const after = captureWorkspaceSnapshot(targetRoot);
  if (canonical(before) !== canonical(after)) {
    throw new Error("Target workspace changed while its snapshot was being captured.");
  }
  return after;
}

function ensureSnapshotRoot(controllerRoot) {
  const projectRoot = path.join(controllerRoot, PROJECT_ROOT);
  const projectStat = lstatSync(projectRoot);
  if (projectStat.isSymbolicLink()
    || !projectStat.isDirectory()
    || realpathSync(projectRoot) !== projectRoot) {
    throw new Error("Team project control root must be a regular directory without symlinks.");
  }
  const snapshotRoot = path.join(projectRoot, "target-snapshots");
  if (!existsSync(snapshotRoot)) mkdirSync(snapshotRoot);
  const stat = lstatSync(snapshotRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(snapshotRoot) !== snapshotRoot) {
    throw new Error("Target snapshot root must be a regular directory without symlinks.");
  }
  return snapshotRoot;
}

function snapshotBody({
  snapshotId,
  occurredAt,
  projectBinding,
  workItemId,
  targetRoot,
  allowedPaths,
  workspaceSnapshot,
}) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA,
    snapshotId,
    capturedAt: occurredAt,
    projectId: projectBinding.projectId,
    projectDefinitionSha256: projectBinding.projectDefinitionSha256,
    workItemId,
    targetWorkspaceRef: targetRoot,
    allowedPaths,
    workspaceSnapshot,
    targetWritePerformed: false,
    authorizationGranted: false,
  };
}

export function captureTargetWorkspaceSnapshotV1({
  controllerWorkspaceRoot,
  snapshotId,
  occurredAt,
  workItemId,
  targetWorkspaceRoot,
  allowedPaths,
  apply = false,
}) {
  safeIdentifier(snapshotId, "snapshotId");
  occurredAt = validateTimestamp(occurredAt, "Target snapshot capturedAt");
  const controllerRoot = canonicalControllerRoot(controllerWorkspaceRoot);
  const targetRoot = canonicalTargetRoot(targetWorkspaceRoot);
  assertDisjointWorkspaces(controllerRoot, targetRoot);
  const definition = readProjectDefinition(controllerRoot);
  const workItem = readTeamProjectStatusV3({ workspaceRoot: controllerRoot })
    .workItems.find(row => row.workItemId === workItemId);
  if (!workItem) throw new Error(`Unknown team project WorkItem: ${workItemId}.`);
  const projectBinding = teamProjectDefinitionBindingV1(definition);
  const selectedAllowedPaths = resolveAllowedPaths(workItem, allowedPaths);
  const body = snapshotBody({
    snapshotId,
    occurredAt,
    projectBinding,
    workItemId,
    targetRoot,
    allowedPaths: selectedAllowedPaths,
    workspaceSnapshot: stableWorkspaceSnapshot(targetRoot),
  });
  const artifact = { ...body, snapshotSha256: artifactSha256(body) };
  if (!apply) {
    return {
      status: "target_snapshot_preview",
      exitCode: 0,
      snapshotId,
      targetWorkspaceRef: targetRoot,
      targetHead: artifact.workspaceSnapshot.headCommit,
      workspaceSnapshotFingerprint: artifact.workspaceSnapshot.sourceFingerprint,
      allowedPaths: selectedAllowedPaths,
      snapshotSha256: artifact.snapshotSha256,
      persisted: false,
      targetWritePerformed: false,
      authorizationGranted: false,
    };
  }

  const persisted = withTeamProjectControlLockV1({
    workspaceRoot: controllerRoot,
    operation({ definitionBinding }) {
      if (canonical(definitionBinding) !== canonical(projectBinding)) {
        throw new Error("Team project identity changed before target snapshot persistence.");
      }
      const currentWorkItem = readTeamProjectStatusV3({ workspaceRoot: controllerRoot })
        .workItems.find(row => row.workItemId === workItemId);
      if (!currentWorkItem
        || canonical(resolveAllowedPaths(currentWorkItem, selectedAllowedPaths))
          !== canonical(selectedAllowedPaths)) {
        throw new Error("Team project WorkItem ownership changed before target snapshot persistence.");
      }
      const snapshotRoot = ensureSnapshotRoot(controllerRoot);
      const snapshotPath = path.join(snapshotRoot, `${snapshotId}.json`);
      let resumed = false;
      if (existsSync(snapshotPath)) {
        const existing = JSON.parse(readFileSync(snapshotPath, "utf8"));
        if (canonical(existing) !== canonical(artifact)) {
          throw new Error(`Immutable target snapshot differs: ${snapshotId}.`);
        }
        resumed = true;
      } else {
        writeJsonExclusiveAtomically(snapshotPath, artifact);
      }
      return { snapshotPath, resumed };
    },
  });
  return {
    status: "target_snapshot_captured",
    exitCode: 0,
    snapshotId,
    snapshotPath: relativeToWorkspace(controllerRoot, persisted.snapshotPath),
    targetWorkspaceRef: targetRoot,
    targetHead: artifact.workspaceSnapshot.headCommit,
    workspaceSnapshotFingerprint: artifact.workspaceSnapshot.sourceFingerprint,
    allowedPaths: selectedAllowedPaths,
    snapshotSha256: artifact.snapshotSha256,
    persisted: true,
    resumed: persisted.resumed,
    targetWritePerformed: false,
    authorizationGranted: false,
  };
}

function readPacket(packetPath) {
  const requested = path.resolve(packetPath);
  let loaded;
  try {
    loaded = readFileBytesBounded(requested);
  } catch {
    throw new Error("External DeliveryPacket must be a bounded regular file without symlinks.");
  }
  if (loaded.absolutePath !== requested) {
    throw new Error("External DeliveryPacket must be a bounded regular file without symlinks.");
  }
  return {
    packet: parseJsonStrict(decodeUtf8Strict(loaded.bytes)),
    bytes: loaded.bytes,
  };
}

function packetIdentity(packet) {
  const identity = {
    schemaVersion: packet.schemaVersion ?? "ExternalDeliveryPacket",
    changedFiles: packet.changedFiles,
  };
  if (packet.productSourceFingerprint !== undefined) {
    identity.productSourceFingerprint = packet.productSourceFingerprint;
  }
  if (packet.sourceFingerprint !== undefined) {
    identity.sourceFingerprint = packet.sourceFingerprint;
  }
  return identity;
}

function packetFiles(packet) {
  const files = packet.changedFiles?.files ?? packet.changedFiles?.wholeFileSha256;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("External DeliveryPacket changed file map is missing.");
  }
  return Object.entries(files)
    .map(([filePath, hash]) => ({ path: filePath, sha256: String(hash).toLowerCase() }))
    .sort((left, right) => compareIdentifiers(left.path, right.path));
}

function readEntrySnapshot(controllerRoot, snapshotId) {
  safeIdentifier(snapshotId, "entrySnapshotId");
  const snapshotPath = path.join(
    controllerRoot,
    PROJECT_ROOT,
    "target-snapshots",
    `${snapshotId}.json`,
  );
  const stat = lstatSync(snapshotPath);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(snapshotPath) !== snapshotPath) {
    throw new Error("Entry target snapshot must be a regular file without symlinks.");
  }
  const artifact = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const { snapshotSha256, ...body } = artifact;
  if (artifact.schemaVersion !== SNAPSHOT_SCHEMA
    || !/^sha256:[a-f0-9]{64}$/u.test(snapshotSha256)
    || snapshotSha256 !== artifactSha256(body)
    || !validWorkspaceSnapshotShape(artifact.workspaceSnapshot)
    || !quickSnapshotFingerprintValid(artifact.workspaceSnapshot)) {
    throw new Error("Entry target snapshot identity is invalid.");
  }
  return {
    artifact,
    ref: relativeToWorkspace(controllerRoot, snapshotPath),
  };
}

function overlayChanges(entrySnapshot, currentSnapshot) {
  const before = new Map(entrySnapshot.dirtyOverlay.map(row => [row.path, canonical(row)]));
  const after = new Map(currentSnapshot.dirtyOverlay.map(row => [row.path, canonical(row)]));
  return uniqueSorted([...before.keys(), ...after.keys()].filter(filePath => (
    before.get(filePath) !== after.get(filePath)
  )));
}

function baseIdentityChanges(entrySnapshot, currentSnapshot) {
  const changes = [];
  if (entrySnapshot.headCommit !== currentSnapshot.headCommit) {
    changes.push("head_commit_changed");
  }
  if (entrySnapshot.trackedTreeIdentity !== currentSnapshot.trackedTreeIdentity) {
    changes.push("tracked_tree_changed");
  }
  if (canonical(entrySnapshot.submodules) !== canonical(currentSnapshot.submodules)) {
    changes.push("submodules_changed");
  }
  return changes;
}

function toolCachePath(filePath) {
  const segments = filePath.split("/");
  if (segments.some(segment => TOOL_CACHE_SEGMENTS.has(segment))) return true;
  if (filePath.endsWith(".tsbuildinfo") || filePath.endsWith("/.eslintcache")) return true;
  return segments.includes(".next") && segments.includes("cache");
}

function dependencyEnvironmentPath(filePath) {
  const basename = path.posix.basename(filePath);
  return DEPENDENCY_ENVIRONMENT_NAMES.has(basename)
    || filePath === ".pnp.cjs"
    || filePath === ".pnp.loader.mjs"
    || filePath.startsWith("node_modules/");
}

function classifyOverlay({
  entry,
  currentSnapshot,
  candidateFiles,
  allowedPaths,
}) {
  const candidatePaths = candidateFiles.map(row => row.path);
  if (entry === null) {
    const disallowed = candidatePaths.filter(filePath => !allowedBy(filePath, allowedPaths));
    return {
      status: disallowed.length === 0 ? "candidate_only" : "rejected",
      overlayAttested: false,
      candidatePaths,
      changedPaths: [],
      toolCachePaths: [],
      dependencyEnvironmentPaths: [],
      unchangedPacketPaths: [],
      outOfScopeSourcePaths: uniqueSorted(disallowed),
      baseIdentityChanges: [],
    };
  }
  const changedPaths = overlayChanges(entry.workspaceSnapshot, currentSnapshot);
  const identityChanges = baseIdentityChanges(entry.workspaceSnapshot, currentSnapshot);
  const candidateSet = new Set(candidatePaths);
  const changedSet = new Set(changedPaths);
  const toolCachePaths = [];
  const dependencyEnvironmentPaths = [];
  const outOfScopeSourcePaths = candidatePaths.filter(filePath => !allowedBy(filePath, allowedPaths));
  for (const filePath of changedPaths) {
    if (candidateSet.has(filePath) && allowedBy(filePath, allowedPaths)) continue;
    if (toolCachePath(filePath)) toolCachePaths.push(filePath);
    else if (dependencyEnvironmentPath(filePath)) dependencyEnvironmentPaths.push(filePath);
    else outOfScopeSourcePaths.push(filePath);
  }
  const uniqueOutOfScope = uniqueSorted(outOfScopeSourcePaths);
  return {
    status: uniqueOutOfScope.length > 0 || identityChanges.length > 0
      ? "rejected"
      : toolCachePaths.length > 0 || dependencyEnvironmentPaths.length > 0
        ? "attested_with_non_source_changes"
        : "attested",
    overlayAttested: uniqueOutOfScope.length === 0 && identityChanges.length === 0,
    candidatePaths,
    changedPaths,
    toolCachePaths: uniqueSorted(toolCachePaths),
    dependencyEnvironmentPaths: uniqueSorted(dependencyEnvironmentPaths),
    unchangedPacketPaths: candidatePaths.filter(filePath => !changedSet.has(filePath)),
    outOfScopeSourcePaths: uniqueOutOfScope,
    baseIdentityChanges: identityChanges,
  };
}

function proofBoundary(overlay, { entrySnapshotSupplied }) {
  const proven = [
    "The DeliveryPacket candidate file hashes match the current target workspace.",
    "The target workspace was read twice without observed source drift.",
  ];
  const notProven = [
    "Test correctness, Git integration, release, deployment, and business acceptance were not proven.",
  ];
  if (overlay.overlayAttested) {
    proven.push("The entry-to-candidate visible Git dirty overlay contains no unclassified source delta.");
  } else if (!entrySnapshotSupplied) {
    notProven.unshift(
      "The entry-to-candidate dirty overlay was not proven because no entry snapshot was supplied.",
    );
  } else if (overlay.baseIdentityChanges.length > 0) {
    notProven.unshift(
      `The entry-to-candidate base identity changed: ${overlay.baseIdentityChanges.join(", ")}.`,
    );
  } else {
    notProven.unshift(
      "The entry-to-candidate dirty overlay was rejected because it contains out-of-scope or unclassified source changes.",
    );
  }
  return { proven, notProven };
}

function validateCurrentAssignment(controllerRoot, workItemId, assignmentId) {
  safeIdentifier(assignmentId, "assignmentId");
  const status = readTeamProjectStatusV2({ workspaceRoot: controllerRoot });
  const row = status.workItems.find(item => item.workItemId === workItemId);
  if (row?.assignmentId !== assignmentId) {
    throw new Error(
      `External delivery must bind the current assignment ${row?.assignmentId ?? "none"}.`,
    );
  }
  if (["completed", "failed"].includes(row.status)) {
    throw new Error(
      "External delivery requires a non-terminal WorkItem; use an explicit reopen or rework contract first.",
    );
  }
}

export function importExternalDeliveryV1({
  controllerWorkspaceRoot,
  deliveryId,
  occurredAt,
  assignmentId,
  workItemId,
  producerId,
  targetWorkspaceRoot,
  packetPath,
  entrySnapshotId = null,
  apply = false,
  onAfterPacketVerification,
}) {
  safeIdentifier(deliveryId, "deliveryId");
  safeIdentifier(producerId, "producerId");
  occurredAt = validateTimestamp(occurredAt, "External delivery occurredAt");
  const controllerRoot = canonicalControllerRoot(controllerWorkspaceRoot);
  const targetRoot = canonicalTargetRoot(targetWorkspaceRoot);
  assertDisjointWorkspaces(controllerRoot, targetRoot);
  const definition = readProjectDefinition(controllerRoot);
  const workItem = readTeamProjectStatusV3({ workspaceRoot: controllerRoot })
    .workItems.find(row => row.workItemId === workItemId);
  if (!workItem) throw new Error(`Unknown team project WorkItem: ${workItemId}.`);
  const projectBinding = teamProjectDefinitionBindingV1(definition);
  validateCurrentAssignment(controllerRoot, workItemId, assignmentId);
  const { packet, bytes } = readPacket(packetPath);
  const identity = packetIdentity(packet);
  const snapshotBeforeVerification = stableWorkspaceSnapshot(targetRoot);
  const packetGate = verifyDeliveryPacket({ workspaceRoot: targetRoot, packet: identity });
  if (packetGate.status !== "valid") {
    return {
      status: "external_delivery_rejected",
      exitCode: packetGate.exitCode,
      deliveryId,
      packetGate,
      persisted: false,
      targetWritePerformed: false,
      authorizationGranted: false,
    };
  }
  if (onAfterPacketVerification !== undefined) {
    if (typeof onAfterPacketVerification !== "function") {
      throw new Error("onAfterPacketVerification must be a function.");
    }
    onAfterPacketVerification();
  }
  const candidateFiles = packetFiles(identity);
  if (candidateFiles.some(row => !SHA256.test(row.sha256))) {
    throw new Error("External DeliveryPacket contains an invalid file hash.");
  }
  const currentSnapshot = stableWorkspaceSnapshot(targetRoot);
  if (canonical(snapshotBeforeVerification) !== canonical(currentSnapshot)) {
    throw new Error(
      "Target workspace changed while its DeliveryPacket was being verified.",
    );
  }
  const entry = entrySnapshotId === null
    ? null
    : readEntrySnapshot(controllerRoot, entrySnapshotId);
  if (entry && (
    entry.artifact.projectId !== projectBinding.projectId
    || entry.artifact.projectDefinitionSha256 !== projectBinding.projectDefinitionSha256
    || entry.artifact.workItemId !== workItemId
    || entry.artifact.targetWorkspaceRef !== targetRoot
    || entry.artifact.workspaceSnapshot.repositoryIdentity
      !== currentSnapshot.repositoryIdentity
  )) {
    throw new Error(
      "Entry target snapshot does not bind this project identity, WorkItem, and target repository.",
    );
  }
  const allowedPaths = entry
    ? resolveAllowedPaths(workItem, entry.artifact.allowedPaths)
    : workItem.ownedPaths;
  const overlay = classifyOverlay({
    entry: entry?.artifact ?? null,
    currentSnapshot,
    candidateFiles,
    allowedPaths,
  });
  const boundary = proofBoundary(overlay, { entrySnapshotSupplied: entry !== null });
  if (overlay.status === "rejected") {
    return {
      status: "external_delivery_rejected",
      exitCode: 2,
      deliveryId,
      packetGate,
      overlay,
      proven: boundary.proven,
      notProven: boundary.notProven,
      persisted: false,
      targetWritePerformed: false,
      authorizationGranted: false,
    };
  }

  const event = {
    schemaVersion: EVENT_SCHEMA,
    eventId: `source-delivery-${deliveryId}`,
    type: "source_delivery_imported",
    occurredAt,
    deliveryId,
    projectId: projectBinding.projectId,
    projectDefinitionSha256: projectBinding.projectDefinitionSha256,
    assignmentId,
    workItemId,
    producerId,
    targetWorkspaceRef: targetRoot,
    targetHead: currentSnapshot.headCommit,
    entrySnapshotRef: entry?.ref ?? null,
    entrySnapshotSha256: entry?.artifact.snapshotSha256 ?? null,
    deliveryPacketSha256: `sha256:${sha256(bytes)}`,
    deliveryCandidateFingerprint: packetGate.declaredFingerprint,
    workspaceSnapshotFingerprint: currentSnapshot.sourceFingerprint,
    overlayStatus: overlay.status,
    candidateFiles,
    changedPaths: overlay.changedPaths,
    toolCachePaths: overlay.toolCachePaths,
    dependencyEnvironmentPaths: overlay.dependencyEnvironmentPaths,
    unchangedPacketPaths: overlay.unchangedPacketPaths,
    outOfScopeSourcePaths: [],
    targetSnapshot: currentSnapshot,
    proven: boundary.proven,
    notProven: boundary.notProven,
    targetWritePerformed: false,
    authorizationGranted: false,
  };
  if (!apply) {
    return {
      status: "external_delivery_preview",
      exitCode: 0,
      deliveryId,
      workItemId,
      assignmentId,
      producerId,
      targetWorkspaceRef: targetRoot,
      deliveryCandidateFingerprint: packetGate.declaredFingerprint,
      workspaceSnapshotFingerprint: currentSnapshot.sourceFingerprint,
      overlay,
      proven: boundary.proven,
      notProven: boundary.notProven,
      persisted: false,
      targetWritePerformed: false,
      authorizationGranted: false,
    };
  }

  const recorded = appendTeamProjectEventV1({ workspaceRoot: controllerRoot, event });
  const status = readTeamProjectStatusV2({ workspaceRoot: controllerRoot });
  return {
    status: "external_delivery_imported",
    exitCode: 0,
    deliveryId,
    workItemId,
    assignmentId,
    producerId,
    targetWorkspaceRef: targetRoot,
    deliveryCandidateFingerprint: packetGate.declaredFingerprint,
    workspaceSnapshotFingerprint: currentSnapshot.sourceFingerprint,
    overlay,
    proven: boundary.proven,
    notProven: boundary.notProven,
    eventId: recorded.eventId,
    eventPath: recorded.eventPath,
    eventSha256: recorded.eventSha256,
    projectTruthHash: status.projectTruthHash,
    persisted: true,
    resumed: recorded.resumed,
    targetWritePerformed: false,
    authorizationGranted: false,
  };
}
