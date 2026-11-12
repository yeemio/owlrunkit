import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync, closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync,
  readFileSync, realpathSync, rmSync, statfsSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const BUBBLEWRAP_PEER_BACKEND = "linux_bubblewrap_seccomp_v1";

const SANDBOX_HELPER = "/owlrunkit-helper";
const SANDBOX_WORKER = "/owlrunkit-worker";
const WORK = "/work";
const SYSTEM_BWRAP = "/usr/bin/bwrap";
const FD_EXECUTABLE = "/proc/self/fd/3";
const OVERFLOW_UID = 65534;
const PROC_SUPER_MAGIC = 0x9fa0;
const CAP_SYS_ADMIN = 1n << 21n;
const MAX_EXECUTABLE_BYTES = 1024 * 1024;

function rootOwnedPath(file, stat) {
  if (stat.uid !== 0) return false;
  let parent = path.dirname(file);
  for (;;) {
    const entry = lstatSync(parent);
    if (!entry.isDirectory() || entry.uid !== 0 || (entry.mode & 0o022)) return false;
    const next = path.dirname(parent);
    if (parent === next) return true;
    parent = next;
  }
}

export function readOnlySystemBubblewrapIssue({ uid, uidMap, root, systemDirectories, mountId, mountInfo }) {
  if (uid === 0 || uid === OVERFLOW_UID || uidMap.trim().split(/\s+/u).join(" ") !== `${uid} 0 1`) {
    return "the caller is not the single mapped parent root UID";
  }
  if (!root.isDirectory() || root.uid !== uid || (root.mode & 0o022)
    || !systemDirectories.every(entry =>
      entry.isDirectory() && entry.uid === OVERFLOW_UID && !(entry.mode & 0o022))) {
    return "the system directories do not match the remapped ownership boundary";
  }

  const mounts = mountInfo.trim().split("\n").map(line => {
    const [description, filesystem] = line.split(" - ");
    const [id, , device, root, target, flags] = description.split(" ");
    return { id, device, root, target, flags: flags?.split(",") ?? [], type: filesystem?.split(" ")[0] };
  });
  const system = mounts.find(mount => mount.id === mountId);
  if (system?.target !== "/usr" || system.type !== "overlay" || !system.root?.startsWith("/")
    || !["ro", "nosuid", "nodev"].every(flag => system.flags.includes(flag))) {
    return "the opened executable is not on the protected read-only /usr mount";
  }

  // Mount roots use paths within the same filesystem. A writable mount
  // exposes the protected tree only when their roots overlap.
  const systemPrefix = system.root === "/" ? "/" : `${system.root}/`;
  if (mounts.some(mount => {
    if (mount.device !== system.device || !mount.flags.includes("rw")) return false;
    if (!mount.root?.startsWith("/")) return true;
    const prefix = mount.root === "/" ? "/" : `${mount.root}/`;
    return prefix.startsWith(systemPrefix) || systemPrefix.startsWith(prefix);
  })) {
    return "the /usr mount has a writable alias";
  }
  return null;
}

function readOnlySystemPathIssue(file, stat, fd) {
  if (file !== SYSTEM_BWRAP || stat.uid !== OVERFLOW_UID || process.getuid() !== process.geteuid()) {
    return "the executable is outside the remapped system path";
  }
  if (statfsSync("/proc/self").type !== PROC_SUPER_MAGIC) return "the kernel mount information is unavailable";
  const capabilities = /^CapPrm:\s*([0-9a-f]+)$/imu.exec(readFileSync("/proc/self/status", "utf8"))?.[1];
  if (!capabilities || (BigInt(`0x${capabilities}`) & CAP_SYS_ADMIN)) {
    return "the caller can reconfigure its system mounts or that capability could not be checked";
  }
  const mountId = /^mnt_id:\s*(\d+)$/mu.exec(readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"))?.[1];
  if (!mountId) return "the kernel did not identify the executable mount";
  return readOnlySystemBubblewrapIssue({
    uid: process.geteuid(),
    uidMap: readFileSync("/proc/self/uid_map", "utf8"),
    root: lstatSync("/"),
    systemDirectories: [lstatSync("/usr"), lstatSync("/usr/bin")],
    mountId,
    mountInfo: readFileSync("/proc/self/mountinfo", "utf8"),
  });
}

function openTrustedBubblewrap(expected) {
  const directories = ["/usr/bin", "/bin", "/usr/local/bin", ...(process.env.PATH ?? "").split(":")];
  const candidates = expected ? [expected.executable]
    : [...new Set(directories)].filter(path.isAbsolute).map(dir => path.join(dir, "bwrap"));
  let systemRejection;
  for (const candidate of candidates) {
    let fd;
    let trusted = false;
    try {
      const executable = realpathSync(candidate);
      if (expected && executable !== expected.executable) continue;
      accessSync(executable, constants.X_OK);
      fd = openSync(executable, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || (stat.mode & 0o6022) || stat.size > MAX_EXECUTABLE_BYTES) continue;
      let trust = "root_owned";
      if (!rootOwnedPath(executable, stat)) {
        const issue = readOnlySystemPathIssue(executable, stat, fd);
        if (issue) {
          if (executable === SYSTEM_BWRAP) systemRejection = issue;
          continue;
        }
        trust = "read_only_system_mount";
      }
      const sandboxDigest = `sha256:${createHash("sha256").update(readFileSync(fd)).digest("hex")}`;
      if (expected && (expected.sandboxDigest !== sandboxDigest || expected.trust !== trust)) continue;
      trusted = true;
      return { executable, fd, sandboxDigest, trust };
    } catch (error) {
      if (!["ENOENT", "EACCES", "ENOTDIR", "ELOOP"].includes(error.code)) throw error;
    } finally {
      if (fd !== undefined && !trusted) closeSync(fd);
    }
  }
  return { reason: ["trusted system Bubblewrap not found", systemRejection].filter(Boolean).join(": ") };
}

export function spawnBubblewrapPeer(backend, args, options) {
  const launcher = openTrustedBubblewrap(backend);
  if (launcher.fd === undefined) {
    throw new Error(`Bubblewrap executable or trust changed after its self-test: ${launcher.reason}`);
  }
  try {
    return spawn(FD_EXECUTABLE, args, { ...options, stdio: [...options.stdio, launcher.fd] });
  } finally {
    closeSync(launcher.fd);
  }
}

export function bubblewrapPeerArgs({ helper, directory, worker, args, environment }) {
  return [
    "--unshare-user", "--new-session", "--die-with-parent", "--clearenv", "--cap-drop", "ALL",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/usr/lib", "/usr/lib",
    "--ro-bind-try", "/usr/lib64", "/usr/lib64",
    "--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache",
    "--dev-bind", "/dev/null", "/dev/null",
    "--ro-bind", helper, SANDBOX_HELPER,
    "--ro-bind", worker, SANDBOX_WORKER,
    "--bind", directory, WORK, "--remount-ro", "/", "--chdir", WORK,
    ...Object.entries({ ...environment, TMPDIR: WORK, OPENSSL_CONF: "/dev/null" })
      .flatMap(([key, value]) => ["--setenv", key, value]),
    "--", SANDBOX_HELPER, "run-bwrap", SANDBOX_WORKER, ...args,
  ];
}

const probeWorker = `
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const net = require('node:net');
  const { spawnSync } = require('node:child_process');
  assert.equal(process.cwd(), '/work');
  assert.equal(fs.readFileSync('probe-input', 'utf8'), 'from host');
  assert.throws(() => fs.readFileSync(process.argv[1]), { code: 'ENOENT' });
  assert.throws(() => fs.writeFileSync('/probe-outside-work', 'no'), { code: 'EROFS' });
  assert.equal(spawnSync(process.execPath, ['--version']).error?.code, 'EPERM');
  const server = net.createServer();
  server.once('error', error => {
    assert.equal(error.code, 'EPERM');
    fs.writeFileSync('probe-result', 'confined');
  });
  server.listen(0, '127.0.0.1', () => {
    server.close();
    throw new Error('socket unexpectedly succeeded');
  });
`;

export function probeBubblewrapPeer(helper) {
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), "owlrunkit-bwrap-probe-"));
  let launcher;
  try {
    launcher = openTrustedBubblewrap();
    if (launcher.fd === undefined) return { available: false, reason: launcher.reason };
    const outside = path.join(directory, "outside");
    const work = path.join(directory, "work");
    writeFileSync(outside, "outside", { flag: "wx", mode: 0o600 });
    // Keep the sentinel outside the only writable bind.
    const scratch = mkdtempSync(work);
    writeFileSync(path.join(scratch, "probe-input"), "from host", { flag: "wx", mode: 0o600 });
    const result = spawnSync(FD_EXECUTABLE, bubblewrapPeerArgs({
      helper, directory: scratch, worker: realpathSync(process.execPath),
      args: ["-e", probeWorker, outside], environment: {},
    }), {
      cwd: scratch, env: {}, stdio: ["ignore", "ignore", "pipe", launcher.fd],
      encoding: "utf8", timeout: 5000, maxBuffer: 65536,
    });
    if (result.status !== 0) {
      return { available: false, reason: result.stderr?.trim() || result.error?.code
        || `Bubblewrap self-test exited ${result.status}` };
    }
    const confirmation = path.join(scratch, "probe-result");
    if (readFileSync(confirmation, "utf8") !== "confined") {
      return { available: false, reason: "Bubblewrap self-test did not confirm enforcement" };
    }
    const { executable, sandboxDigest, trust } = launcher;
    return { available: true, id: BUBBLEWRAP_PEER_BACKEND, executable, sandboxDigest, trust, helper };
  } catch (error) {
    return { available: false, reason: `Bubblewrap self-test failed: ${error.code ?? error.message}` };
  } finally {
    if (launcher?.fd !== undefined) closeSync(launcher.fd);
    rmSync(directory, { recursive: true, force: true });
  }
}
