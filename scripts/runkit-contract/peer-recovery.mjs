import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readSync, readdirSync, realpathSync, unlinkSync,
  watch, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { RUNTIME_ROOT, currentCoreIdentity } from "./core-contract.mjs";
import { safeIdentifier } from "./provenance-common.mjs";
import { resolveVerificationEnvelopeBackendV1 } from "./verification-envelope.mjs";

const SCHEMA = "OwlRunKitPeerRecoveryRevisionV1";
const CHECKPOINT_LIMIT = 1024 * 1024;
const RECORD_LIMIT = 2 * CHECKPOINT_LIMIT;
const MAX_REVISIONS = 4096;
const REVISION_NAME = /^([0-9]{6})\.json$/u;

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function realDirectory(ref) {
  if (!lstatSync(ref).isDirectory() || realpathSync(ref) !== ref) {
    throw new Error("peer_recovery_redirected_directory");
  }
  return ref;
}

function directoryBelow(root, segments, create) {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (create && !existsSync(current)) {
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    realDirectory(current);
  }
  return current;
}

function taskDirectory(workspaceRoot, taskId, create = false) {
  safeIdentifier(taskId, "peer recovery task");
  const root = realpathSync(workspaceRoot);
  const runtime = directoryBelow(root, RUNTIME_ROOT.split("/"), false);
  const directory = directoryBelow(runtime, ["peer-recovery", taskId], create);
  return { root, directory, taskId, core: currentCoreIdentity() };
}

function regularBytes(ref, limit) {
  const stat = lstatSync(ref);
  if (!stat.isFile() || stat.size > limit || realpathSync(ref) !== ref) {
    throw new Error("peer_recovery_invalid_file");
  }
  const fd = openSync(ref, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = readSync(fd, buffer, length, buffer.length - length, null);
      if (bytes === 0) break;
      length += bytes;
    }
    if (length > limit) throw new Error("peer_recovery_file_too_large");
    return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}

function revisionPath(task, revision) {
  return path.join(task.directory, `${String(revision).padStart(6, "0")}.json`);
}

function readRevision(task, revision) {
  const record = JSON.parse(regularBytes(revisionPath(task, revision), RECORD_LIMIT).toString("utf8"));
  if (record.schemaVersion !== SCHEMA || record.workspaceRoot !== task.root
    || record.taskId !== task.taskId || record.revision !== revision
    || record.authorizationGranted !== false || !Number.isSafeInteger(record.generation)
    || record.generation < 1 || !Number.isSafeInteger(record.checkpointRevision)
    || record.checkpointRevision < 1 || record.checkpointRevision > revision
    || !["ready", "running", "exited", "completed"].includes(record.phase)
    || JSON.stringify(validatePaths(record.paths)) !== JSON.stringify(record.paths)) {
    throw new Error("peer_recovery_revision_invalid");
  }
  if (record.core?.coreManifestSha256 !== task.core.coreManifestSha256
    || record.core?.coreVersion !== task.core.coreVersion) {
    throw new Error("peer_recovery_core_pin_mismatch");
  }
  safeIdentifier(record.owner, "recorded current peer");
  safeIdentifier(record.successor, "recorded successor peer");
  return record;
}

function current(task) {
  const revisions = readdirSync(task.directory).map(name => REVISION_NAME.exec(name))
    .filter(Boolean).map(match => Number(match[1])).sort((a, b) => a - b);
  if (revisions.length === 0) throw new Error("peer_recovery_task_uninitialized");
  if (revisions.some((revision, index) => revision !== index + 1)) {
    throw new Error("peer_recovery_revision_gap");
  }
  return readRevision(task, revisions.length);
}

// Exactly one contender can link the next revision. A crash before the link
// leaves only ignored scratch, and after the link the whole transition is visible.
function append(task, previous, fields) {
  const revision = (previous?.revision ?? 0) + 1;
  if (revision > MAX_REVISIONS) throw new Error("peer_recovery_revision_limit");
  const record = {
    ...previous, files: undefined, ...fields,
    schemaVersion: SCHEMA, workspaceRoot: task.root, taskId: task.taskId, core: task.core,
    revision, recordedAt: new Date().toISOString(), authorizationGranted: false,
  };
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
  if (bytes.length > RECORD_LIMIT) throw new Error("peer_recovery_record_too_large");
  const scratch = path.join(task.directory, `.tmp-${randomUUID()}`);
  const fd = openSync(scratch, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    try { linkSync(scratch, revisionPath(task, revision)); }
    catch (error) { if (error.code === "EEXIST") return null; throw error; }
    const directoryFd = openSync(task.directory, "r");
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    return record;
  } finally { closeSync(fd); unlinkSync(scratch); }
}

function validatePaths(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 64) {
    throw new Error("peer_recovery_paths_required");
  }
  const normalized = paths.map(ref => {
    if (typeof ref !== "string" || ref.length > 240 || /[\\:\p{Cc}]/u.test(ref)
      || ref.split("/").some(part => !part || part === "." || part === ".."
        || /^(?:\.git|\.owlcoda|node_modules)$/iu.test(part))) {
      throw new Error("peer_recovery_invalid_path");
    }
    return ref;
  }).sort();
  const folded = normalized.map(ref => ref.normalize("NFC").toLowerCase()).sort();
  if (folded.some((ref, index) => index && (ref === folded[index - 1]
    || folded.some(parent => ref.startsWith(`${parent}/`))))) {
    throw new Error("peer_recovery_overlapping_paths");
  }
  return normalized;
}

function checkedFiles(paths, input) {
  if (!Array.isArray(input) || input.length !== paths.length) {
    throw new Error("peer_recovery_checkpoint_paths_mismatch");
  }
  let bytes = 0;
  const files = paths.map((ref, index) => {
    const item = input[index];
    if (item?.path !== ref || (item.content !== null && typeof item.content !== "string")) {
      throw new Error("peer_recovery_checkpoint_paths_mismatch");
    }
    if (item.content !== null) {
      const content = Buffer.from(item.content, "base64");
      if (content.toString("base64") !== item.content) throw new Error("peer_recovery_checkpoint_base64_invalid");
      bytes += content.length;
      if (bytes > CHECKPOINT_LIMIT) throw new Error("peer_recovery_checkpoint_too_large");
    }
    return { path: ref, content: item.content };
  });
  return { files, sha256: digest(JSON.stringify(files)) };
}

function initialFile(root, ref) {
  const target = path.join(root, ref);
  try {
    const content = regularBytes(target, CHECKPOINT_LIMIT).toString("base64");
    return { path: ref, content };
  } catch (error) {
    if (error.code === "ENOENT") return { path: ref, content: null };
    throw error;
  }
}

function checkpoint(task, state) {
  const source = readRevision(task, state.checkpointRevision);
  const result = checkedFiles(state.paths, source.files);
  if (result.sha256 !== state.checkpointSha256) throw new Error("peer_recovery_checkpoint_drift");
  return result;
}

function projection(task, state) {
  const { files: _files, ...record } = state;
  return {
    ...record, checkpointPath: revisionPath(task, state.checkpointRevision),
    status: state.event, exitCode: 0, authorizationGranted: false,
  };
}

function requireBackend() {
  const backend = resolveVerificationEnvelopeBackendV1();
  if (!backend.available) throw new Error("peer_recovery_enforced_backend_unavailable");
  return backend;
}

export function createPeerRecoveryTask({ workspaceRoot, taskId, owner, successor, paths }) {
  requireBackend();
  safeIdentifier(owner, "initial peer");
  safeIdentifier(successor, "successor peer");
  if (owner === successor) throw new Error("peer_recovery_requires_distinct_peers");
  const ownedPaths = validatePaths(paths);
  const root = realpathSync(workspaceRoot);
  const initial = checkedFiles(ownedPaths, ownedPaths.map(ref => initialFile(root, ref)));
  const task = taskDirectory(root, taskId, true);
  const created = append(task, null, {
    generation: 1, owner, successor, paths: ownedPaths, phase: "ready", attempt: null,
    wake: null, event: "peer_task_ready", checkpointRevision: 1,
    checkpointSha256: initial.sha256, files: initial.files,
  });
  if (!created) throw new Error("peer_recovery_task_already_exists");
  return projection(task, created);
}

export function inspectPeerRecoveryTask({ workspaceRoot, taskId }) {
  const task = taskDirectory(workspaceRoot, taskId);
  return projection(task, current(task));
}

function observe(task, examine, timeoutMs) {
  return new Promise((resolve, reject) => {
    let watcher, timer, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watcher?.close();
      if (error) reject(error);
      else resolve(value);
    };
    const check = () => {
      try {
        const value = examine(current(task));
        if (value) finish(null, value);
      } catch (error) { finish(error); }
    };
    try {
      watcher = watch(task.directory, check);
      watcher.once("error", finish);
      timer = setTimeout(() => { check(); finish(null, null); }, timeoutMs);
      check();
    } catch (error) { finish(error); }
  });
}

export async function recoverPeerTask({ workspaceRoot, taskId, agent, generation, revision, waitMs = 5000 }) {
  requireBackend();
  safeIdentifier(agent, "successor peer");
  if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(revision)
    || revision < 1 || !Number.isInteger(waitMs)
    || waitMs < 100 || waitMs > 60000) throw new Error("peer_recovery_invalid_request");
  const task = taskDirectory(workspaceRoot, taskId);
  let requestedWakeId;
  for (;;) {
    const state = current(task);
    if (state.generation !== generation) {
      if (state.generation === generation + 1 && state.owner === agent) return projection(task, state);
      throw new Error("peer_recovery_generation_changed");
    }
    if (state.successor !== agent) throw new Error("peer_recovery_successor_mismatch");
    if (state.phase === "completed") return projection(task, state);
    if (state.wake?.observed && (state.wake.id === requestedWakeId
      || state.wake.requestedFromRevision === revision)) return projection(task, state);
    if (state.phase === "running" && (!state.wake || state.wake.observed)) {
      if (state.revision !== revision) throw new Error("peer_recovery_observation_stale");
      const wake = { id: randomUUID(), requestedFromRevision: revision,
        deadline: Date.now() + waitMs, observed: false };
      if (append(task, state, { wake, event: "peer_wake_requested" })) requestedWakeId = wake.id;
      continue;
    }
    if (state.wake && !state.wake.observed && state.wake.requestedFromRevision === revision) {
      requestedWakeId = state.wake.id;
    }
    if (state.revision !== revision && (!requestedWakeId || state.wake?.id !== requestedWakeId)) {
      throw new Error("peer_recovery_observation_stale");
    }
    if (state.phase === "running" && Date.now() < state.wake.deadline) {
      requestedWakeId = state.wake.id;
      await observe(task, next => next.generation !== generation || next.phase !== "running"
        || next.wake?.id !== requestedWakeId || next.wake.observed,
      Math.max(1, state.wake.deadline - Date.now()));
      continue;
    }
    checkpoint(task, state);
    const replacement = append(task, state, {
      owner: agent, successor: state.owner, generation: generation + 1,
      phase: "ready", attempt: null, wake: null, processExit: null, event: "peer_takeover_ready",
      recovery: {
        fromGeneration: generation, fromAgent: state.owner, previousAttempt: state.attempt,
        wakeId: state.wake?.id ?? null,
        evidence: state.phase === "running" ? "wake_unconfirmed_isolated"
          : state.phase === "exited" ? "managed_process_exited" : "attempt_not_started",
      },
    });
    if (replacement) return projection(task, replacement);
  }
}

function materialize(files, directory) {
  for (const file of files) {
    if (file.content === null) continue;
    const ref = path.join(directory, file.path);
    mkdirSync(path.dirname(ref), { recursive: true, mode: 0o700 });
    writeFileSync(ref, Buffer.from(file.content, "base64"), { flag: "wx", mode: 0o600 });
  }
}

function sandboxPolicy(executable, directory) {
  // Only the host process receives control-store access. The worker inherits
  // pipes, never a writable descriptor into the project or the next attempt.
  return [
    "(version 1)", "(allow default)", "(deny file-write*)", "(deny file-read-data)",
    `(allow file-read-data file-write* (subpath ${JSON.stringify(directory)}))`,
    `(allow file-read-data (literal ${JSON.stringify(executable)}))`,
    '(allow file-read-data (literal "/") (subpath "/System") (subpath "/usr/lib"))',
    "(deny network*)", "(deny mach-lookup)", "(deny signal)", "(deny process-fork)", "(deny process-exec)",
    `(allow process-exec (literal ${JSON.stringify(executable)}))`,
  ].join("\n");
}

function reportCheckpoint(task, attemptId, message) {
  for (;;) {
    const state = current(task);
    if (state.phase !== "running" || state.attempt?.id !== attemptId) return false;
    const value = checkedFiles(state.paths, message.files);
    const finish = message.type === "finish";
    const changed = value.sha256 !== state.checkpointSha256;
    if (!finish && !changed) return true;
    const observed = changed && state.wake?.id === message.wakeId && state.wake !== null;
    if (append(task, state, {
      files: value.files, checkpointRevision: state.revision + 1, checkpointSha256: value.sha256,
      wake: observed ? { ...state.wake, observed: true } : state.wake,
      phase: finish ? "completed" : "running",
      event: finish ? "peer_task_completed" : observed ? "peer_wake_progress_observed" : "peer_checkpoint_recorded",
    })) return true;
  }
}

function reportExit(task, attemptId, processExit) {
  for (;;) {
    const state = current(task);
    if (state.attempt?.id !== attemptId) {
      return { ...projection(task, state), status: "peer_attempt_superseded", exitCode: 2 };
    }
    if (state.phase !== "running") return projection(task, state);
    const next = append(task, state, {
      phase: "exited", event: "peer_attempt_exited", processExit,
    });
    if (next) return { ...projection(task, next), exitCode: 2 };
  }
}

export async function runPeerTask({ workspaceRoot, taskId, agent, generation, command }) {
  const backend = requireBackend();
  safeIdentifier(agent, "current peer");
  if (!Array.isArray(command) || !path.isAbsolute(command[0] ?? "")) {
    throw new Error("peer_recovery_absolute_worker_required");
  }
  const executable = realpathSync(command[0]);
  if (!lstatSync(executable).isFile()) throw new Error("peer_recovery_worker_invalid");
  const task = taskDirectory(workspaceRoot, taskId);
  const state = current(task);
  if (state.phase !== "ready" || state.owner !== agent || state.generation !== generation) {
    throw new Error("peer_recovery_attempt_not_available");
  }
  const id = randomUUID();
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), "owlrunkit-peer-"));
  materialize(checkpoint(task, state).files, directory);
  const attempt = { id, directory, backend: backend.id };
  const claimed = append(task, state, {
    attempt, phase: "running", processExit: null, event: "peer_attempt_started",
  });
  if (!claimed) throw new Error("peer_recovery_attempt_already_claimed");

  return new Promise((resolve, reject) => {
    const child = spawn(backend.executable, ["-p", sandboxPolicy(executable, directory),
      executable, ...command.slice(1)], {
      cwd: directory, env: {
        PATH: "/usr/bin:/bin", TMPDIR: directory, OWLRUNKIT_PEER_ATTEMPT: id,
        OWLRUNKIT_PEER_PATHS: JSON.stringify(state.paths),
      }, stdio: ["pipe", "pipe", "pipe"],
    });
    let watcher, pending = Buffer.alloc(0), sentWake, protocolError = null;
    let diagnostic = Buffer.alloc(0);
    const stop = error => {
      protocolError ??= error.message;
      child.kill("SIGKILL");
    };
    const wake = () => {
      try {
        const live = current(task);
        if (live.attempt?.id !== id || live.phase !== "running") return;
        if (live.wake && !live.wake.observed && live.wake.id !== sentWake) {
          sentWake = live.wake.id;
          child.stdin.write(`${JSON.stringify({ type: "wake", wakeId: sentWake })}\n`);
        }
      } catch (error) { stop(error); }
    };
    child.stdin.on("error", error => { if (error.code !== "EPIPE") stop(error); });
    child.stderr.on("data", chunk => {
      const remaining = 4096 - diagnostic.length;
      if (remaining > 0) diagnostic = Buffer.concat([diagnostic, chunk.subarray(0, remaining)]);
    });
    child.stdout.on("data", chunk => {
      if (protocolError) return;
      try {
        pending = Buffer.concat([pending, chunk]);
        let end;
        while ((end = pending.indexOf(10)) >= 0) {
          if (end > RECORD_LIMIT) throw new Error("peer_recovery_worker_message_too_large");
          const message = JSON.parse(pending.subarray(0, end).toString("utf8"));
          pending = pending.subarray(end + 1);
          if (message?.type === "ack") continue;
          if (!new Set(["checkpoint", "finish"]).has(message?.type)) {
            throw new Error("peer_recovery_worker_message_invalid");
          }
          reportCheckpoint(task, id, message);
        }
        if (pending.length > RECORD_LIMIT) throw new Error("peer_recovery_worker_message_too_large");
      } catch (error) { stop(error); }
    });
    child.once("error", error => { protocolError ??= error.message; });
    child.once("close", (code, signal) => {
      watcher?.close();
      try { resolve(reportExit(task, id, { code, signal, protocolError,
        diagnostic: diagnostic.toString("utf8") || null })); }
      catch (error) { reject(error); }
    });
    try {
      watcher = watch(task.directory, wake);
      watcher.once("error", stop);
      wake();
    } catch (error) { stop(error); }
  });
}
