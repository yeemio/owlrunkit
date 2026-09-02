import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { captureDependencyEnvironment } from "../../packages/attest/src/dependency-environment.mjs";
import { sha256Bytes, sha256Canonical } from "./quick-canonical.mjs";

const CONTROL_ROOT = ".owlcoda/runkit";
const MAX_SOURCE_FILES = 100_000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const CACHE_ENVIRONMENT = Object.freeze({
  TMPDIR: "tmp",
  TMP: "tmp",
  TEMP: "tmp",
  XDG_CACHE_HOME: "cache/xdg",
  npm_config_cache: "cache/npm",
  NPM_CONFIG_CACHE: "cache/npm",
  YARN_CACHE_FOLDER: "cache/yarn",
  PIP_CACHE_DIR: "cache/pip",
  UV_CACHE_DIR: "cache/uv",
  CARGO_TARGET_DIR: "cache/cargo-target",
  GOCACHE: "cache/go-build",
  GOMODCACHE: "cache/go-mod",
  PYTHONPYCACHEPREFIX: "cache/python-bytecode",
});

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function rootsOverlap(left, right) {
  return withinRoot(left, right) || withinRoot(right, left);
}

function canonicalRealDirectory(requested, label) {
  const absolute = path.resolve(requested);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(absolute) !== absolute) {
    throw new Error(`${label} must be a real directory without symlink traversal.`);
  }
  return absolute;
}

function sourcePaths(root) {
  return git(root, ["ls-files", "-co", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map(normalizePath)
    .filter(relativePath => relativePath !== CONTROL_ROOT && !relativePath.startsWith(`${CONTROL_ROOT}/`))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function symlinkHash(linkTarget) {
  return sha256Bytes(Buffer.from(`symlink:${linkTarget}`, "utf8"));
}

function copyVisibleSource(root, consumerRoot) {
  const files = [];
  let totalBytes = 0;
  for (const relativePath of sourcePaths(root)) {
    const source = path.resolve(root, ...relativePath.split("/"));
    const target = path.resolve(consumerRoot, ...relativePath.split("/"));
    if (!withinRoot(root, source) || !withinRoot(consumerRoot, target)) {
      throw new Error(`Isolated source path escapes its root: ${relativePath}`);
    }
    const stat = lstatSync(source);
    mkdirSync(path.dirname(target), { recursive: true });
    let hash;
    if (stat.isSymbolicLink()) {
      const linkTarget = readlinkSync(source);
      if (path.isAbsolute(linkTarget)) {
        throw new Error(`Isolated source copy rejects an absolute symlink: ${relativePath}`);
      }
      const resolvedTarget = realpathSync(path.resolve(path.dirname(source), linkTarget));
      if (!withinRoot(root, resolvedTarget)) {
        throw new Error(`Isolated source copy rejects a symlink escape: ${relativePath}`);
      }
      symlinkSync(linkTarget, target);
      hash = symlinkHash(linkTarget);
    } else if (stat.isFile()) {
      totalBytes += stat.size;
      copyFileSync(source, target);
      chmodSync(target, stat.mode & 0o777);
      hash = sha256Bytes(readFileSync(source));
    } else {
      throw new Error(`Isolated source copy does not support a directory or special Git entry: ${relativePath}`);
    }
    files.push({ path: relativePath, sha256: hash });
    if (files.length > MAX_SOURCE_FILES || totalBytes > MAX_SOURCE_BYTES) {
      throw new Error("Isolated source copy exceeds the bounded file or byte limit.");
    }
  }
  return {
    files,
    fileCount: files.length,
    totalBytes,
    fingerprint: sha256Canonical(files),
  };
}

function projectNodeModules(dependencyRoot, consumerRoot) {
  if (dependencyRoot === null) return null;
  const sourceRoot = path.join(dependencyRoot.root, "node_modules");
  const targetRoot = path.join(consumerRoot, "node_modules");
  mkdirSync(targetRoot);
  for (const name of readdirSync(sourceRoot).sort((left, right) => left.localeCompare(right, "en"))) {
    const source = path.join(sourceRoot, name);
    const target = path.join(targetRoot, name);
    const stat = lstatSync(source);
    if (name === ".bin") {
      mkdirSync(target);
      for (const binName of readdirSync(source).sort((left, right) => left.localeCompare(right, "en"))) {
        const sourceBin = path.join(source, binName);
        const targetBin = path.join(target, binName);
        const binStat = lstatSync(sourceBin);
        if (binStat.isSymbolicLink()) {
          const realBin = realpathSync(sourceBin);
          symlinkSync(realBin, targetBin, "file");
        } else if (binStat.isFile()) {
          copyFileSync(sourceBin, targetBin);
          chmodSync(targetBin, binStat.mode & 0o777);
        }
      }
      continue;
    }
    if (name.startsWith("@") && stat.isDirectory() && !stat.isSymbolicLink()) {
      mkdirSync(target);
      for (const child of readdirSync(source).sort((left, right) => left.localeCompare(right, "en"))) {
        symlinkSync(realpathSync(path.join(source, child)), path.join(target, child), "dir");
      }
      continue;
    }
    if (stat.isFile()) {
      copyFileSync(source, target);
      continue;
    }
    symlinkSync(realpathSync(source), target, "dir");
  }
  return targetRoot;
}

function isolatedEnvironment(consumerRoot, dependencyEnvironment) {
  const controlRoot = path.join(consumerRoot, ".owlrunkit-isolation");
  const overrides = {};
  for (const [name, relativePath] of Object.entries(CACHE_ENVIRONMENT)) {
    const target = path.join(controlRoot, relativePath);
    mkdirSync(target, { recursive: true });
    overrides[name] = target;
  }
  overrides.OWLRUNKIT_CONSUMER_ROOT = consumerRoot;
  overrides.PWD = consumerRoot;
  overrides.INIT_CWD = consumerRoot;
  if (dependencyEnvironment !== null) {
    overrides.OWLRUNKIT_DEPENDENCY_ROOT = dependencyEnvironment.root;
    overrides.NODE_PATH = [
      path.join(consumerRoot, "node_modules"),
      process.env.NODE_PATH,
    ].filter(Boolean).join(path.delimiter);
    overrides.PATH = [
      path.join(consumerRoot, "node_modules", ".bin"),
      process.env.PATH,
    ].filter(Boolean).join(path.delimiter);
  }
  return {
    controlRoot,
    overrides,
    environmentVariables: Object.keys(overrides).sort(),
  };
}

export function prepareQuickIsolation({ workspaceRoot, dependencyRoot }) {
  const sourceRoot = canonicalRealDirectory(workspaceRoot, "Source workspace");
  const consumerRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "owlrunkit-quick-consumer-")));
  try {
    const sourceCopy = copyVisibleSource(sourceRoot, consumerRoot);
    const dependencyEnvironment = captureDependencyEnvironment(dependencyRoot);
    if (dependencyEnvironment !== null && rootsOverlap(sourceRoot, dependencyEnvironment.root)) {
      throw new Error("Dependency root and source workspace must be disjoint real directories.");
    }
    projectNodeModules(dependencyEnvironment, consumerRoot);
    const environment = isolatedEnvironment(consumerRoot, dependencyEnvironment);
    return {
      schemaVersion: "OwlCodaRunKitQuickIsolationV1",
      sourceRoot,
      consumerRoot,
      sourceCopy,
      dependencyEnvironment,
      environment,
    };
  } catch (error) {
    rmSync(consumerRoot, { recursive: true, force: true });
    throw error;
  }
}

function currentConsumerFiles(consumerRoot) {
  const files = [];
  const visit = (directory, prefix) => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right, "en"))) {
      if (prefix === "" && ["node_modules", ".owlrunkit-isolation"].includes(name)) continue;
      const absolute = path.join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        visit(absolute, relativePath);
      } else if (stat.isSymbolicLink()) {
        files.push({ path: relativePath, sha256: symlinkHash(readlinkSync(absolute)) });
      } else if (stat.isFile()) {
        files.push({ path: relativePath, sha256: sha256Bytes(readFileSync(absolute)) });
      } else {
        files.push({ path: relativePath, sha256: "special" });
      }
      if (files.length > MAX_SOURCE_FILES) {
        throw new Error("Isolated consumer delta exceeds the bounded file limit.");
      }
    }
  };
  visit(consumerRoot, "");
  return files;
}

function ignoredByGit(sourceRoot, relativePath) {
  if (relativePath === CONTROL_ROOT || relativePath.startsWith(`${CONTROL_ROOT}/`)) return true;
  try {
    git(sourceRoot, ["check-ignore", "--no-index", "-q", "--", relativePath]);
    return true;
  } catch {
    return false;
  }
}

export function inspectQuickIsolation(isolation) {
  const before = new Map(isolation.sourceCopy.files.map(row => [row.path, row.sha256]));
  const afterRows = currentConsumerFiles(isolation.consumerRoot);
  const after = new Map(afterRows.map(row => [row.path, row.sha256]));
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter(relativePath => before.get(relativePath) !== after.get(relativePath))
    .sort((left, right) => left.localeCompare(right, "en"));
  const sourcePaths = [];
  const ignoredPaths = [];
  for (const relativePath of changed) {
    if (!before.has(relativePath) && ignoredByGit(isolation.sourceRoot, relativePath)) {
      ignoredPaths.push(relativePath);
    } else {
      sourcePaths.push(relativePath);
    }
  }
  let dependencyEnvironmentAfter = null;
  let dependencyChanged = false;
  if (isolation.dependencyEnvironment !== null) {
    try {
      dependencyEnvironmentAfter = captureDependencyEnvironment(
        isolation.dependencyEnvironment.root,
      );
      dependencyChanged = dependencyEnvironmentAfter.fingerprint
        !== isolation.dependencyEnvironment.fingerprint;
    } catch {
      dependencyChanged = true;
    }
  }
  return {
    consumerDelta: { sourcePaths, ignoredPaths },
    dependencyEnvironmentAfter,
    dependencyChanged,
  };
}

export function removeQuickIsolation(isolation) {
  try {
    rmSync(isolation.consumerRoot, { recursive: true, force: true });
    return "removed";
  } catch {
    return "cleanup_failed";
  }
}

export function dependencyEnvironmentMatches(binding) {
  if (binding === null) return true;
  try {
    return captureDependencyEnvironment(binding.root).fingerprint === binding.fingerprint;
  } catch {
    return false;
  }
}
