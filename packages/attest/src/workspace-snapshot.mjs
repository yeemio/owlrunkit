import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

import { sha256Bytes, sha256Canonical } from "./formal.mjs";

const CONTROL_ROOT = ".owlcoda/runkit";
const MAX_BOUND_IGNORED_FILES = 10_000;
const MAX_BOUND_IGNORED_BYTES = 512 * 1024 * 1024;
const LOCKFILE_NAMES = new Set([
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

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
}

function optionalGit(root, args) {
  try {
    return git(root, args).trim();
  } catch {
    return "";
  }
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function isControlPath(value) {
  return value === CONTROL_ROOT || value.startsWith(`${CONTROL_ROOT}/`);
}

function fileHash(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    return sha256Bytes(Buffer.from(`symlink:${readlinkSync(absolutePath)}`, "utf8"));
  }
  if (stat.isDirectory()) {
    const commit = optionalGit(absolutePath, ["rev-parse", "HEAD"]);
    return sha256Canonical({
      algorithm: "gitlink-worktree-v1",
      commit,
      dirtyOverlay: parseStatus(absolutePath),
      submodules: submodules(absolutePath),
    });
  }
  return sha256Bytes(readFileSync(absolutePath));
}

function parseStatus(root) {
  const raw = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const fields = raw.split("\0");
  const entries = new Map();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    const status = field.slice(0, 2);
    const currentPath = normalizePath(field.slice(3));
    let priorPath = null;
    if (status.includes("R") || status.includes("C")) {
      const prior = fields[index + 1];
      if (!prior) throw new Error("Git status rename entry is incomplete.");
      priorPath = normalizePath(prior);
      index += 1;
    }
    if (status.includes("R") && priorPath && !isControlPath(priorPath)) {
      entries.set(priorPath, { path: priorPath, state: "deleted", sha256: null });
    }
    if (!currentPath || isControlPath(currentPath)) continue;
    let state = "modified";
    if (status === "??") state = "untracked";
    if (status.includes("D")) state = "deleted";
    let sha256 = null;
    if (state !== "deleted") {
      try {
        sha256 = fileHash(root, currentPath);
      } catch {
        state = "deleted";
      }
    }
    entries.set(currentPath, { path: currentPath, state, sha256 });
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function submodules(root) {
  const output = optionalGit(root, ["submodule", "status", "--recursive"]);
  if (!output) return [];
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = /^[ +-U]?([0-9a-f]{40,64})\s+([^\s]+)/.exec(line);
      if (!match) throw new Error(`Cannot parse git submodule status: ${line}`);
      return { path: normalizePath(match[2]), commit: match[1] };
    })
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function dependencyLockfiles(root) {
  const raw = git(root, ["ls-files", "-co", "--exclude-standard", "-z"]);
  return raw
    .split("\0")
    .filter(Boolean)
    .map(normalizePath)
    .filter((entry) => !isControlPath(entry) && LOCKFILE_NAMES.has(path.posix.basename(entry)))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((entry) => ({ path: entry, sha256: fileHash(root, entry) }));
}

function sanitizedRemoteIdentity(remote) {
  try {
    const parsed = new URL(remote);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return remote.replace(/^[^/@\s]+@(?=[^/\s]+:)/, "");
  }
}

function repositoryIdentity(root) {
  const remote = optionalGit(root, ["remote", "get-url", "origin"]);
  if (remote) return sanitizedRemoteIdentity(remote);
  return `local:${realpathSync(root)}`;
}

function trackedTreeIdentity(root, headCommit) {
  const tree = headCommit ? git(root, ["rev-parse", "HEAD^{tree}"]).trim() : "";
  const objectFormat = optionalGit(root, ["rev-parse", "--show-object-format"]) || "sha1";
  return sha256Canonical({
    algorithm: "git-tree-object-v1",
    objectFormat,
    tree,
  });
}

function safeIgnoredPath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  const segments = value.split("/");
  return segments.every(segment => segment.length > 0 && segment !== "." && segment !== "..")
    && !isControlPath(value);
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertIgnoredByGit(root, relativePath) {
  const tracked = git(root, ["ls-files", "-z", "--", relativePath]);
  if (tracked.length > 0) {
    throw new Error(`Explicit ignored binding cannot replace tracked source binding: ${relativePath}`);
  }
  try {
    git(root, ["check-ignore", "--no-index", "-q", "--", relativePath]);
  } catch {
    throw new Error(`Explicit ignored binding is not covered by Git ignore rules: ${relativePath}`);
  }
}

function hashIgnoredTree(root, relativePath, budget) {
  const absolute = path.resolve(root, ...relativePath.split("/"));
  if (!withinRoot(root, absolute)) throw new Error(`Ignored binding escapes workspace: ${relativePath}`);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return { path: relativePath, state: "missing", sha256: null };
    throw error;
  }
  if (stat.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new Error(`Ignored binding cannot traverse a symlink: ${relativePath}`);
  }
  if (stat.isFile()) {
    budget.files += 1;
    budget.bytes += stat.size;
    if (budget.files > MAX_BOUND_IGNORED_FILES || budget.bytes > MAX_BOUND_IGNORED_BYTES) {
      throw new Error("Explicit ignored binding exceeds the bounded file or byte limit.");
    }
    return { path: relativePath, state: "file", sha256: sha256Bytes(readFileSync(absolute)) };
  }
  if (!stat.isDirectory()) {
    throw new Error(`Ignored binding must be a regular file, directory, or missing path: ${relativePath}`);
  }
  const files = [];
  const visit = (directory, prefix) => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right, "en"))) {
      const child = path.join(directory, name);
      const childRelative = prefix ? `${prefix}/${name}` : name;
      const childStat = lstatSync(child);
      if (childStat.isSymbolicLink() || realpathSync(child) !== child) {
        throw new Error(`Ignored binding cannot traverse a symlink: ${relativePath}/${childRelative}`);
      }
      if (childStat.isDirectory()) {
        visit(child, childRelative);
      } else if (childStat.isFile()) {
        budget.files += 1;
        budget.bytes += childStat.size;
        if (budget.files > MAX_BOUND_IGNORED_FILES || budget.bytes > MAX_BOUND_IGNORED_BYTES) {
          throw new Error("Explicit ignored binding exceeds the bounded file or byte limit.");
        }
        files.push({ path: childRelative, sha256: sha256Bytes(readFileSync(child)) });
      } else {
        throw new Error(`Ignored binding contains a special file: ${relativePath}/${childRelative}`);
      }
    }
  };
  visit(absolute, "");
  return { path: relativePath, state: "directory", sha256: sha256Canonical(files) };
}

function bindIgnoredPaths(root, requestedPaths) {
  if (!Array.isArray(requestedPaths)
    || requestedPaths.length === 0
    || requestedPaths.some(value => !safeIgnoredPath(value))) {
    throw new Error("Explicit ignored bindings must be safe literal workspace-relative paths.");
  }
  const paths = [...new Set(requestedPaths)].sort((left, right) => left.localeCompare(right, "en"));
  if (paths.length !== requestedPaths.length) {
    throw new Error("Explicit ignored bindings must not contain duplicates.");
  }
  const budget = { files: 0, bytes: 0 };
  return paths.map(relativePath => {
    assertIgnoredByGit(root, relativePath);
    return hashIgnoredTree(root, relativePath, budget);
  });
}

export function workspaceSourceStateFingerprint(snapshot) {
  return sha256Canonical({
    repositoryIdentity: snapshot.repositoryIdentity,
    headCommit: snapshot.headCommit,
    trackedTreeIdentity: snapshot.trackedTreeIdentity,
    submodules: snapshot.submodules,
    dirtyOverlay: snapshot.dirtyOverlay,
    dependencyLockfiles: snapshot.dependencyLockfiles,
    excludedRoots: snapshot.excludedRoots,
  });
}

export function captureWorkspaceSnapshot(workspaceRoot, { ignoredPaths = [] } = {}) {
  const root = realpathSync(workspaceRoot);
  git(root, ["rev-parse", "--is-inside-work-tree"]);
  const headCommit = optionalGit(root, ["rev-parse", "HEAD"]) || null;
  const base = {
    repositoryIdentity: repositoryIdentity(root),
    headCommit,
    trackedTreeIdentity: trackedTreeIdentity(root, headCommit),
    submodules: submodules(root),
    dirtyOverlay: parseStatus(root),
    dependencyLockfiles: dependencyLockfiles(root),
    excludedRoots: [CONTROL_ROOT],
  };
  if (ignoredPaths.length === 0) {
    const payload = {
      schemaVersion: "OwlCodaWorkspaceSnapshotV1",
      ...base,
      ignoredPathsBound: false,
      policyVersion: "workspace-snapshot-v1",
    };
    return {
      ...payload,
      sourceFingerprint: sha256Canonical(payload),
    };
  }
  const ignoredPathBindings = bindIgnoredPaths(root, ignoredPaths);
  const payload = {
    schemaVersion: "OwlCodaWorkspaceSnapshotV2",
    ...base,
    ignoredPathsBound: true,
    ignoredPathBindings,
    ignoredPathsFingerprint: sha256Canonical(ignoredPathBindings),
    sourceStateFingerprint: workspaceSourceStateFingerprint(base),
    policyVersion: "workspace-snapshot-v2",
  };
  return {
    ...payload,
    sourceFingerprint: sha256Canonical(payload),
  };
}
