import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  canonicalJson,
  hasExactKeys,
  isSha256Ref,
  sha256Bytes,
  sha256Canonical,
} from "./formal.mjs";

export const CANDIDATE_LEDGER_ALGORITHM_V1 = "owlcoda-canonical-candidate-ledger-v1";
export const FOREIGN_FILESYSTEM_LEDGER_ALGORITHM_V1 = "owlcoda-foreign-workspace-ledger-v1";

const MAX_LEDGER_FILES = 100_000;
const MAX_LEDGER_BYTES = 2 * 1024 * 1024 * 1024;
const STATUS_ARGV = Object.freeze([
  "git", "-c", "color.ui=false", "-c", "core.abbrev=40",
  "status", "--porcelain=v1", "-z", "--untracked-files=all",
]);
const TRANSPORT_DIFF_ARGV = Object.freeze([
  "git", "-c", "color.ui=false", "-c", "core.abbrev=40",
  "diff", "--full-index", "--binary", "--no-ext-diff", "--no-textconv", "HEAD",
]);
const GIT_IDENTITY_ENVIRONMENT = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
});

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function git(root, argv) {
  return execFileSync(argv[0], argv.slice(1), {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...GIT_IDENTITY_ENVIRONMENT,
    },
  });
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function hashRegularFile(absolute, expectedStat, maximumBytes = MAX_LEDGER_BYTES) {
  if (!expectedStat.isFile() || expectedStat.size > maximumBytes) {
    throw new Error(`Candidate file exceeds the bounded ledger limit: ${absolute}`);
  }
  const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || !sameFileIdentity(before, expectedStat)) {
      throw new Error(`Candidate file identity changed before hashing: ${absolute}`);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let sizeBytes = 0;
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      sizeBytes += bytesRead;
      if (sizeBytes > maximumBytes) {
        throw new Error(`Candidate file exceeds the bounded ledger limit: ${absolute}`);
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = fstatSync(descriptor);
    const current = lstatSync(absolute);
    if (!sameFileIdentity(before, after) || !sameFileIdentity(after, current)) {
      throw new Error(`Candidate file changed while hashing: ${absolute}`);
    }
    return { sizeBytes, sha256: `sha256:${hash.digest("hex")}` };
  } finally {
    closeSync(descriptor);
  }
}

function captureTransportDiff(root) {
  const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "owlrunkit-candidate-diff-")));
  const output = path.join(scratch, "candidate.diff");
  try {
    const descriptor = openSync(output, "wx", 0o600);
    try {
      execFileSync(TRANSPORT_DIFF_ARGV[0], TRANSPORT_DIFF_ARGV.slice(1), {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", descriptor, "pipe"],
        env: { ...process.env, ...GIT_IDENTITY_ENVIRONMENT },
      });
    } finally {
      closeSync(descriptor);
    }
    return hashRegularFile(output, lstatSync(output));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function canonicalGitRoot(requestedRoot) {
  const root = realpathSync(requestedRoot);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Candidate workspace must be a real directory.");
  }
  const gitRoot = realpathSync(git(root, ["git", "rev-parse", "--show-toplevel"]).trim());
  if (gitRoot !== root) {
    throw new Error("Candidate workspace must be the Git worktree top-level.");
  }
  return root;
}

function normalizeGitPath(value) {
  return value.split(path.sep).join("/");
}

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== "..");
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function changedRecords(root) {
  const raw = git(root, STATUS_ARGV);
  const fields = raw.split("\0");
  const records = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    const status = field.slice(0, 2);
    const currentPath = normalizeGitPath(field.slice(3));
    let previousPath = null;
    if (status.includes("R") || status.includes("C")) {
      previousPath = normalizeGitPath(fields[index + 1] ?? "");
      index += 1;
    }
    if (!safeRelativePath(currentPath) || previousPath !== null && !safeRelativePath(previousPath)) {
      throw new Error("Git status contains an unsafe candidate path.");
    }
    records.push({ status, path: currentPath, previousPath });
  }
  return records.sort((left, right) => (
    compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.previousPath ?? "", right.previousPath ?? "")
  ));
}

function fileLedgerEntry(root, record) {
  const deleted = record.status.includes("D");
  const operation = record.status.includes("R")
    ? "renamed"
    : record.status.includes("C")
      ? "copied"
      : deleted
        ? "deleted"
        : record.status === "??" || record.status.includes("A")
          ? "added"
          : "modified";
  if (deleted) {
    return {
      path: record.path,
      previousPath: record.previousPath,
      operation,
      status: record.status,
      kind: null,
      mode: null,
      sizeBytes: null,
      sha256: null,
    };
  }
  const absolute = path.resolve(root, ...record.path.split("/"));
  if (!withinRoot(root, absolute)) throw new Error(`Candidate path escapes workspace: ${record.path}`);
  const stat = lstatSync(absolute);
  let kind;
  let material;
  if (stat.isSymbolicLink()) {
    kind = "symlink";
    const bytes = Buffer.from(readlinkSync(absolute), "utf8");
    material = { sizeBytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
  } else if (stat.isFile()) {
    kind = "file";
    material = hashRegularFile(absolute, stat);
  } else if (stat.isDirectory()) {
    kind = "gitlink";
    const bytes = Buffer.from(git(absolute, ["git", "rev-parse", "HEAD"]).trim(), "utf8");
    material = { sizeBytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
  } else {
    throw new Error(`Candidate path is not a supported file type: ${record.path}`);
  }
  return {
    path: record.path,
    previousPath: record.previousPath,
    operation,
    status: record.status,
    kind,
    mode: stat.mode & 0o777,
    ...material,
  };
}

function ledgerBinding(ledger) {
  const bytes = Buffer.from(canonicalJson(ledger), "utf8");
  return {
    ledgerByteLength: bytes.byteLength,
    ledgerSha256: sha256Bytes(bytes),
  };
}

function gitVersion() {
  return execFileSync("git", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "C" },
  }).trim();
}

export function captureCanonicalCandidateIdentityV1(workspaceRoot) {
  const root = canonicalGitRoot(workspaceRoot);
  const ledger = [];
  let totalBytes = 0;
  for (const record of changedRecords(root)) {
    const entry = fileLedgerEntry(root, record);
    totalBytes += entry.sizeBytes ?? 0;
    ledger.push(entry);
    if (ledger.length > MAX_LEDGER_FILES || totalBytes > MAX_LEDGER_BYTES) {
      throw new Error("Candidate exceeds the bounded ledger limit.");
    }
  }
  const binding = ledgerBinding(ledger);
  const headCommit = git(root, ["git", "rev-parse", "HEAD"]).trim();
  const trackedTree = git(root, ["git", "rev-parse", "HEAD^{tree}"]).trim();
  const transport = captureTransportDiff(root);
  const candidateFingerprint = sha256Canonical({
    manifestAlgorithmId: CANDIDATE_LEDGER_ALGORITHM_V1,
    headCommit,
    trackedTree,
    ledgerSha256: binding.ledgerSha256,
  });
  return {
    schemaVersion: "OwlCodaRunKitCanonicalCandidateIdentityV1",
    manifestAlgorithmId: CANDIDATE_LEDGER_ALGORITHM_V1,
    workspaceRoot: root,
    headCommit,
    trackedTree,
    gitVersion: gitVersion(),
    discoveryCommand: [...STATUS_ARGV],
    discoveryEnvironment: { ...GIT_IDENTITY_ENVIRONMENT },
    ledger,
    ...binding,
    transportDiff: {
      exactArgv: [...TRANSPORT_DIFF_ARGV],
      environment: { ...GIT_IDENTITY_ENVIRONMENT },
      sizeBytes: transport.sizeBytes,
      sha256: transport.sha256,
      identityRole: "transport_only",
    },
    candidateFingerprint,
    authorizationGranted: false,
  };
}

function excludedFilesystemPath(relativePath) {
  return relativePath === ".git"
    || relativePath.startsWith(".git/");
}

export function captureForeignWorkspaceFilesystemIdentityV1(workspaceRoot) {
  const root = canonicalGitRoot(workspaceRoot);
  const ledger = [];
  let totalFileBytes = 0;
  const visit = (directory, prefix) => {
    for (const name of readdirSync(directory).sort(compareCodeUnits)) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (excludedFilesystemPath(relativePath)) continue;
      const absolute = path.join(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        ledger.push({
          path: relativePath,
          kind: "directory",
          mode: stat.mode & 0o777,
          sizeBytes: 0,
          sha256: null,
        });
        visit(absolute, relativePath);
      } else {
        let kind;
        let material;
        if (stat.isSymbolicLink()) {
          kind = "symlink";
          const bytes = Buffer.from(readlinkSync(absolute), "utf8");
          material = { sizeBytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
        } else if (stat.isFile()) {
          kind = "file";
          if (totalFileBytes + stat.size > MAX_LEDGER_BYTES) {
            throw new Error("Foreign workspace exceeds the bounded zero-write ledger limit.");
          }
          material = hashRegularFile(absolute, stat, MAX_LEDGER_BYTES - totalFileBytes);
        } else {
          throw new Error(`Foreign workspace contains an unsupported file type: ${relativePath}`);
        }
        totalFileBytes += material.sizeBytes;
        ledger.push({
          path: relativePath,
          kind,
          mode: stat.mode & 0o777,
          ...material,
        });
      }
      if (ledger.length > MAX_LEDGER_FILES || totalFileBytes > MAX_LEDGER_BYTES) {
        throw new Error("Foreign workspace exceeds the bounded zero-write ledger limit.");
      }
    }
  };
  visit(root, "");
  ledger.sort((left, right) => compareCodeUnits(left.path, right.path));
  const binding = ledgerBinding(ledger);
  return {
    schemaVersion: "OwlCodaRunKitForeignWorkspaceFilesystemIdentityV1",
    manifestAlgorithmId: FOREIGN_FILESYSTEM_LEDGER_ALGORITHM_V1,
    workspaceRoot: root,
    excludedRoots: [".git"],
    entryCount: ledger.length,
    totalFileBytes,
    ...binding,
    filesystemFingerprint: sha256Canonical({
      manifestAlgorithmId: FOREIGN_FILESYSTEM_LEDGER_ALGORITHM_V1,
      ledgerSha256: binding.ledgerSha256,
      entryCount: ledger.length,
      totalFileBytes,
    }),
  };
}

function validLedgerEntry(value) {
  return hasExactKeys(value, [
    "path", "previousPath", "operation", "status", "kind", "mode", "sizeBytes", "sha256",
  ])
    && safeRelativePath(value.path)
    && (value.previousPath === null || safeRelativePath(value.previousPath))
    && ["added", "copied", "deleted", "modified", "renamed"].includes(value.operation)
    && typeof value.status === "string"
    && value.status.length === 2
    && (value.kind === null || ["file", "gitlink", "symlink"].includes(value.kind))
    && (value.mode === null || Number.isInteger(value.mode) && value.mode >= 0 && value.mode <= 0o777)
    && (value.sizeBytes === null || Number.isInteger(value.sizeBytes) && value.sizeBytes >= 0)
    && (value.sha256 === null || isSha256Ref(value.sha256));
}

export function validCanonicalCandidateIdentityV1(value) {
  if (!hasExactKeys(value, [
    "schemaVersion", "manifestAlgorithmId", "workspaceRoot", "headCommit", "trackedTree",
    "gitVersion", "discoveryCommand", "discoveryEnvironment", "ledger", "ledgerByteLength", "ledgerSha256",
    "transportDiff", "candidateFingerprint", "authorizationGranted",
  ])) return false;
  if (
    value.schemaVersion !== "OwlCodaRunKitCanonicalCandidateIdentityV1"
    || value.manifestAlgorithmId !== CANDIDATE_LEDGER_ALGORITHM_V1
    || typeof value.workspaceRoot !== "string"
    || !path.isAbsolute(value.workspaceRoot)
    || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value.headCommit)
    || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value.trackedTree)
    || typeof value.gitVersion !== "string"
    || JSON.stringify(value.discoveryCommand) !== JSON.stringify(STATUS_ARGV)
    || !hasExactKeys(value.discoveryEnvironment, ["GIT_OPTIONAL_LOCKS", "LC_ALL"])
    || value.discoveryEnvironment.GIT_OPTIONAL_LOCKS !== "0"
    || value.discoveryEnvironment.LC_ALL !== "C"
    || !Array.isArray(value.ledger)
    || !value.ledger.every(validLedgerEntry)
    || !isSha256Ref(value.ledgerSha256)
    || !isSha256Ref(value.candidateFingerprint)
    || value.authorizationGranted !== false
    || !hasExactKeys(value.transportDiff, ["exactArgv", "environment", "sizeBytes", "sha256", "identityRole"])
    || JSON.stringify(value.transportDiff.exactArgv) !== JSON.stringify(TRANSPORT_DIFF_ARGV)
    || !hasExactKeys(value.transportDiff.environment, ["GIT_OPTIONAL_LOCKS", "LC_ALL"])
    || value.transportDiff.environment.GIT_OPTIONAL_LOCKS !== "0"
    || value.transportDiff.environment.LC_ALL !== "C"
    || !Number.isInteger(value.transportDiff.sizeBytes)
    || value.transportDiff.sizeBytes < 0
    || !isSha256Ref(value.transportDiff.sha256)
    || value.transportDiff.identityRole !== "transport_only"
  ) return false;
  const sorted = [...value.ledger].sort((left, right) => (
    compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.previousPath ?? "", right.previousPath ?? "")
  ));
  const binding = ledgerBinding(value.ledger);
  return canonicalJson(sorted) === canonicalJson(value.ledger)
    && binding.ledgerByteLength === value.ledgerByteLength
    && binding.ledgerSha256 === value.ledgerSha256
    && value.candidateFingerprint === sha256Canonical({
      manifestAlgorithmId: CANDIDATE_LEDGER_ALGORITHM_V1,
      headCommit: value.headCommit,
      trackedTree: value.trackedTree,
      ledgerSha256: value.ledgerSha256,
    });
}

export function validForeignWorkspaceFilesystemIdentityV1(value) {
  return hasExactKeys(value, [
    "schemaVersion", "manifestAlgorithmId", "workspaceRoot", "excludedRoots", "entryCount", "totalFileBytes",
    "ledgerByteLength", "ledgerSha256", "filesystemFingerprint",
  ])
    && value.schemaVersion === "OwlCodaRunKitForeignWorkspaceFilesystemIdentityV1"
    && value.manifestAlgorithmId === FOREIGN_FILESYSTEM_LEDGER_ALGORITHM_V1
    && typeof value.workspaceRoot === "string"
    && path.isAbsolute(value.workspaceRoot)
    && JSON.stringify(value.excludedRoots) === JSON.stringify([".git"])
    && Number.isInteger(value.entryCount)
    && value.entryCount >= 0
    && Number.isInteger(value.totalFileBytes)
    && value.totalFileBytes >= 0
    && Number.isInteger(value.ledgerByteLength)
    && value.ledgerByteLength >= 0
    && isSha256Ref(value.ledgerSha256)
    && isSha256Ref(value.filesystemFingerprint)
    && value.filesystemFingerprint === sha256Canonical({
      manifestAlgorithmId: FOREIGN_FILESYSTEM_LEDGER_ALGORITHM_V1,
      ledgerSha256: value.ledgerSha256,
      entryCount: value.entryCount,
      totalFileBytes: value.totalFileBytes,
    });
}
