import { spawnSync } from "node:child_process";
import {
  accessSync, constants, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const BUBBLEWRAP_PEER_BACKEND = "linux_bubblewrap_seccomp_v1";

const SANDBOX_HELPER = "/owlrunkit-helper";
const SANDBOX_WORKER = "/owlrunkit-worker";
const WORK = "/work";

function trustedBubblewrap() {
  const directories = ["/usr/bin", "/bin", "/usr/local/bin", ...(process.env.PATH ?? "").split(":")];
  for (const directory of new Set(directories)) {
    if (!path.isAbsolute(directory)) continue;
    try {
      const file = realpathSync(path.join(directory, "bwrap"));
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o6022)) continue;
      accessSync(file, constants.X_OK);
      let parent = path.dirname(file);
      for (;;) {
        const entry = lstatSync(parent);
        if (!entry.isDirectory() || entry.uid !== 0 || (entry.mode & 0o022)) break;
        const next = path.dirname(parent);
        if (parent === next) return file;
        parent = next;
      }
    } catch (error) {
      if (!["ENOENT", "EACCES", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  return null;
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
  const executable = trustedBubblewrap();
  if (!executable) return { available: false, reason: "trusted system Bubblewrap not found" };
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), "owlrunkit-bwrap-probe-"));
  try {
    const outside = path.join(directory, "outside");
    const work = path.join(directory, "work");
    writeFileSync(outside, "outside", { flag: "wx", mode: 0o600 });
    // Keep the sentinel outside the only writable bind.
    const scratch = mkdtempSync(work);
    writeFileSync(path.join(scratch, "probe-input"), "from host", { flag: "wx", mode: 0o600 });
    const result = spawnSync(executable, bubblewrapPeerArgs({
      helper, directory: scratch, worker: realpathSync(process.execPath),
      args: ["-e", probeWorker, outside], environment: {},
    }), {
      cwd: scratch, env: {}, stdio: ["ignore", "ignore", "pipe"],
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
    return { available: true, id: BUBBLEWRAP_PEER_BACKEND, executable, helper };
  } catch (error) {
    return { available: false, reason: `Bubblewrap self-test failed: ${error.code ?? error.message}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
