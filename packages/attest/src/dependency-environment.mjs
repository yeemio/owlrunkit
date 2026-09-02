import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { sha256Bytes, sha256Canonical } from "./formal.mjs";

const MAX_DEPENDENCY_MATERIAL_BYTES = 128 * 1024 * 1024;
const DEPENDENCY_MATERIALS = Object.freeze([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  "node_modules/.package-lock.json",
  "node_modules/.modules.yaml",
]);

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function comparePaths(left, right) {
  return left.localeCompare(right, "en");
}

function canonicalRealDirectory(requested, label) {
  const absolute = path.resolve(requested);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(absolute) !== absolute) {
    throw new Error(`${label} must be a real directory without symlink traversal.`);
  }
  return absolute;
}

function dependencyMaterial(root, relativePath, budget) {
  const absolute = path.resolve(root, ...relativePath.split("/"));
  if (!withinRoot(root, absolute) || !existsSync(absolute)) return null;
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(absolute) !== absolute) {
    throw new Error(`Dependency binding material must be a regular non-symlink file: ${relativePath}`);
  }
  budget.bytes += stat.size;
  if (budget.bytes > MAX_DEPENDENCY_MATERIAL_BYTES) {
    throw new Error("Dependency binding material exceeds the byte limit.");
  }
  return { path: relativePath, sha256: sha256Bytes(readFileSync(absolute)) };
}

function installedDependencyMaterialPaths(root) {
  const nodeModules = path.join(root, "node_modules");
  const discovered = new Set();
  const addRealFile = (candidate) => {
    let resolved;
    try {
      resolved = realpathSync(candidate);
    } catch {
      return;
    }
    if (!withinRoot(root, resolved) || !lstatSync(resolved).isFile()) {
      throw new Error("Dependency resolution metadata escapes its declared root.");
    }
    discovered.add(normalizePath(path.relative(root, resolved)));
  };
  const addPackage = (candidate) => addRealFile(path.join(realpathSync(candidate), "package.json"));
  for (const name of readdirSync(nodeModules).sort(comparePaths)) {
    if (name === ".bin") {
      for (const binName of readdirSync(path.join(nodeModules, name)).sort(comparePaths)) {
        addRealFile(path.join(nodeModules, name, binName));
      }
      continue;
    }
    if (name.startsWith(".")) continue;
    const entry = path.join(nodeModules, name);
    const stat = lstatSync(entry);
    if (name.startsWith("@") && stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const child of readdirSync(entry).sort(comparePaths)) addPackage(path.join(entry, child));
    } else {
      addPackage(entry);
    }
    if (discovered.size > 20_000) {
      throw new Error("Dependency resolution metadata exceeds the file limit.");
    }
  }
  return [...discovered].sort(comparePaths);
}

export function captureDependencyEnvironment(dependencyRoot) {
  if (dependencyRoot === undefined || dependencyRoot === null) return null;
  const root = canonicalRealDirectory(dependencyRoot, "Dependency root");
  const nodeModules = path.join(root, "node_modules");
  const nodeModulesStat = lstatSync(nodeModules);
  if (nodeModulesStat.isSymbolicLink()
    || !nodeModulesStat.isDirectory()
    || realpathSync(nodeModules) !== nodeModules) {
    throw new Error("Dependency root must contain a real node_modules directory.");
  }
  const budget = { bytes: 0 };
  const materialPaths = [...new Set([
    ...DEPENDENCY_MATERIALS,
    ...installedDependencyMaterialPaths(root),
  ])].sort(comparePaths);
  const materials = materialPaths
    .map(relativePath => dependencyMaterial(root, relativePath, budget))
    .filter(Boolean);
  if (!materials.some(material => material.path === "package.json") || materials.length < 2) {
    throw new Error("Dependency root must bind package.json and lock or install metadata.");
  }
  const identity = { root, materials };
  return {
    ...identity,
    fingerprint: sha256Canonical(identity),
  };
}
