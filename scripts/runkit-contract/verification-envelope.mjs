import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { persistEvidenceBytes } from "./evidence-store.mjs";
import {
  assertAllowedKeys,
  isRecord,
  safeIdentifier,
  safeRelativePath,
  writeJsonExclusiveAtomically,
} from "./provenance-common.mjs";

const ENVELOPE_SCHEMA = "OwlCodaRunKitVerificationEnvelopeV1";
const RECEIPT_SCHEMA = "OwlCodaRunKitVerificationEnvelopeReceiptV1";
const SECRET_NAME = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSCODE|CREDENTIAL|PRIVATE_KEY|API_KEY)(?:_|$)/iu;
const DEFAULT_FORBIDDEN_READS = [
  ".env",
  ".env.local",
  ".git-credentials",
  ".npmrc",
  ".ssh/**",
  ".aws/**",
  ".config/gcloud/**",
  ".codex/**",
  ".owlcoda/**",
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Verification Envelope is not canonical JSON.");
  return encoded;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)
    || (!allowEmpty && value.length === 0)
    || value.some(item => typeof item !== "string" || item.length === 0)
    || new Set(value).size !== value.length) {
    throw new Error(`${label} must be a unique string array${allowEmpty ? "" : " with at least one entry"}.`);
  }
  return [...value];
}

function argvList(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return [...value];
}

function patternRoot(pattern) {
  return pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
}

function patternCovers(owner, candidate) {
  if (owner === candidate) return true;
  if (!owner.endsWith("/**")) return false;
  const prefix = patternRoot(owner);
  const candidateRoot = patternRoot(candidate);
  return candidateRoot === prefix || candidateRoot.startsWith(`${prefix}/`);
}

function patternsOverlap(left, right) {
  return left.some(a => right.some(b => patternCovers(a, b) || patternCovers(b, a)));
}

function validatePatterns(value, label, { allowEmpty = false } = {}) {
  const patterns = stringArray(value, label, { allowEmpty });
  return patterns.map((pattern) => {
    const root = patternRoot(pattern);
    if (pattern.includes("*") && !pattern.endsWith("/**")) {
      throw new Error(`${label} only supports exact paths or directory/** patterns.`);
    }
    safeRelativePath(root, label);
    return pattern;
  }).sort();
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertNoSymlink(root, absolutePath, label, { allowMissingLeaf = false } = {}) {
  if (!within(root, absolutePath)) throw new Error(`${label} escapes the workspace.`);
  const relative = path.relative(root, absolutePath);
  let current = root;
  for (const [index, segment] of relative.split(path.sep).filter(Boolean).entries()) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      if (allowMissingLeaf) return;
      throw new Error(`${label} does not exist: ${path.relative(root, current)}.`);
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not traverse a symlink.`);
    if (index < relative.split(path.sep).filter(Boolean).length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} has a non-directory ancestor.`);
    }
  }
}

function validateCommand(value, label, { requireCurrentExecutable = true } = {}) {
  if (value === null) return null;
  assertAllowedKeys(value, label, ["executable", "argv", "timeoutMs"]);
  if (typeof value.executable !== "string" || !path.isAbsolute(value.executable)) {
    throw new Error(`${label} executable must be an absolute regular file.`);
  }
  let executable = value.executable;
  if (requireCurrentExecutable) {
    try {
      const stat = lstatSync(value.executable);
      executable = realpathSync(value.executable);
      if (stat.isSymbolicLink() || !stat.isFile() || executable !== value.executable) {
        throw new Error("not-real");
      }
    } catch {
      throw new Error(`${label} executable must be an absolute regular file without symlinks.`);
    }
  }
  const argv = argvList(value.argv, `${label} argv`);
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 3_600_000) {
    throw new Error(`${label} timeoutMs must be an integer from 100 to 3600000.`);
  }
  return { executable, argv, timeoutMs: value.timeoutMs };
}

function homeForbiddenPaths() {
  const home = os.homedir();
  return [
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".npmrc"),
    path.join(home, ".git-credentials"),
    path.join(home, ".config", "gcloud"),
    path.join(home, ".codex"),
    path.join(home, ".owlcoda"),
  ];
}

export function validateVerificationEnvelopeV1({
  workspaceRoot,
  envelope,
  requireCurrentEnvironment = true,
}) {
  const root = realpathSync(workspaceRoot);
  assertAllowedKeys(envelope, "Verification Envelope", [
    "schemaVersion", "envelopeId", "cwd", "lockfiles", "paths",
    "environment", "network", "process", "phases",
  ]);
  if (envelope.schemaVersion !== ENVELOPE_SCHEMA) {
    throw new Error(`Verification Envelope schemaVersion must be ${ENVELOPE_SCHEMA}.`);
  }
  safeIdentifier(envelope.envelopeId, "envelopeId");
  const cwd = safeRelativePath(envelope.cwd, "Verification Envelope cwd", { allowDot: true });
  const cwdPath = path.resolve(root, cwd);
  if (requireCurrentEnvironment) {
    assertNoSymlink(root, cwdPath, "Verification Envelope cwd");
    if (!lstatSync(cwdPath).isDirectory()) {
      throw new Error("Verification Envelope cwd must be a directory.");
    }
  }

  const lockfiles = validatePatterns(envelope.lockfiles, "Verification Envelope lockfiles", { allowEmpty: true });
  for (const lockfile of lockfiles) {
    if (lockfile.endsWith("/**")) throw new Error("Verification Envelope lockfiles must be exact files.");
    if (requireCurrentEnvironment) {
      const absolute = path.join(root, lockfile);
      assertNoSymlink(root, absolute, "Verification Envelope lockfile");
      if (!lstatSync(absolute).isFile()) {
        throw new Error(`Verification Envelope lockfile is not a file: ${lockfile}.`);
      }
    }
  }

  assertAllowedKeys(envelope.paths, "Verification Envelope paths", [
    "immutableSource", "declaredOutput", "disposableScratch", "forbidden",
  ]);
  const paths = {
    immutableSource: validatePatterns(envelope.paths.immutableSource, "immutableSource"),
    declaredOutput: validatePatterns(envelope.paths.declaredOutput, "declaredOutput", { allowEmpty: true }),
    disposableScratch: validatePatterns(envelope.paths.disposableScratch, "disposableScratch", { allowEmpty: true }),
    forbidden: validatePatterns(envelope.paths.forbidden, "forbidden", { allowEmpty: true }),
  };
  if (!lockfiles.every(lockfile => paths.immutableSource.some(pattern => patternCovers(pattern, lockfile)))) {
    throw new Error("Every lockfile must be included in immutableSource.");
  }
  const classes = Object.entries(paths);
  for (let left = 0; left < classes.length; left += 1) {
    for (let right = left + 1; right < classes.length; right += 1) {
      if (patternsOverlap(classes[left][1], classes[right][1])) {
        throw new Error(`Verification Envelope path classes overlap: ${classes[left][0]} and ${classes[right][0]}.`);
      }
    }
  }
  if (requireCurrentEnvironment) {
    for (const pattern of paths.immutableSource) {
      const absolute = path.join(root, patternRoot(pattern));
      assertNoSymlink(root, absolute, "immutableSource");
      const stat = lstatSync(absolute);
      if (pattern.endsWith("/**") ? !stat.isDirectory() : !stat.isFile()) {
        throw new Error(`immutableSource type does not match pattern: ${pattern}.`);
      }
    }
    for (const pattern of [...paths.declaredOutput, ...paths.disposableScratch, ...paths.forbidden]) {
      assertNoSymlink(root, path.join(root, patternRoot(pattern)), "Verification Envelope path", {
        allowMissingLeaf: true,
      });
    }
  }

  assertAllowedKeys(envelope.environment, "Verification Envelope environment", ["allowNames", "values"]);
  const allowNames = stringArray(envelope.environment.allowNames, "environment allowNames").sort();
  if (allowNames.some(name => !/^[A-Z_][A-Z0-9_]*$/u.test(name) || SECRET_NAME.test(name))) {
    throw new Error("Verification Envelope environment names must be non-secret uppercase identifiers.");
  }
  if (!isRecord(envelope.environment.values)) throw new Error("Verification Envelope environment values must be an object.");
  const values = {};
  for (const [name, value] of Object.entries(envelope.environment.values)) {
    if (!allowNames.includes(name)) throw new Error(`Verification Envelope environment value ${name} is not allowlisted.`);
    if (typeof value !== "string") throw new Error(`Verification Envelope environment value ${name} must be a string.`);
    if (SECRET_NAME.test(name)) throw new Error(`Verification Envelope credential-like environment value is forbidden: ${name}.`);
    values[name] = value;
  }

  assertAllowedKeys(envelope.network, "Verification Envelope network", ["mode"]);
  if (!new Set(["deny", "loopback"]).has(envelope.network.mode)) {
    throw new Error("Verification Envelope network mode must be deny or loopback.");
  }
  assertAllowedKeys(envelope.process, "Verification Envelope process", [
    "allowSubprocesses", "allowedExecutables", "allowBackgroundAfterFinish",
  ]);
  if (typeof envelope.process.allowSubprocesses !== "boolean"
    || typeof envelope.process.allowBackgroundAfterFinish !== "boolean") {
    throw new Error("Verification Envelope process booleans are required.");
  }
  if (envelope.process.allowBackgroundAfterFinish) {
    throw new Error("Verification Envelope cannot allow background processes after finish.");
  }
  const allowedExecutables = stringArray(
    envelope.process.allowedExecutables,
    "process allowedExecutables",
  ).map((executable) => {
    if (!path.isAbsolute(executable)) throw new Error("Allowed executable must be absolute.");
    if (requireCurrentEnvironment) {
      const stat = lstatSync(executable);
      const resolved = realpathSync(executable);
      if (stat.isSymbolicLink() || !stat.isFile() || resolved !== executable) {
        throw new Error("Allowed executable must be a regular file without symlinks.");
      }
    }
    return executable;
  }).sort();
  if (!envelope.process.allowSubprocesses && allowedExecutables.length > 0) {
    throw new Error("allowedExecutables requires allowSubprocesses=true.");
  }

  assertAllowedKeys(envelope.phases, "Verification Envelope phases", ["setup", "check", "teardown"]);
  const phases = {
    setup: validateCommand(envelope.phases.setup, "setup phase", {
      requireCurrentExecutable: requireCurrentEnvironment,
    }),
    check: validateCommand(envelope.phases.check, "check phase", {
      requireCurrentExecutable: requireCurrentEnvironment,
    }),
    teardown: validateCommand(envelope.phases.teardown, "teardown phase", {
      requireCurrentExecutable: requireCurrentEnvironment,
    }),
  };
  if (phases.check === null) throw new Error("Verification Envelope check phase is required.");
  const normalized = {
    schemaVersion: ENVELOPE_SCHEMA,
    envelopeId: envelope.envelopeId,
    cwd,
    lockfiles,
    paths,
    environment: { allowNames, values },
    network: { mode: envelope.network.mode },
    process: {
      allowSubprocesses: envelope.process.allowSubprocesses,
      allowedExecutables,
      allowBackgroundAfterFinish: false,
    },
    phases,
  };
  return {
    envelope: normalized,
    envelopeSha256: sha256(canonical(normalized)),
    builtInForbiddenReads: [...DEFAULT_FORBIDDEN_READS],
    authorizationGranted: false,
  };
}

export function validateEnvelopeSourceCandidateBoundaryV1({
  envelope,
  sourceManifest,
}) {
  if (
    sourceManifest?.schemaVersion !== "OwlCodaRunKitDirtySourceManifestV2"
    || !Array.isArray(sourceManifest.entries)
  ) {
    throw new Error("Formal envelope source boundary requires SourceCandidate V2 manifest.");
  }
  const writable = [
    ...envelope.paths.declaredOutput,
    ...envelope.paths.disposableScratch,
  ];
  const uncovered = [];
  const writableCandidatePaths = [];
  for (const entry of sourceManifest.entries) {
    const candidatePaths = [entry.path, entry.previousPath].filter(Boolean);
    for (const candidatePath of candidatePaths) {
      if (writable.some(pattern => patternCovers(pattern, candidatePath))) {
        writableCandidatePaths.push(candidatePath);
      }
    }
    if (
      entry.operation !== "deleted"
      && !envelope.paths.immutableSource.some(
        pattern => patternCovers(pattern, entry.path),
      )
    ) {
      uncovered.push(entry.path);
    }
  }
  if (uncovered.length > 0 || writableCandidatePaths.length > 0) {
    const details = [
      uncovered.length > 0
        ? `immutableSource does not cover: ${[...new Set(uncovered)].sort().join(", ")}`
        : null,
      writableCandidatePaths.length > 0
        ? `writable paths overlap candidate source: ${[...new Set(writableCandidatePaths)].sort().join(", ")}`
        : null,
    ].filter(Boolean).join("; ");
    throw new Error(`Formal envelope does not preserve the SourceCandidate: ${details}.`);
  }
  return {
    status: "source_candidate_boundary_valid",
    authorizationGranted: false,
  };
}

function commandExists(command) {
  try {
    const stat = lstatSync(command);
    return stat.isFile() && !stat.isSymbolicLink() && realpathSync(command) === command;
  } catch {
    return false;
  }
}

export function resolveVerificationEnvelopeBackendV1({ platform = process.platform } = {}) {
  if (platform === "darwin" && commandExists("/usr/bin/sandbox-exec")) {
    return {
      id: "macos_sandbox_exec_v1",
      available: true,
      executable: "/usr/bin/sandbox-exec",
      capabilities: {
        fileWritePolicy: "enforced",
        forbiddenReadPolicy: "enforced",
        networkPolicy: "enforced",
        processExecPolicy: "enforced",
        processCleanup: "verified",
      },
    };
  }
  return {
    id: "unavailable",
    available: false,
    reason: platform === "linux"
      ? "linux_backend_cannot_yet_prove_process_exec_policy"
      : "supported_enforcement_backend_not_found",
    capabilities: {
      fileWritePolicy: "unavailable",
      forbiddenReadPolicy: "unavailable",
      networkPolicy: "unavailable",
      processExecPolicy: "unavailable",
      processCleanup: "unavailable",
    },
  };
}

function schemeString(value) {
  return JSON.stringify(value).replaceAll("\\", "\\\\");
}

function sandboxPathRule(operation, absolutePath, isTree) {
  return `(${operation} (${isTree ? "subpath" : "literal"} ${schemeString(absolutePath)}))`;
}

function buildMacPolicy({ root, envelope, phase }) {
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
  ];
  for (const pattern of [...envelope.paths.declaredOutput, ...envelope.paths.disposableScratch]) {
    const absolute = path.join(root, patternRoot(pattern));
    lines.push(sandboxPathRule("allow file-write*", absolute, pattern.endsWith("/**")));
  }
  const forbidden = new Map();
  for (const pattern of [...DEFAULT_FORBIDDEN_READS, ...envelope.paths.forbidden]) {
    forbidden.set(path.join(root, patternRoot(pattern)), pattern.endsWith("/**"));
  }
  for (const absolute of homeForbiddenPaths()) forbidden.set(absolute, statSafeDirectory(absolute));
  for (const [absolute, isTree] of forbidden) {
    lines.push(sandboxPathRule("deny file-read*", absolute, isTree));
  }
  lines.push("(deny network*)");
  if (envelope.network.mode === "loopback") {
    lines.push("(allow network* (local ip))");
  }
  lines.push("(deny process-exec)");
  lines.push(sandboxPathRule("allow process-exec", phase.executable, false));
  if (envelope.process.allowSubprocesses) {
    for (const executable of envelope.process.allowedExecutables) {
      lines.push(sandboxPathRule("allow process-exec", executable, false));
    }
  } else {
    lines.push("(deny process-fork)");
  }
  return `${lines.join("\n")}\n`;
}

function statSafeDirectory(value) {
  try {
    return statSync(value).isDirectory();
  } catch {
    return value.endsWith(path.sep) || !path.extname(value);
  }
}

function mkdirDeclaredRoots(root, patterns) {
  for (const pattern of patterns) {
    const absolute = path.join(root, patternRoot(pattern));
    const directory = pattern.endsWith("/**") ? absolute : path.dirname(absolute);
    mkdirSync(directory, { recursive: true });
    assertNoSymlink(root, directory, "Verification Envelope writable path");
  }
}

function mkdirBoundTemporaryDirectory(root, envelope) {
  if (!envelope.environment.allowNames.includes("TMPDIR")) return null;
  if (!Object.hasOwn(envelope.environment.values, "TMPDIR")) {
    throw new Error("Verification Envelope TMPDIR must be explicitly bound, not inherited.");
  }
  const absolute = path.resolve(root, envelope.cwd, envelope.environment.values.TMPDIR);
  if (!within(root, absolute)) {
    throw new Error("Verification Envelope TMPDIR must remain inside the workspace.");
  }
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!envelope.paths.disposableScratch.some(pattern => (
    pattern.endsWith("/**") && patternCovers(pattern, relative)
  ))) {
    throw new Error(
      "Verification Envelope TMPDIR must be covered by a disposableScratch/** directory tree.",
    );
  }
  mkdirSync(absolute, { recursive: true });
  assertNoSymlink(root, absolute, "Verification Envelope TMPDIR");
  return absolute;
}

function walkFiles(root, absolute, relativeBase, files) {
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Verification Envelope path contains symlink: ${relativeBase}.`);
  if (stat.isFile()) {
    files.push({
      path: relativeBase.split(path.sep).join("/"),
      sha256: sha256(readFileSync(absolute)),
      bytes: stat.size,
      mode: stat.mode & 0o777,
    });
    return;
  }
  if (!stat.isDirectory()) throw new Error(`Verification Envelope path is not a regular file or directory: ${relativeBase}.`);
  for (const entry of readdirSync(absolute).sort()) {
    walkFiles(root, path.join(absolute, entry), path.join(relativeBase, entry), files);
  }
}

function snapshotPatterns(root, patterns, { missingAllowed = false } = {}) {
  const files = [];
  for (const pattern of patterns) {
    const relative = patternRoot(pattern);
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) {
      if (missingAllowed) continue;
      throw new Error(`Verification Envelope path disappeared: ${pattern}.`);
    }
    if (pattern.endsWith("/**")) {
      walkFiles(root, absolute, relative, files);
    } else {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Verification Envelope exact path is not a regular file: ${pattern}.`);
      }
      files.push({
        path: relative,
        sha256: sha256(readFileSync(absolute)),
        bytes: stat.size,
        mode: stat.mode & 0o777,
      });
    }
  }
  const unique = [...new Map(files.map(row => [row.path, row])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: unique,
    sha256: sha256(canonical(unique)),
  };
}

function filteredEnvironment(envelope) {
  const env = {};
  for (const name of envelope.environment.allowNames) {
    if (Object.hasOwn(envelope.environment.values, name)) {
      env[name] = envelope.environment.values[name];
    } else if (typeof process.env[name] === "string") {
      env[name] = process.env[name];
    }
  }
  return env;
}

function processIdsForGroup(groupId) {
  if (!Number.isSafeInteger(groupId) || groupId < 1) return [];
  const result = spawnSync("/bin/ps", ["-axo", "pid=,pgid="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split("\n").map(line => line.trim().split(/\s+/u).map(Number))
    .filter(([pid, pgid]) => Number.isSafeInteger(pid) && pgid === groupId && pid !== process.pid)
    .map(([pid]) => pid)
    .sort((left, right) => left - right);
}

function killGroup(groupId) {
  const before = processIdsForGroup(groupId);
  if (before.length === 0) return { terminated: [], remaining: [] };
  try {
    process.kill(-groupId, "SIGTERM");
  } catch {}
  const until = Date.now() + 250;
  while (Date.now() < until && processIdsForGroup(groupId).length > 0) {
    // Bounded synchronous polling keeps cleanup inside the command lifecycle.
  }
  let remaining = processIdsForGroup(groupId);
  if (remaining.length > 0) {
    try {
      process.kill(-groupId, "SIGKILL");
    } catch {}
    remaining = processIdsForGroup(groupId);
  }
  return { terminated: before, remaining };
}

function phaseToolchainIssue({ root, cwd, phase }) {
  if (
    phase.executable !== realpathSync(process.execPath)
    || typeof phase.argv[0] !== "string"
    || phase.argv[0].startsWith("-")
    || !/\.[cm]?js$/u.test(phase.argv[0])
  ) {
    return null;
  }
  try {
    const absolute = path.resolve(root, cwd, phase.argv[0]);
    if (!within(root, absolute)) throw new Error("outside-workspace");
    assertNoSymlink(root, absolute, "Verification Envelope Node entrypoint");
    const stat = lstatSync(absolute);
    if (!stat.isFile()) throw new Error("not-file");
    return null;
  } catch {
    return "node_entrypoint_unavailable";
  }
}

function executeMacPhase({ root, cwd, envelope, phase, name, backend }) {
  const policy = buildMacPolicy({ root, envelope, phase });
  const policySha256 = sha256(policy);
  const toolchainIssue = phaseToolchainIssue({ root, cwd, phase });
  if (toolchainIssue !== null) {
    const now = new Date().toISOString();
    return Promise.resolve({
      name,
      executable: phase.executable,
      argv: [...phase.argv],
      startedAt: now,
      finishedAt: now,
      timeoutMs: phase.timeoutMs,
      timedOut: false,
      outputOverflow: false,
      exitCode: null,
      signal: null,
      launchError: toolchainIssue,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      policy,
      policySha256,
      processGroupId: null,
      cleanup: { terminated: [], remaining: [] },
    });
  }
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(backend.executable, [
      "-p",
      policy,
      phase.executable,
      ...phase.argv,
    ], {
      cwd: path.join(root, cwd),
      env: filteredEnvironment(envelope),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let overflow = false;
    let bytes = 0;
    const capture = target => chunk => {
      bytes += chunk.length;
      if (bytes > 5 * 1024 * 1024) {
        overflow = true;
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }, phase.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      const cleanup = killGroup(child.pid);
      resolve({
        name,
        executable: phase.executable,
        argv: [...phase.argv],
        startedAt,
        finishedAt: new Date().toISOString(),
        timeoutMs: phase.timeoutMs,
        timedOut,
        outputOverflow: overflow,
        exitCode: null,
        signal: null,
        launchError: error.message,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        policy,
        policySha256,
        processGroupId: child.pid,
        cleanup,
      });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const cleanup = killGroup(child.pid);
      resolve({
        name,
        executable: phase.executable,
        argv: [...phase.argv],
        startedAt,
        finishedAt: new Date().toISOString(),
        timeoutMs: phase.timeoutMs,
        timedOut,
        outputOverflow: overflow,
        exitCode: code,
        signal,
        launchError: null,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        policy,
        policySha256,
        processGroupId: child.pid,
        cleanup,
      });
    });
  });
}

function writeObject(workspaceRoot, label, bytes) {
  const stored = persistEvidenceBytes({
    workspaceRoot,
    bytes,
    encoding: "base64_json",
  });
  return {
    label,
    path: stored.absolutePath,
    sha256: stored.digest,
    bytes: stored.sizeBytes,
  };
}

function cleanScratch(root, patterns) {
  const removed = [];
  const failed = [];
  for (const pattern of patterns) {
    const relative = patternRoot(pattern);
    const absolute = path.join(root, relative);
    try {
      if (existsSync(absolute)) {
        rmSync(absolute, { recursive: true, force: true });
        removed.push(relative);
      }
    } catch (error) {
      failed.push({ path: relative, issue: error instanceof Error ? error.message : String(error) });
    }
  }
  return { removed, failed };
}

function receiptBodyHash(receipt) {
  const { receiptSha256: _ignored, ...body } = receipt;
  return sha256(canonical(body));
}

function receiptPathFor(artifactRoot) {
  return path.join(artifactRoot, "verification-envelope-receipt.json");
}

function exactKeys(value, label, keys) {
  assertAllowedKeys(value, label, keys);
  if (!isRecord(value) || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} is missing required fields.`);
  }
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateReceiptFileRow(row, label, { mode = false } = {}) {
  exactKeys(row, label, mode
    ? ["path", "sha256", "bytes", "mode"]
    : ["path", "sha256", "bytes"]);
  if (
    typeof row.path !== "string"
    || row.path.length === 0
    || !validHash(row.sha256)
    || !validNonNegativeInteger(row.bytes)
    || (mode && (!Number.isSafeInteger(row.mode) || row.mode < 0 || row.mode > 0o777))
  ) {
    throw new Error(`${label} is invalid.`);
  }
}

function validateReceiptPhase(phase, envelope) {
  exactKeys(phase, "Verification Envelope receipt phase", [
    "name",
    "executable",
    "argv",
    "startedAt",
    "finishedAt",
    "timeoutMs",
    "timedOut",
    "outputOverflow",
    "exitCode",
    "signal",
    "launchError",
    "policySha256",
    "processGroupId",
    "stdout",
    "stderr",
    "leakedProcessIds",
  ]);
  if (!new Set(["setup", "check", "teardown"]).has(phase.name)) {
    throw new Error("Verification Envelope receipt phase name is invalid.");
  }
  const command = envelope.phases[phase.name];
  if (
    command === null
    || phase.executable !== command.executable
    || canonical(phase.argv) !== canonical(command.argv)
    || phase.timeoutMs !== command.timeoutMs
    || typeof phase.startedAt !== "string"
    || typeof phase.finishedAt !== "string"
    || typeof phase.timedOut !== "boolean"
    || typeof phase.outputOverflow !== "boolean"
    || !(phase.exitCode === null || Number.isInteger(phase.exitCode))
    || !(phase.signal === null || typeof phase.signal === "string")
    || !(phase.launchError === null || typeof phase.launchError === "string")
    || !validHash(phase.policySha256)
    || !(phase.processGroupId === undefined
      || phase.processGroupId === null
      || Number.isSafeInteger(phase.processGroupId))
    || !Array.isArray(phase.leakedProcessIds)
    || phase.leakedProcessIds.some(pid => !Number.isSafeInteger(pid) || pid < 1)
  ) {
    throw new Error(`Verification Envelope receipt phase is invalid: ${phase.name}.`);
  }
  validateReceiptFileRow(phase.stdout, `${phase.name} stdout`);
  validateReceiptFileRow(phase.stderr, `${phase.name} stderr`);
}

function validateReceiptDerivations(receipt, validatedEnvelope) {
  exactKeys(receipt, "Verification Envelope receipt", [
    "schemaVersion",
    "envelopeId",
    "envelope",
    "envelopeSha256",
    "status",
    "formalEligible",
    "commandExecuted",
    "backend",
    "startedAt",
    "finishedAt",
    "phases",
    "source",
    "outputs",
    "evidenceObjects",
    "cleanup",
    "nextAllowedAction",
    "authorizationGranted",
    "receiptSha256",
  ]);
  if (
    receipt.schemaVersion !== RECEIPT_SCHEMA
    || receipt.envelopeId !== validatedEnvelope.envelope.envelopeId
    || receipt.envelopeSha256 !== validatedEnvelope.envelopeSha256
    || receipt.authorizationGranted !== false
    || typeof receipt.startedAt !== "string"
    || typeof receipt.finishedAt !== "string"
    || !Array.isArray(receipt.phases)
    || !Array.isArray(receipt.outputs)
    || !Array.isArray(receipt.evidenceObjects)
  ) {
    throw new Error("Verification Envelope receipt contract is invalid.");
  }
  exactKeys(receipt.cleanup, "Verification Envelope cleanup", [
    "teardownCompleted",
    "terminatedProcessIds",
    "remainingProcessIds",
    "remainingPorts",
    "scratchRemoved",
    "issues",
  ]);
  if (
    typeof receipt.cleanup.teardownCompleted !== "boolean"
    || !Array.isArray(receipt.cleanup.terminatedProcessIds)
    || !Array.isArray(receipt.cleanup.remainingProcessIds)
    || !Array.isArray(receipt.cleanup.remainingPorts)
    || !Array.isArray(receipt.cleanup.scratchRemoved)
    || !Array.isArray(receipt.cleanup.issues)
  ) {
    throw new Error("Verification Envelope cleanup contract is invalid.");
  }
  if (receipt.backend?.available === false) {
    exactKeys(receipt.backend, "Verification Envelope backend", [
      "id", "available", "reason", "capabilities",
    ]);
    exactKeys(receipt.source, "Verification Envelope source", [
      "beforeSha256", "afterSha256",
    ]);
    if (
      receipt.backend.id !== "unavailable"
      || typeof receipt.backend.reason !== "string"
      || receipt.phases.length !== 0
      || receipt.outputs.length !== 0
      || receipt.evidenceObjects.length !== 0
      || receipt.source.beforeSha256 !== receipt.source.afterSha256
      || receipt.status !== "policy_backend_unavailable"
      || receipt.formalEligible !== false
      || receipt.commandExecuted !== false
      || receipt.nextAllowedAction
        !== "install_supported_enforcement_backend_or_use_captured_evidence"
    ) {
      throw new Error("Verification Envelope unavailable-backend receipt is inconsistent.");
    }
    return;
  }
  exactKeys(receipt.backend, "Verification Envelope backend", [
    "id", "executable", "capabilities", "policySha256",
  ]);
  exactKeys(receipt.source, "Verification Envelope source", [
    "beforeSha256", "afterSha256", "unchanged", "fileCount",
  ]);
  if (
    receipt.backend.id !== "macos_sandbox_exec_v1"
    || receipt.backend.executable !== "/usr/bin/sandbox-exec"
    || !validHash(receipt.backend.policySha256)
    || !validHash(receipt.source.beforeSha256)
    || !validHash(receipt.source.afterSha256)
    || !validNonNegativeInteger(receipt.source.fileCount)
  ) {
    throw new Error("Verification Envelope receipt backend or source is invalid.");
  }
  const phaseNames = receipt.phases.map(phase => phase.name);
  if (new Set(phaseNames).size !== phaseNames.length) {
    throw new Error("Verification Envelope receipt phases must be unique.");
  }
  for (const phase of receipt.phases) {
    validateReceiptPhase(phase, validatedEnvelope.envelope);
  }
  const setup = receipt.phases.find(phase => phase.name === "setup") ?? null;
  const expectedPhaseNames = [];
  if (validatedEnvelope.envelope.phases.setup !== null) expectedPhaseNames.push("setup");
  const setupPassed = setup === null
    || (setup.exitCode === 0 && !setup.timedOut && !setup.outputOverflow);
  if (setupPassed) expectedPhaseNames.push("check");
  if (validatedEnvelope.envelope.phases.teardown !== null) expectedPhaseNames.push("teardown");
  if (canonical(phaseNames) !== canonical(expectedPhaseNames)) {
    throw new Error("Verification Envelope receipt phase sequence is inconsistent.");
  }
  const expectedEvidenceObjects = receipt.phases.flatMap(phase => [
    { label: `${phase.name}:stdout`, ...phase.stdout },
    { label: `${phase.name}:stderr`, ...phase.stderr },
  ]);
  for (const [index, object] of receipt.evidenceObjects.entries()) {
    exactKeys(object, `Verification evidence object ${index}`, [
      "label", "path", "sha256", "bytes",
    ]);
    validateReceiptFileRow(
      { path: object.path, sha256: object.sha256, bytes: object.bytes },
      `Verification evidence object ${index}`,
    );
  }
  if (canonical(receipt.evidenceObjects) !== canonical(expectedEvidenceObjects)) {
    throw new Error("Verification Envelope evidence objects do not match phase outputs.");
  }
  for (const [index, output] of receipt.outputs.entries()) {
    validateReceiptFileRow(output, `Verification output ${index}`, { mode: true });
  }
  const sourceUnchanged = receipt.source.beforeSha256 === receipt.source.afterSha256;
  const teardown = receipt.phases.find(phase => phase.name === "teardown") ?? null;
  const teardownCompleted = validatedEnvelope.envelope.phases.teardown === null
    || (teardown?.exitCode === 0 && !teardown.timedOut);
  const allPhasesPassed = receipt.phases.some(phase => phase.name === "check")
    && receipt.phases.every(phase => phase.exitCode === 0
      && !phase.timedOut
      && !phase.outputOverflow
      && phase.launchError === null);
  const formalEligible = allPhasesPassed
    && sourceUnchanged
    && receipt.cleanup.terminatedProcessIds.length === 0
    && receipt.cleanup.remainingProcessIds.length === 0
    && receipt.cleanup.issues.length === 0
    && teardownCompleted;
  if (
    receipt.source.unchanged !== sourceUnchanged
    || receipt.cleanup.teardownCompleted !== teardownCompleted
    || receipt.commandExecuted !== (receipt.phases.length > 0)
    || receipt.formalEligible !== formalEligible
    || receipt.status !== (formalEligible
      ? "verification_envelope_passed"
      : "verification_envelope_failed")
    || receipt.nextAllowedAction !== (formalEligible
      ? "consume_in_formal_finish"
      : "inspect_envelope_receipt_and_create_new_check")
    || receipt.backend.policySha256
      !== sha256(canonical(receipt.phases.map(phase => phase.policySha256)))
  ) {
    throw new Error("Verification Envelope receipt derived fields are inconsistent.");
  }
}

export async function runVerificationEnvelopeV1({
  workspaceRoot,
  envelope: rawEnvelope,
  artifactRoot,
  backend = resolveVerificationEnvelopeBackendV1(),
}) {
  const validated = validateVerificationEnvelopeV1({ workspaceRoot, envelope: rawEnvelope });
  const root = realpathSync(workspaceRoot);
  const requestedRoot = path.resolve(workspaceRoot);
  const requestedOutputRoot = path.resolve(artifactRoot);
  if (!within(requestedRoot, requestedOutputRoot)) {
    throw new Error("Verification Envelope artifactRoot must remain inside the workspace.");
  }
  const outputRoot = path.join(root, path.relative(requestedRoot, requestedOutputRoot));
  assertNoSymlink(root, outputRoot, "Verification Envelope artifactRoot", { allowMissingLeaf: true });
  mkdirSync(outputRoot, { recursive: true });
  const receiptPath = receiptPathFor(outputRoot);
  if (existsSync(receiptPath)) {
    const verified = verifyVerificationEnvelopeReceiptV1({ workspaceRoot: root, receiptPath });
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    if (receipt.envelopeSha256 !== validated.envelopeSha256) {
      throw new Error("Existing Verification Envelope receipt binds a different envelope.");
    }
    return { ...receipt, receiptPath, resumed: true, verification: verified };
  }
  mkdirBoundTemporaryDirectory(root, validated.envelope);
  mkdirDeclaredRoots(root, [
    ...validated.envelope.paths.declaredOutput,
    ...validated.envelope.paths.disposableScratch,
  ]);
  const sourceBefore = snapshotPatterns(root, validated.envelope.paths.immutableSource);
  const startedAt = new Date().toISOString();
  if (!backend.available) {
    const body = {
      schemaVersion: RECEIPT_SCHEMA,
      envelopeId: validated.envelope.envelopeId,
      envelope: validated.envelope,
      envelopeSha256: validated.envelopeSha256,
      status: "policy_backend_unavailable",
      formalEligible: false,
      commandExecuted: false,
      backend,
      startedAt,
      finishedAt: new Date().toISOString(),
      phases: [],
      source: { beforeSha256: sourceBefore.sha256, afterSha256: sourceBefore.sha256 },
      outputs: [],
      evidenceObjects: [],
      cleanup: {
        teardownCompleted: false,
        terminatedProcessIds: [],
        remainingProcessIds: [],
        remainingPorts: [],
        scratchRemoved: [],
        issues: [backend.reason],
      },
      nextAllowedAction: "install_supported_enforcement_backend_or_use_captured_evidence",
      authorizationGranted: false,
    };
    const receipt = { ...body, receiptSha256: sha256(canonical(body)) };
    writeJsonExclusiveAtomically(receiptPath, receipt);
    return { ...receipt, receiptPath, resumed: false };
  }
  if (backend.id !== "macos_sandbox_exec_v1") {
    throw new Error(`Unsupported Verification Envelope backend: ${backend.id}.`);
  }

  const rawPhases = [];
  const terminatedProcessIds = new Set();
  const remainingProcessIds = new Set();
  const run = async (name, phase) => {
    const result = await executeMacPhase({
      root,
      cwd: validated.envelope.cwd,
      envelope: validated.envelope,
      phase,
      name,
      backend,
    });
    rawPhases.push(result);
    for (const pid of result.cleanup.terminated) terminatedProcessIds.add(pid);
    for (const pid of result.cleanup.remaining) remainingProcessIds.add(pid);
    return result;
  };
  let setupPassed = true;
  if (validated.envelope.phases.setup) {
    const setup = await run("setup", validated.envelope.phases.setup);
    setupPassed = setup.exitCode === 0 && !setup.timedOut && !setup.outputOverflow;
  }
  if (setupPassed) await run("check", validated.envelope.phases.check);
  if (validated.envelope.phases.teardown) {
    await run("teardown", validated.envelope.phases.teardown);
  }
  const sourceAfter = snapshotPatterns(root, validated.envelope.paths.immutableSource);
  const outputs = snapshotPatterns(
    root,
    validated.envelope.paths.declaredOutput,
    { missingAllowed: true },
  ).files;
  const scratchCleanup = cleanScratch(root, validated.envelope.paths.disposableScratch);
  const evidenceObjects = [];
  const phases = rawPhases.map((phase) => {
    const stdout = writeObject(root, `${phase.name}:stdout`, phase.stdout);
    const stderr = writeObject(root, `${phase.name}:stderr`, phase.stderr);
    evidenceObjects.push(stdout, stderr);
    return {
      name: phase.name,
      executable: phase.executable,
      argv: phase.argv,
      startedAt: phase.startedAt,
      finishedAt: phase.finishedAt,
      timeoutMs: phase.timeoutMs,
      timedOut: phase.timedOut,
      outputOverflow: phase.outputOverflow,
      exitCode: phase.exitCode,
      signal: phase.signal,
      launchError: phase.launchError,
      policySha256: phase.policySha256,
      processGroupId: phase.processGroupId,
      stdout: { path: stdout.path, sha256: stdout.sha256, bytes: stdout.bytes },
      stderr: { path: stderr.path, sha256: stderr.sha256, bytes: stderr.bytes },
      leakedProcessIds: phase.cleanup.terminated,
    };
  });
  const teardown = phases.find(row => row.name === "teardown") ?? null;
  const cleanup = {
    teardownCompleted: validated.envelope.phases.teardown === null
      || (teardown?.exitCode === 0 && !teardown.timedOut),
    terminatedProcessIds: [...terminatedProcessIds].sort((a, b) => a - b),
    remainingProcessIds: [...remainingProcessIds].sort((a, b) => a - b),
    remainingPorts: [],
    scratchRemoved: scratchCleanup.removed,
    issues: scratchCleanup.failed,
  };
  const allPhasesPassed = phases.some(row => row.name === "check")
    && phases.every(row => row.exitCode === 0
      && !row.timedOut
      && !row.outputOverflow
      && row.launchError === null);
  const sourceUnchanged = sourceBefore.sha256 === sourceAfter.sha256;
  const formalEligible = allPhasesPassed
    && sourceUnchanged
    && cleanup.terminatedProcessIds.length === 0
    && cleanup.remainingProcessIds.length === 0
    && cleanup.issues.length === 0
    && cleanup.teardownCompleted;
  const body = {
    schemaVersion: RECEIPT_SCHEMA,
    envelopeId: validated.envelope.envelopeId,
    envelope: validated.envelope,
    envelopeSha256: validated.envelopeSha256,
    status: formalEligible ? "verification_envelope_passed" : "verification_envelope_failed",
    formalEligible,
    commandExecuted: phases.length > 0,
    backend: {
      id: backend.id,
      executable: backend.executable,
      capabilities: backend.capabilities,
      policySha256: sha256(canonical(phases.map(row => row.policySha256))),
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    phases,
    source: {
      beforeSha256: sourceBefore.sha256,
      afterSha256: sourceAfter.sha256,
      unchanged: sourceUnchanged,
      fileCount: sourceAfter.files.length,
    },
    outputs,
    evidenceObjects: evidenceObjects.map(row => ({
      label: row.label,
      path: row.path,
      sha256: row.sha256,
      bytes: row.bytes,
    })),
    cleanup,
    nextAllowedAction: formalEligible
      ? "consume_in_formal_finish"
      : "inspect_envelope_receipt_and_create_new_check",
    authorizationGranted: false,
  };
  const receipt = { ...body, receiptSha256: sha256(canonical(body)) };
  writeJsonExclusiveAtomically(receiptPath, receipt);
  return { ...receipt, receiptPath, resumed: false };
}

export function verifyVerificationEnvelopeReceiptV1({
  workspaceRoot,
  receiptPath,
  requireCurrentSource = true,
}) {
  const root = realpathSync(workspaceRoot);
  const absolute = path.resolve(receiptPath);
  if (!within(root, absolute)) throw new Error("Verification Envelope receipt escapes the workspace.");
  assertNoSymlink(root, absolute, "Verification Envelope receipt");
  const receipt = JSON.parse(readFileSync(absolute, "utf8"));
  if (receipt.receiptSha256 !== receiptBodyHash(receipt)) {
    throw new Error("Verification Envelope receipt hash mismatch.");
  }
  const validated = validateVerificationEnvelopeV1({
    workspaceRoot: root,
    envelope: receipt.envelope,
    requireCurrentEnvironment: requireCurrentSource,
  });
  validateReceiptDerivations(receipt, validated);
  if (validated.envelopeSha256 !== receipt.envelopeSha256) {
    throw new Error("Verification Envelope receipt envelope hash mismatch.");
  }
  for (const object of receipt.evidenceObjects ?? []) {
    const objectPath = path.resolve(object.path);
    if (!within(root, objectPath)) throw new Error("Verification evidence object escapes the workspace.");
    assertNoSymlink(root, objectPath, "Verification evidence object");
    const stored = JSON.parse(readFileSync(objectPath, "utf8"));
    const bytes = Buffer.from(stored.data, stored.encoding);
    if (bytes.length !== object.bytes || sha256(bytes) !== object.sha256) {
      throw new Error(`Verification evidence object hash mismatch: ${object.label}.`);
    }
  }
  for (const output of receipt.outputs ?? []) {
    const outputPath = path.join(root, output.path);
    assertNoSymlink(root, outputPath, "Verification output");
    const stat = lstatSync(outputPath);
    if (!stat.isFile() || stat.size !== output.bytes || sha256(readFileSync(outputPath)) !== output.sha256) {
      throw new Error(`Verification output hash mismatch: ${output.path}.`);
    }
  }
  if (
    requireCurrentSource
    && receipt.formalEligible
    && snapshotPatterns(root, receipt.envelope.paths.immutableSource).sha256
      !== receipt.source.afterSha256
  ) {
    throw new Error("Verification Envelope receipt source drifted after execution.");
  }
  return {
    status: "verification_envelope_receipt_valid",
    exitCode: 0,
    receiptPath: absolute,
    receiptSha256: receipt.receiptSha256,
    envelopeSha256: receipt.envelopeSha256,
    formalEligible: receipt.formalEligible,
    authorizationGranted: false,
  };
}
