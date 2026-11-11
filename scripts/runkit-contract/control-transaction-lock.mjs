import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { linuxRuntimeHelper } from "./linux-runtime.mjs";

const LOCK = "control.lock";
const GUARD = "control.lock.guard";
const TEMP_PREFIX = ".control-lock-";
const SCHEMA = "OwlRunKitControlLockV1";
const ACTIVE = "Another RunKit control transaction is already active.";

function fileIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

function controlStateDigest(root) {
  const hash = createHash("sha256");
  function visit(directory, prefix) {
    for (const name of readdirSync(directory).sort()) {
      if (!prefix && (name === LOCK || name === GUARD || name === "peer-recovery"
        || name.startsWith(TEMP_PREFIX))) continue;
      const absolute = path.join(directory, name);
      const relative = `${prefix}${name}`;
      const stat = lstatSync(absolute, { bigint: true });
      hash.update(JSON.stringify([
        relative, fileIdentity(stat), String(stat.mode), String(stat.size),
        String(stat.mtimeNs), String(stat.ctimeNs),
      ]) + "\n");
      if (stat.isDirectory()) visit(absolute, `${relative}/`);
    }
  }
  visit(root, "");
  return hash.digest("hex");
}

function recoverInterruptedLock(root, lockPath, guard) {
  let stat;
  try { stat = lstatSync(lockPath); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  // Releases without an ownership record still use a directory at this
  // path. Its presence alone cannot establish who owns it or if it is stale.
  if (!stat.isFile() || stat.size > 1024) throw new Error(ACTIVE);
  const fd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let previous;
  try { previous = JSON.parse(readFileSync(fd, "utf8")); }
  finally { closeSync(fd); }
  if (previous?.schemaVersion !== SCHEMA || previous.guard !== guard
    || !["atomic-lease", "control-state"].includes(previous.kind)) throw new Error(ACTIVE);
  if (previous.kind === "control-state" && previous.before !== controlStateDigest(root)) {
    throw new Error("runkit_control_reconciliation_required: interrupted transaction changed control state.");
  }
  unlinkSync(lockPath);
}

function acquireLinuxLock(root, lockPath, helper, kind) {
  const guardPath = path.join(root, GUARD);
  const fd = openSync(guardPath,
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const guardStat = fstatSync(fd, { bigint: true });
    if (!guardStat.isFile() || guardStat.nlink !== 1n) throw new Error("Invalid RunKit control lock guard.");
    const result = spawnSync(helper, ["lock"], {
      env: {}, timeout: 3000, stdio: ["ignore", "ignore", "pipe", fd], encoding: "utf8",
    });
    if (result.status === 73) throw new Error(ACTIVE);
    if (result.status !== 0) {
      throw new Error(`RunKit control lock unavailable: ${result.stderr?.trim() || result.error?.code}`);
    }
    // The helper locks the open description shared with this process. Keep
    // the descriptor open until the transaction ends or the kernel reaps it.
    const guard = fileIdentity(guardStat);
    if (fileIdentity(lstatSync(guardPath, { bigint: true })) !== guard) {
      throw new Error("RunKit control lock guard was replaced.");
    }
    recoverInterruptedLock(root, lockPath, guard);
    const record = { schemaVersion: SCHEMA, guard, kind,
      before: kind === "control-state" ? controlStateDigest(root) : null };
    const scratch = path.join(root, `${TEMP_PREFIX}${randomUUID()}`);
    const marker = openSync(scratch, "wx", 0o600);
    try {
      writeFileSync(marker, JSON.stringify(record));
      fsyncSync(marker);
      try { linkSync(scratch, lockPath); }
      catch (error) { if (error.code === "EEXIST") throw new Error(ACTIVE); throw error; }
    } finally { closeSync(marker); unlinkSync(scratch); }
    return () => {
      try { unlinkSync(lockPath); }
      finally { closeSync(fd); }
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function acquireRunKitControlLock(root, { atomicLease = false } = {}) {
  const lockPath = path.join(root, LOCK);
  const helper = linuxRuntimeHelper();
  if (helper) return acquireLinuxLock(root, lockPath, helper, atomicLease ? "atomic-lease" : "control-state");
  try { mkdirSync(lockPath); }
  catch (error) { if (error.code === "EEXIST") throw new Error(ACTIVE); throw error; }
  return () => rmdirSync(lockPath);
}
