import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  readWorkspaceJsonBounded,
  resolveBoundedWorkspaceRoot,
} from "./onboarding-doctor.mjs";
import { resolveProfileImpactDetailed } from "./profile-impact.mjs";
import {
  safeIdentifier,
  safeRelativePath,
} from "./provenance-common.mjs";

function resolveRegularExecutable(name) {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter);
  const suffixes = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const directory of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = path.resolve(directory || ".", `${name}${suffix}`);
      try {
        const resolved = realpathSync(candidate);
        const stat = lstatSync(resolved);
        if (stat.isFile() && !stat.isSymbolicLink()) return resolved;
      } catch {
        // Continue through PATH without treating a missing or unsafe entry as authority.
      }
    }
  }
  return null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("profile_detection_noncanonical_value");
  return encoded;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedRegularFile(root, relativePath) {
  safeRelativePath(relativePath, "profile detection input");
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`profile_detection_input_outside_workspace:${relativePath}`);
  }
  const stat = lstatSync(absolute);
  const resolved = realpathSync(absolute);
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || resolved !== absolute
  ) {
    throw new Error(`profile_detection_input_not_regular:${relativePath}`);
  }
  return absolute;
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function ensureDirectoryChain(root, relativeDirectory) {
  let current = root;
  for (const segment of relativeDirectory.split("/")) {
    current = path.join(current, segment);
    try {
      lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      mkdirSync(current);
    }
    const stat = lstatSync(current);
    const resolved = realpathSync(current);
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || resolved !== current
      || !insideRoot(root, resolved)
    ) {
      throw new Error("profile_apply_directory_untrusted");
    }
  }
  return current;
}

function regularExecutable(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) return null;
  try {
    const resolved = realpathSync(value);
    const stat = lstatSync(resolved);
    return stat.isFile() && !stat.isSymbolicLink() ? resolved : null;
  } catch {
    return null;
  }
}

function toolIdentity(executable, argvPrefix, version) {
  const launcher = regularExecutable(argvPrefix[0] ?? executable);
  if (!launcher || typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+/.test(version)) {
    return null;
  }
  return {
    version,
    executableSha256: sha256(readFileSync(executable)),
    launcherSha256: sha256(readFileSync(launcher)),
  };
}

function defaultProjectNpm(root, manifest) {
  try {
    if (
      typeof manifest.packageManager === "string"
      && !manifest.packageManager.startsWith("npm@")
    ) return null;
    const lockPath = boundedRegularFile(root, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(lock.lockfileVersion)) return null;
    const executable = regularExecutable(process.execPath);
    if (!executable) return null;
    const npmEntry = path.join(
      path.dirname(executable),
      process.platform === "win32" ? "npm.cmd" : "npm",
    );
    const npmCli = regularExecutable(npmEntry);
    if (!npmCli || process.platform === "win32") return null;
    const npmManifestPath = path.resolve(npmCli, "..", "..", "package.json");
    const npmManifest = JSON.parse(readFileSync(npmManifestPath, "utf8"));
    if (
      npmManifest.name !== "npm"
      || typeof npmManifest.version !== "string"
      || (
        typeof manifest.packageManager === "string"
        && manifest.packageManager.startsWith("npm@")
        && manifest.packageManager.slice(4) !== npmManifest.version
      )
    ) {
      return null;
    }
    const identity = toolIdentity(executable, [npmCli], npmManifest.version);
    if (!identity) return null;
    return {
      status: "resolved",
      confidence: "high",
      source: "project_lockfile",
      packageManager: "npm",
      executable,
      argvPrefix: [npmCli],
      inputFiles: ["package.json", "package-lock.json"],
      issueCodes: [],
      ...identity,
    };
  } catch {
    return null;
  }
}

function selectedPackageManager(root, manifest) {
  const declared = typeof manifest.packageManager === "string"
    ? /^(npm|pnpm|yarn|bun)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/
      .exec(manifest.packageManager)
    : null;
  const lockfiles = [
    { manager: "npm", refs: ["package-lock.json"] },
    { manager: "pnpm", refs: ["pnpm-lock.yaml"] },
    { manager: "yarn", refs: ["yarn.lock"] },
    { manager: "bun", refs: ["bun.lock", "bun.lockb"] },
  ].flatMap(entry => entry.refs
    .filter(ref => existsSync(path.join(root, ref)))
    .map(ref => ({ manager: entry.manager, ref })));
  if (lockfiles.length !== 1) return {
    manager: declared?.[1] ?? null,
    version: declared?.[2] ?? null,
    lockfile: null,
  };
  if (declared && declared[1] !== lockfiles[0].manager) {
    return {
      manager: declared[1],
      version: declared[2],
      lockfile: null,
    };
  }
  return {
    manager: declared?.[1] ?? lockfiles[0].manager,
    version: declared?.[2] ?? null,
    lockfile: lockfiles[0].ref,
  };
}

function defaultProjectInstalledManager(root, manifest) {
  const selected = selectedPackageManager(root, manifest);
  if (
    selected.manager === null
    || selected.manager === "npm"
    || selected.version === null
    || selected.lockfile === null
  ) return null;
  try {
    boundedRegularFile(root, selected.lockfile);
    const requestedPackageRoot = path.join(
      root,
      "node_modules",
      selected.manager,
    );
    const packageRoot = realpathSync(requestedPackageRoot);
    if (!insideRoot(root, packageRoot)) return null;
    const managerManifestPath = path.join(packageRoot, "package.json");
    const managerManifestStat = lstatSync(managerManifestPath);
    if (
      managerManifestStat.isSymbolicLink()
      || !managerManifestStat.isFile()
      || realpathSync(managerManifestPath) !== managerManifestPath
    ) return null;
    const managerManifest = JSON.parse(readFileSync(managerManifestPath, "utf8"));
    if (
      managerManifest.name !== selected.manager
      || managerManifest.version !== selected.version
    ) return null;
    const declaredBin = typeof managerManifest.bin === "string"
      ? managerManifest.bin
      : managerManifest.bin?.[selected.manager];
    if (typeof declaredBin !== "string" || declaredBin.length === 0) return null;
    safeRelativePath(declaredBin, "project package manager bin");
    const launcher = realpathSync(path.join(packageRoot, declaredBin));
    const launcherStat = lstatSync(launcher);
    if (
      !insideRoot(root, launcher)
      || launcherStat.isSymbolicLink()
      || !launcherStat.isFile()
    ) return null;
    const executable = regularExecutable(process.execPath);
    if (!executable) return null;
    const identity = toolIdentity(executable, [launcher], selected.version);
    if (!identity) return null;
    const managerManifestRef = path.relative(root, managerManifestPath)
      .split(path.sep)
      .join("/");
    const launcherRef = path.relative(root, launcher)
      .split(path.sep)
      .join("/");
    return {
      status: "resolved",
      confidence: "high",
      source: "project_install",
      packageManager: selected.manager,
      executable,
      argvPrefix: [launcher],
      inputFiles: [
        "package.json",
        selected.lockfile,
        managerManifestRef,
        launcherRef,
      ].sort(),
      issueCodes: [],
      ...identity,
    };
  } catch {
    return null;
  }
}

function resolveProjectTool(root, manifest, projectToolResolver) {
  const selected = selectedPackageManager(root, manifest);
  const packageManager = selected.manager ?? "npm";
  if (typeof projectToolResolver === "function") {
    try {
      const resolved = projectToolResolver({
        workspaceRoot: root,
        tool: packageManager,
        manifest: structuredClone(manifest),
      });
      const executable = regularExecutable(resolved?.executable);
      const argvPrefix = Array.isArray(resolved?.argvPrefix)
        && resolved.argvPrefix.every(value => typeof value === "string" && value.length > 0)
        ? [...resolved.argvPrefix]
        : null;
      const inputFiles = Array.isArray(resolved?.inputFiles)
        && resolved.inputFiles.every(value => typeof value === "string" && value.length > 0)
        ? [...new Set(resolved.inputFiles)].sort()
        : null;
      const authoritativeSource = new Set([
        "project_install",
        "project_lockfile",
        "project_toolchain",
      ]).has(resolved?.source);
      const identity = executable && argvPrefix
        ? toolIdentity(executable, argvPrefix, resolved?.version)
        : null;
      const lockBound = inputFiles?.includes("package.json")
        && inputFiles.some(ref => [
          "bun.lock",
          "bun.lockb",
          "package-lock.json",
          "pnpm-lock.yaml",
          "yarn.lock",
        ].includes(ref));
      if (
        resolved?.status === "resolved"
        && executable
        && argvPrefix
        && inputFiles
        && identity
      ) {
        const high = resolved.confidence === "high"
          && authoritativeSource
          && lockBound;
        return {
          status: "resolved",
          confidence: high ? "high" : "review_required",
          source: String(resolved.source ?? "injected_resolver"),
          packageManager,
          executable,
          argvPrefix,
          inputFiles,
          issueCodes: high ? [] : ["project_tool_resolution_not_authoritative"],
          ...identity,
        };
      }
      return {
        status: "invalid",
        confidence: "review_required",
        source: "injected_resolver",
        packageManager,
        executable: null,
        argvPrefix: [],
        inputFiles: [],
        version: null,
        executableSha256: null,
        launcherSha256: null,
        issueCodes: ["project_tool_resolution_invalid"],
      };
    } catch {
      return {
        status: "invalid",
        confidence: "review_required",
        source: "injected_resolver",
        packageManager,
        executable: null,
        argvPrefix: [],
        inputFiles: [],
        version: null,
        executableSha256: null,
        launcherSha256: null,
        issueCodes: ["project_tool_resolution_failed"],
      };
    }
  }

  const installedManager = defaultProjectInstalledManager(root, manifest);
  if (installedManager) return installedManager;
  const projectNpm = defaultProjectNpm(root, manifest);
  if (projectNpm) return projectNpm;
  const executable = resolveRegularExecutable(packageManager);
  return {
    status: executable ? "resolved" : "unavailable",
    confidence: "review_required",
    source: executable ? "path_fallback" : "unavailable",
    packageManager,
    executable,
    argvPrefix: [],
    inputFiles: [],
    version: null,
    executableSha256: executable ? sha256(readFileSync(executable)) : null,
    launcherSha256: null,
    issueCodes: ["project_tool_resolution_not_authoritative"],
  };
}

function command(id, script, executable) {
  return {
    id,
    cwd: ".",
    executable,
    argv: ["run", script],
  };
}

function workspaceCommand(
  id,
  workspacePath,
  script,
  executable,
  useWorkspaceCwd = false,
) {
  return {
    id,
    cwd: useWorkspaceCwd ? workspacePath : ".",
    executable,
    argv: useWorkspaceCwd
      ? ["run", script]
      : ["run", "--workspace", workspacePath, script],
  };
}

function detectedScripts(manifest) {
  return Object.keys(manifest.scripts ?? {}).sort();
}

function workspacePatterns(manifest) {
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  if (
    manifest.workspaces
    && typeof manifest.workspaces === "object"
    && Array.isArray(manifest.workspaces.packages)
  ) {
    return manifest.workspaces.packages;
  }
  return [];
}

function safeWorkspacePattern(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || path.isAbsolute(value)
    || value.includes("\\")
    || value.includes("\0")
  ) {
    return null;
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  const wildcardCount = [...value].filter((character) => character === "*").length;
  if (wildcardCount === 0) return { kind: "literal", path: value };
  if (wildcardCount === 1 && value.endsWith("/*")) {
    return { kind: "children", path: value.slice(0, -2) };
  }
  return null;
}

function discoverWorkspaces(root, manifest) {
  const warnings = [];
  const paths = new Set();
  for (const rawPattern of workspacePatterns(manifest)) {
    const pattern = safeWorkspacePattern(rawPattern);
    if (pattern === null) {
      warnings.push(`unsupported_workspace_pattern:${String(rawPattern)}`);
      continue;
    }
    if (pattern.kind === "literal") {
      paths.add(pattern.path);
      continue;
    }
    const parent = path.join(root, pattern.path);
    try {
      const parentStat = lstatSync(parent);
      if (
        parentStat.isSymbolicLink()
        || !parentStat.isDirectory()
        || realpathSync(parent) !== path.resolve(parent)
      ) {
        warnings.push(`unsafe_workspace_parent:${pattern.path}`);
        continue;
      }
      for (const entry of readdirSync(parent, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          paths.add(`${pattern.path}/${entry.name}`);
        }
      }
    } catch {
      // A declared workspace pattern may legitimately have no current matches.
    }
  }

  const workspaces = [];
  for (const workspacePath of [...paths].sort()) {
    try {
      const workspaceManifest = readWorkspaceJsonBounded(
        root,
        path.join(workspacePath, "package.json"),
      );
      workspaces.push({
        name: typeof workspaceManifest.name === "string"
          ? workspaceManifest.name
          : workspacePath,
        path: workspacePath,
        scripts: detectedScripts(workspaceManifest),
      });
    } catch {
      warnings.push(`workspace_manifest_unreadable:${workspacePath}`);
    }
  }
  return {
    workspaces,
    warnings: [...new Set(warnings)].sort(),
  };
}

function profileIdForWorkspace(workspacePath) {
  return `workspace-${workspacePath.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

function workspaceProfiles(
  workspaces,
  npmExecutable,
  packageManager = "npm",
  useWorkspaceCwd = false,
) {
  return workspaces
    .map((workspace) => {
      const qualityScripts = workspace.scripts.filter((script) =>
        ["build", "e2e", "lint", "test", "typecheck"].includes(script));
      if (qualityScripts.length === 0) return null;
      const profileId = profileIdForWorkspace(workspace.path);
      return {
        id: profileId,
        paths: [`${workspace.path}/**`],
        role: "primary",
        primary: false,
        requiresProfileIds: [],
        commands: npmExecutable
          ? qualityScripts.map((script) => workspaceCommand(
              `${packageManager}-${profileId}-${script}`,
              workspace.path,
              script,
              npmExecutable,
              useWorkspaceCwd,
            ))
          : [],
      };
    })
    .filter(Boolean);
}

function existingProfileSurface(root, relativePath, profilePath) {
  const absolute = path.join(root, relativePath);
  try {
    const stat = lstatSync(absolute);
    return stat.isDirectory()
      && !stat.isSymbolicLink()
      && realpathSync(absolute) === path.resolve(absolute)
      ? profilePath
      : null;
  } catch {
    return null;
  }
}

function existingProfileFile(root, candidates) {
  for (const relativePath of candidates) {
    try {
      const absolute = path.join(root, relativePath);
      const stat = lstatSync(absolute);
      if (
        stat.isFile()
        && !stat.isSymbolicLink()
        && realpathSync(absolute) === path.resolve(absolute)
      ) {
        return relativePath;
      }
    } catch {
      // Continue to the next supported filename.
    }
  }
  return null;
}

function realOrManifestSurface(root, directorySurfaces) {
  const paths = directorySurfaces
    .map(([relativePath, profilePath]) => (
      existingProfileSurface(root, relativePath, profilePath)
    ))
    .filter(Boolean);
  return paths.length > 0 ? paths : ["package.json"];
}

function profileCandidates(
  root,
  manifest,
  npmExecutable,
  workspaces,
  packageManager = "npm",
  useWorkspaceCwd = false,
  includeLegacyDatabaseProfile = false,
) {
  const scripts = new Set(detectedScripts(manifest));
  const candidates = [];
  if (
    includeLegacyDatabaseProfile
    && (
      existsSync(path.join(root, "prisma"))
      || [...scripts].some((script) => /^(db:|prisma)/.test(script))
    )
  ) {
    const commands = [...scripts]
      .filter((script) => /^(db:|prisma)/.test(script))
      .map((script) => npmExecutable
        ? command(
            `${packageManager}-${script.replaceAll(":", "-")}`,
            script,
            npmExecutable,
          )
        : null)
      .filter(Boolean);
    candidates.push({
      id: "database",
      paths: realOrManifestSurface(root, [["prisma", "prisma/**"]]),
      role: "primary",
      primary: false,
      requiresProfileIds: [],
      commands,
    });
  }
  if (
    existsSync(path.join(root, "package.json"))
    && [...scripts].some((script) => ["build", "lint", "test", "typecheck"].includes(script))
  ) {
    const commands = ["build", "lint", "test", "typecheck"]
      .filter((script) => scripts.has(script))
      .map((script) => npmExecutable
        ? command(`${packageManager}-${script}`, script, npmExecutable)
        : null)
      .filter(Boolean);
    candidates.push({
      id: "node-quality",
      paths: realOrManifestSurface(root, [
        ["src", "src/**"],
        ["tests", "tests/**"],
      ]),
      role: "primary",
      primary: false,
      requiresProfileIds: [],
      commands,
    });
  }
  if (
    existsSync(path.join(root, "playwright.config.ts"))
    || existsSync(path.join(root, "playwright.config.js"))
    || scripts.has("e2e")
  ) {
    const commands = scripts.has("e2e") && npmExecutable
      ? [command(`${packageManager}-e2e`, "e2e", npmExecutable)]
      : [];
    const configPath = existingProfileFile(root, [
      "playwright.config.ts",
      "playwright.config.js",
    ]);
    const paths = [
      configPath,
      existingProfileSurface(root, "tests/e2e", "tests/e2e/**"),
    ].filter(Boolean);
    candidates.push({
      id: "web-e2e",
      paths: paths.length > 0 ? paths : ["package.json"],
      role: "primary",
      primary: false,
      requiresProfileIds: [],
      commands,
    });
  }
  candidates.push(...workspaceProfiles(
    workspaces,
    npmExecutable,
    packageManager,
    useWorkspaceCwd,
  ));
  return candidates.sort((left, right) => left.id.localeCompare(right.id));
}

export function detectProfiles({ workspaceRoot } = {}) {
  const root = resolveBoundedWorkspaceRoot(workspaceRoot);
  const manifest = readWorkspaceJsonBounded(root, "package.json");
  const npmExecutable = resolveRegularExecutable("npm");
  const discovered = discoverWorkspaces(root, manifest);
  const candidates = profileCandidates(
    root,
    manifest,
    npmExecutable,
    discovered.workspaces,
    "npm",
    false,
    true,
  );
  const primaryCandidates = candidates.filter((profile) => profile.role === "primary");
  const warnings = primaryCandidates.length > 1
    ? [`ambiguous_primary_profile:${primaryCandidates.map((profile) => profile.id).join(",")}`]
    : [];
  warnings.push(...discovered.warnings);
  if (
    npmExecutable === null
    && (
      detectedScripts(manifest).some((script) =>
        /^(build|db:|e2e|lint|prisma|test|typecheck)/.test(script))
      || discovered.workspaces.some((workspace) => workspace.scripts.some((script) =>
        /^(build|e2e|lint|test|typecheck)$/.test(script)))
    )
  ) {
    warnings.push("npm_regular_executable_unavailable");
  }
  return {
    schemaVersion: "OwlCodaRunKitProfileDetectionV1",
    status: "profiles_detected",
    dryRun: true,
    writesPerformed: 0,
    candidates,
    primaryProfileId: primaryCandidates.length === 1 ? primaryCandidates[0].id : null,
    warnings,
    detectedScripts: detectedScripts(manifest),
    detectedWorkspaces: discovered.workspaces,
    authorizationGranted: false,
  };
}

function detectedInputManifest(root, workspaces, toolBinding) {
  const refs = new Set([
    "package.json",
    ...[
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ].filter(ref => existsSync(path.join(root, ref))),
    ...workspaces.map(workspace => `${workspace.path}/package.json`),
    ...toolBinding.inputFiles,
  ]);
  return [...refs]
    .sort()
    .map((ref) => {
      const absolute = boundedRegularFile(root, ref);
      return {
        path: ref,
        sha256: sha256(readFileSync(absolute)),
      };
    });
}

function bindCommandsToProjectTool(profiles, toolBinding) {
  return profiles.map(profile => ({
    ...profile,
    commands: profile.commands.map(entry => ({
      ...entry,
      executable: toolBinding.executable,
      argv: [...toolBinding.argvPrefix, ...entry.argv],
    })),
  }));
}

function proposedProfileDocument(candidates, inputManifest, detectedSurfacePaths = []) {
  const actionable = candidates.filter(profile => profile.commands.length > 0);
  const selectedPrimary = actionable.find(profile => profile.id === "node-quality")
    ?? actionable[0]
    ?? null;
  const rootSurfacePaths = inputManifest
    .map(entry => entry.path)
    .filter(ref => !ref.includes("/"));
  return {
    schemaVersion: "OwlCodaRunKitProfilesV1",
    profiles: candidates.map(profile => ({
      ...profile,
      paths: [...new Set([
        ...profile.paths,
        ...(profile.id === selectedPrimary?.id
          ? [...rootSurfacePaths, ...detectedSurfacePaths]
          : []),
      ])].sort(),
      primary: profile.id === selectedPrimary?.id,
    })),
  };
}

function visibleGitChangedPaths(root) {
  try {
    const gitRoot = realpathSync(execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
    ).trim());
    const workspacePrefix = path.relative(gitRoot, root).split(path.sep).join("/");
    if (workspacePrefix.startsWith("../") || workspacePrefix === "..") {
      return { paths: [], issueCodes: ["profile_git_root_unusable"] };
    }
    const normalizeGitPath = (filePath) => {
      const normalized = filePath.split(path.sep).join("/");
      if (!workspacePrefix) return normalized;
      const prefix = `${workspacePrefix}/`;
      return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
    };
    const raw = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
    );
    const fields = raw.split("\0");
    const paths = [];
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      if (!field) continue;
      const status = field.slice(0, 2);
      const currentPath = normalizeGitPath(field.slice(3));
      let priorPath = null;
      if (status.includes("R") || status.includes("C")) {
        const prior = fields[index + 1];
        if (!prior) return { paths: [], issueCodes: ["profile_git_status_unusable"] };
        priorPath = normalizeGitPath(prior);
        index += 1;
      }
      if (currentPath === null || (status.includes("R") && priorPath === null)) {
        return { paths: [], issueCodes: ["profile_git_path_outside_workspace"] };
      }
      const changedPaths = status.includes("R") ? [currentPath, priorPath] : [currentPath];
      for (const filePath of changedPaths) {
        if (!filePath
          || filePath === ".owlcoda/runkit"
          || filePath.startsWith(".owlcoda/runkit/")) continue;
        try {
          safeRelativePath(filePath, "profile changed path");
          paths.push(filePath);
        } catch {
          return { paths: [], issueCodes: ["profile_changed_path_unusable"] };
        }
      }
    }
    return { paths: [...new Set(paths)].sort(), issueCodes: [] };
  } catch {
    return { paths: [], issueCodes: ["profile_git_status_unavailable"] };
  }
}

function sourceCandidatePath(filePath) {
  const segments = filePath.split("/");
  const nonSourceSegments = new Set([
    ".cache",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".turbo",
    ".vite",
    ".vitest",
    "__pycache__",
    "node_modules",
  ]);
  if (segments.some(segment => nonSourceSegments.has(segment))) return false;
  if ([".github", ".owlcoda", "docs"].includes(segments[0])) return false;
  return !/\.(?:md|mdx|rst|txt)$/iu.test(filePath);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function profileCoveragePlan({ root, proposedProfiles, currentProfilesSha256 }) {
  const changed = visibleGitChangedPaths(root);
  const impact = resolveProfileImpactDetailed({
    changedPaths: changed.paths,
    profiles: proposedProfiles.profiles,
  });
  const uncoveredChangedPaths = [...impact.uncoveredPaths];
  const uncoveredSourcePaths = uncoveredChangedPaths.filter(sourceCandidatePath);
  const selectedPrimary = proposedProfiles.profiles.find(profile => profile.primary) ?? null;
  const primaryBlockers = [];
  if (selectedPrimary === null) primaryBlockers.push("actionable_primary_profile_missing");
  if (uncoveredSourcePaths.length > 0) {
    primaryBlockers.push(
      `candidate_paths_do_not_cover_changed_source:${uncoveredSourcePaths.join(",")}`,
    );
  }
  const minimalSuggestedProfile = selectedPrimary && uncoveredSourcePaths.length > 0
    ? {
        ...structuredClone(selectedPrimary),
        paths: [...new Set([
          ...selectedPrimary.paths,
          ...uncoveredSourcePaths,
        ])].sort(),
        primary: true,
      }
    : null;
  const repairedProfiles = minimalSuggestedProfile
    ? {
        ...structuredClone(proposedProfiles),
        profiles: proposedProfiles.profiles.map(profile => (
          profile.id === minimalSuggestedProfile.id
            ? structuredClone(minimalSuggestedProfile)
            : structuredClone(profile)
        )),
      }
    : proposedProfiles;
  const command = currentProfilesSha256 === null ? "detect" : "reconcile";
  const workspace = shellQuote(root);
  return {
    status: primaryBlockers.length > 0 ? "profiles_insufficient" : "profiles_detected",
    proposedProfiles: repairedProfiles,
    changedPaths: changed.paths,
    uncoveredChangedPaths,
    uncoveredSourcePaths,
    primaryBlockers: [...new Set(primaryBlockers)].sort(),
    minimalSuggestedProfile,
    repairCommands: {
      preview: `npx --no-install owlrunkit profiles ${command} --workspace ${workspace} --dry-run`,
      apply: minimalSuggestedProfile || primaryBlockers.length === 0
        ? `npx --no-install owlrunkit profiles ${command} --workspace ${workspace} --apply`
        : null,
    },
    issueCodes: changed.issueCodes,
  };
}

function profilesFileHash(root) {
  const ref = path.join(root, ".owlcoda", "runkit", "profiles.json");
  if (!existsSync(ref)) return null;
  return sha256(readFileSync(boundedRegularFile(
    root,
    path.join(".owlcoda", "runkit", "profiles.json"),
  )));
}

function exactRegularFileBytes(absolutePath, expectedBytes) {
  try {
    const stat = lstatSync(absolutePath);
    return !stat.isSymbolicLink()
      && stat.isFile()
      && realpathSync(absolutePath) === absolutePath
      && readFileSync(absolutePath, "utf8") === expectedBytes;
  } catch {
    return false;
  }
}

function readRegularFileInsideRoot(root, absolutePath) {
  const stat = lstatSync(absolutePath);
  const resolved = realpathSync(absolutePath);
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || resolved !== absolutePath
    || !insideRoot(root, resolved)
  ) {
    throw new Error("profile_transaction_file_untrusted");
  }
  return readFileSync(absolutePath, "utf8");
}

function trustedDirectoryInsideRoot(root, absolutePath) {
  const stat = lstatSync(absolutePath);
  const resolved = realpathSync(absolutePath);
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || resolved !== absolutePath
    || !insideRoot(root, resolved)
  ) {
    throw new Error("profile_transaction_directory_untrusted");
  }
  return resolved;
}

function commitCreateOnlyStagedFile(stagedPath, finalPath, expectedBytes) {
  if (!exactRegularFileBytes(stagedPath, expectedBytes)) {
    throw new Error("profile_apply_staged_file_invalid");
  }
  try {
    linkSync(stagedPath, finalPath);
  } catch (error) {
    if (
      error?.code !== "EEXIST"
      || !exactRegularFileBytes(finalPath, expectedBytes)
    ) {
      throw error;
    }
  }
  rmSync(stagedPath, { force: true });
}

function recoverProfileApplyTransaction({
  root,
  transactionRoot,
  profilesPath,
  profilesBytes,
  receiptAbsolutePath,
  receiptBytes,
  receipt,
}) {
  const transactionStat = lstatSync(transactionRoot);
  if (
    transactionStat.isSymbolicLink()
    || !transactionStat.isDirectory()
    || realpathSync(transactionRoot) !== transactionRoot
    || !insideRoot(root, transactionRoot)
  ) {
    throw new Error("profile_apply_transaction_directory_untrusted");
  }
  const entries = readdirSync(transactionRoot).sort();
  if (entries.some((entry) => !["profiles.json", "receipt.json"].includes(entry))) {
    throw new Error("profile_apply_transaction_contents_untrusted");
  }
  const stagedProfiles = path.join(transactionRoot, "profiles.json");
  const stagedReceipt = path.join(transactionRoot, "receipt.json");
  const currentProfilesSha256 = profilesFileHash(root);
  const receiptExists = existsSync(receiptAbsolutePath);
  if (
    currentProfilesSha256 === null
    && !exactRegularFileBytes(stagedProfiles, profilesBytes)
  ) {
    throw new Error("profile_apply_transaction_staged_profile_mismatch");
  }
  if (
    currentProfilesSha256 !== null
    && currentProfilesSha256 !== receipt.appliedProfilesSha256
  ) {
    throw new Error("profile_apply_transaction_profile_mismatch");
  }
  if (
    currentProfilesSha256 !== null
    && existsSync(stagedProfiles)
    && !exactRegularFileBytes(stagedProfiles, profilesBytes)
  ) {
    throw new Error("profile_apply_transaction_staged_profile_mismatch");
  }
  if (
    receiptExists
      ? !exactRegularFileBytes(receiptAbsolutePath, receiptBytes)
      : !exactRegularFileBytes(stagedReceipt, receiptBytes)
  ) {
    throw new Error("profile_apply_transaction_receipt_mismatch");
  }
  let profilesCommittedByRecovery = false;
  try {
    if (currentProfilesSha256 === null) {
      commitCreateOnlyStagedFile(stagedProfiles, profilesPath, profilesBytes);
      profilesCommittedByRecovery = true;
    } else {
      rmSync(stagedProfiles, { force: true });
    }
    if (receiptExists) {
      rmSync(stagedReceipt, { force: true });
    } else {
      commitCreateOnlyStagedFile(
        stagedReceipt,
        receiptAbsolutePath,
        receiptBytes,
      );
    }
  } catch (error) {
    if (
      profilesCommittedByRecovery
      && profilesFileHash(root) === receipt.appliedProfilesSha256
    ) {
      try {
        linkSync(profilesPath, stagedProfiles);
      } catch (linkError) {
        if (
          linkError?.code !== "EEXIST"
          || !exactRegularFileBytes(stagedProfiles, profilesBytes)
        ) {
          throw linkError;
        }
      }
      rmSync(profilesPath);
    }
    throw error;
  }
  rmSync(transactionRoot, { recursive: true });
  return receipt;
}

function detectProfilesVersion({
  workspaceRoot,
  projectToolResolver,
} = {}, { schemaVersion, includeCoverage }) {
  const root = resolveBoundedWorkspaceRoot(workspaceRoot);
  const manifest = readWorkspaceJsonBounded(root, "package.json");
  const discovered = discoverWorkspaces(root, manifest);
  const toolBinding = resolveProjectTool(root, manifest, projectToolResolver);
  const rawCandidates = profileCandidates(
    root,
    manifest,
    toolBinding.executable,
    discovered.workspaces,
    toolBinding.packageManager,
    true,
  );
  const detectedSurfacePaths = includeCoverage
    ? (() => {
        const candidateSurfacePaths = new Set(
          rawCandidates.flatMap(profile => profile.paths),
        );
        return profileCandidates(
          root,
          manifest,
          toolBinding.executable,
          discovered.workspaces,
          toolBinding.packageManager,
          true,
          true,
        ).flatMap(profile => profile.paths)
          .filter(profilePath => !candidateSurfacePaths.has(profilePath));
      })()
    : [];
  const candidates = bindCommandsToProjectTool(rawCandidates, toolBinding);
  let inputManifest = [];
  const issueCodes = [
    ...toolBinding.issueCodes,
    ...discovered.warnings,
  ];
  try {
    inputManifest = detectedInputManifest(root, discovered.workspaces, toolBinding);
  } catch (error) {
    issueCodes.push(error instanceof Error ? error.message : String(error));
  }
  const initialProfiles = proposedProfileDocument(
    candidates,
    inputManifest,
    detectedSurfacePaths,
  );
  const currentProfilesSha256 = profilesFileHash(root);
  const coverage = includeCoverage
    ? profileCoveragePlan({
        root,
        proposedProfiles: initialProfiles,
        currentProfilesSha256,
      })
    : {
        status: "profiles_detected",
        proposedProfiles: initialProfiles,
        changedPaths: [],
        uncoveredChangedPaths: [],
        uncoveredSourcePaths: [],
        primaryBlockers: [],
        minimalSuggestedProfile: null,
        repairCommands: null,
        issueCodes: [],
      };
  const proposedProfiles = coverage.proposedProfiles;
  issueCodes.push(...coverage.issueCodes);
  issueCodes.push(...validateProfileDocument(proposedProfiles));
  const qualityIssues = [...new Set(issueCodes)].sort();
  const confidence = qualityIssues.length === 0 && toolBinding.confidence === "high"
    ? "high"
    : "review_required";
  const applyStatus = currentProfilesSha256 !== null
    ? "profiles_already_exists"
    : confidence === "high"
      ? "ready_to_apply"
      : "review_required";
  const body = {
    schemaVersion,
    status: coverage.status,
    dryRun: true,
    writesPerformed: 0,
    confidence,
    applyStatus,
    issueCodes: qualityIssues,
    proposedProfiles,
    candidates,
    primaryProfileId: proposedProfiles.profiles.find(profile => profile.primary)?.id ?? null,
    inputManifest,
    toolBinding: {
      status: toolBinding.status,
      confidence: toolBinding.confidence,
      source: toolBinding.source,
      packageManager: toolBinding.packageManager,
      executable: toolBinding.executable,
      argvPrefix: [...toolBinding.argvPrefix],
      version: toolBinding.version,
      executableSha256: toolBinding.executableSha256,
      launcherSha256: toolBinding.launcherSha256,
    },
    currentProfilesSha256,
    detectedScripts: detectedScripts(manifest),
    detectedWorkspaces: discovered.workspaces,
    ...(includeCoverage
      ? {
          changedPaths: coverage.changedPaths,
          uncoveredChangedPaths: coverage.uncoveredChangedPaths,
          uncoveredSourcePaths: coverage.uncoveredSourcePaths,
          primaryBlockers: coverage.primaryBlockers,
          minimalSuggestedProfile: coverage.minimalSuggestedProfile,
          repairCommands: coverage.repairCommands,
        }
      : {}),
    authorizationGranted: false,
  };
  return {
    ...body,
    detectionSha256: sha256(canonicalJson(body)),
  };
}

export function detectProfilesV2(input = {}) {
  return detectProfilesVersion(input, {
    schemaVersion: "OwlCodaRunKitProfileDetectionV2",
    includeCoverage: false,
  });
}

export function detectProfilesV3(input = {}) {
  return detectProfilesVersion(input, {
    schemaVersion: "OwlCodaRunKitProfileDetectionV3",
    includeCoverage: true,
  });
}

function blockedApply(detection, issueCodes, currentProfilesSha256 = null) {
  return {
    schemaVersion: "OwlCodaRunKitProfilesApplyReceiptV1",
    status: "profiles_apply_blocked",
    writesPerformed: 0,
    detectionSha256: detection?.detectionSha256 ?? null,
    currentProfilesSha256,
    issueCodes: [...new Set(issueCodes)].sort(),
    authorizationGranted: false,
  };
}

function verifyDetectionInputs(
  root,
  detection,
  {
    allowedApplyStatuses = ["ready_to_apply"],
    schemaVersion = "OwlCodaRunKitProfileDetectionV2",
    checkChangedPaths = false,
  } = {},
) {
  const issues = [];
  const { detectionSha256, ...body } = detection;
  if (
    detection.schemaVersion !== schemaVersion
    || !(schemaVersion === "OwlCodaRunKitProfileDetectionV3"
      ? ["profiles_detected", "profiles_insufficient"].includes(detection.status)
      : detection.status === "profiles_detected")
    || !/^[a-f0-9]{64}$/.test(detectionSha256 ?? "")
    || sha256(canonicalJson(body)) !== detectionSha256
  ) {
    issues.push("profile_detection_invalid");
  }
  if (
    detection.confidence !== "high"
    || !allowedApplyStatuses.includes(detection.applyStatus)
  ) {
    issues.push("profile_detection_not_ready_to_apply");
  }
  issues.push(...validateProfileDocument(detection.proposedProfiles));
  const executable = regularExecutable(detection.toolBinding?.executable);
  const launcher = regularExecutable(detection.toolBinding?.argvPrefix?.[0]);
  if (
    !executable
    || !launcher
    || sha256(readFileSync(executable)) !== detection.toolBinding.executableSha256
    || sha256(readFileSync(launcher)) !== detection.toolBinding.launcherSha256
  ) {
    issues.push("profile_detection_tool_drift");
  }
  if (!Array.isArray(detection.inputManifest)) {
    issues.push("profile_detection_invalid");
  } else {
    for (const entry of detection.inputManifest) {
      try {
        const actual = sha256(readFileSync(boundedRegularFile(root, entry.path)));
        if (actual !== entry.sha256) issues.push(`profile_detection_input_drift:${entry.path}`);
      } catch {
        issues.push(`profile_detection_input_unavailable:${entry.path}`);
      }
    }
  }
  if (checkChangedPaths) {
    const currentChangedPaths = visibleGitChangedPaths(root);
    issues.push(...currentChangedPaths.issueCodes);
    if (!Array.isArray(detection.changedPaths)) {
      issues.push("profile_detection_invalid");
    } else if (canonicalJson(currentChangedPaths.paths) !== canonicalJson(detection.changedPaths)) {
      issues.push("profile_detection_changed_paths_drift");
    }
  }
  return [...new Set(issues)].sort();
}

function applyDetectedProfilesVersion({
  workspaceRoot,
  detection,
} = {}, { schemaVersion, checkChangedPaths }) {
  const root = resolveBoundedWorkspaceRoot(workspaceRoot);
  let currentProfilesSha256;
  try {
    currentProfilesSha256 = profilesFileHash(root);
  } catch {
    return blockedApply(detection, ["profile_apply_directory_untrusted"]);
  }
  const issues = verifyDetectionInputs(root, detection ?? {}, {
    schemaVersion,
    checkChangedPaths,
  });
  if (issues.length > 0) return blockedApply(detection, issues);

  const receiptPath = path.join(
    ".owlcoda",
    "runkit",
    "profile-apply-receipts",
    `${detection.detectionSha256}.json`,
  );
  let runtimeRoot;
  let receiptRoot;
  try {
    runtimeRoot = ensureDirectoryChain(root, ".owlcoda/runkit");
    receiptRoot = ensureDirectoryChain(
      root,
      ".owlcoda/runkit/profile-apply-receipts",
    );
  } catch {
    return blockedApply(detection, ["profile_apply_directory_untrusted"]);
  }
  const profilesPath = path.join(runtimeRoot, "profiles.json");
  const receiptAbsolutePath = path.join(
    receiptRoot,
    `${detection.detectionSha256}.json`,
  );
  const profilesBytes = `${JSON.stringify(detection.proposedProfiles, null, 2)}\n`;
  const receipt = {
    schemaVersion: "OwlCodaRunKitProfilesApplyReceiptV1",
    status: "profiles_applied",
    writesPerformed: 2,
    detectionSha256: detection.detectionSha256,
    beforeProfilesSha256: null,
    appliedProfilesSha256: sha256(profilesBytes),
    receiptPath,
    issueCodes: [],
    authorizationGranted: false,
  };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  const transactionRoot = path.join(
    runtimeRoot,
    `.profile-apply-${detection.detectionSha256}.lock`,
  );
  if (existsSync(transactionRoot)) {
    try {
      return recoverProfileApplyTransaction({
        root,
        transactionRoot,
        profilesPath,
        profilesBytes,
        receiptAbsolutePath,
        receiptBytes,
        receipt,
      });
    } catch {
      return blockedApply(
        detection,
        ["profile_apply_transaction_recovery_invalid"],
        currentProfilesSha256,
      );
    }
  }
  if (currentProfilesSha256 !== null) {
    return blockedApply(detection, ["profiles_already_exists"], currentProfilesSha256);
  }
  try {
    mkdirSync(transactionRoot);
  } catch (error) {
    if (error?.code === "EEXIST") {
      return blockedApply(detection, ["profile_apply_transaction_active"]);
    }
    throw error;
  }
  let profilesCommitted = false;
  try {
    const current = profilesFileHash(root);
    if (current !== null) {
      return blockedApply(detection, ["profiles_already_exists"], current);
    }
    if (existsSync(receiptAbsolutePath)) {
      return blockedApply(detection, ["profile_apply_receipt_already_exists"]);
    }
    const stagedProfiles = path.join(transactionRoot, "profiles.json");
    const stagedReceipt = path.join(transactionRoot, "receipt.json");
    writeFileSync(stagedProfiles, profilesBytes, { flag: "wx" });
    writeFileSync(stagedReceipt, receiptBytes, { flag: "wx" });
    commitCreateOnlyStagedFile(stagedProfiles, profilesPath, profilesBytes);
    profilesCommitted = true;
    commitCreateOnlyStagedFile(
      stagedReceipt,
      receiptAbsolutePath,
      receiptBytes,
    );
    return receipt;
  } catch {
    if (
      profilesCommitted
      && existsSync(profilesPath)
      && profilesFileHash(root) === receipt.appliedProfilesSha256
    ) {
      rmSync(profilesPath);
    }
    return blockedApply(detection, ["profile_apply_transaction_failed"]);
  } finally {
    rmSync(transactionRoot, { recursive: true, force: true });
  }
}

export function applyDetectedProfilesV2(input = {}) {
  return applyDetectedProfilesVersion(input, {
    schemaVersion: "OwlCodaRunKitProfileDetectionV2",
    checkChangedPaths: false,
  });
}

export function applyDetectedProfilesV3(input = {}) {
  return applyDetectedProfilesVersion(input, {
    schemaVersion: "OwlCodaRunKitProfileDetectionV3",
    checkChangedPaths: true,
  });
}

function mergeDetectedProfileDefinition(current, detected) {
  current.commands ??= [];
  const addedPaths = detected.paths
    .filter((value) => !current.paths.includes(value))
    .sort();
  current.paths = [...new Set([...current.paths, ...detected.paths])].sort();
  const commands = new Map(current.commands.map((entry) => [entry.id, entry]));
  const addedCommandIds = [];
  const updatedCommandIds = [];
  for (const detectedCommand of detected.commands) {
    const currentCommand = commands.get(detectedCommand.id);
    if (!currentCommand) {
      current.commands.push(structuredClone(detectedCommand));
      commands.set(detectedCommand.id, detectedCommand);
      addedCommandIds.push(detectedCommand.id);
    } else if (canonicalJson(currentCommand) !== canonicalJson(detectedCommand)) {
      const index = current.commands.findIndex((entry) => entry.id === detectedCommand.id);
      current.commands[index] = structuredClone(detectedCommand);
      commands.set(detectedCommand.id, detectedCommand);
      updatedCommandIds.push(detectedCommand.id);
    }
  }
  current.commands.sort((left, right) => left.id.localeCompare(right.id));
  if (
    addedPaths.length === 0
    && addedCommandIds.length === 0
    && updatedCommandIds.length === 0
  ) return null;
  return {
    profileId: current.id,
    addedPaths,
    addedCommandIds: addedCommandIds.sort(),
    updatedCommandIds: updatedCommandIds.sort(),
  };
}

function mergeDetectedProfiles(currentProfiles, detectedProfiles) {
  const profiles = currentProfiles.profiles.map((profile) => structuredClone(profile));
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const commandOwners = new Map(profiles.flatMap((profile) =>
    (profile.commands ?? []).map((entry) => [entry.id, profile.id])));
  const addedProfileIds = [];
  const updatedProfiles = [];
  for (const detected of [...detectedProfiles.profiles]
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const current = byId.get(detected.id);
    if (!current) {
      const impact = resolveProfileImpactDetailed({
        changedPaths: detected.paths.map(representativePath),
        profiles,
      });
      const primaryCoverageComplete = impact.uncoveredPaths.length === 0
        && !impact.warnings.some((warning) => warning.startsWith("supporting_only_match:"));
      if (primaryCoverageComplete) continue;
      const existingCommandOwnerIds = [...new Set(detected.commands
        .map((command) => commandOwners.get(command.id))
        .filter(Boolean))];
      if (existingCommandOwnerIds.length === 1) {
        const owner = byId.get(existingCommandOwnerIds[0]);
        const update = mergeDetectedProfileDefinition(owner, detected);
        if (update !== null) updatedProfiles.push(update);
        for (const command of owner.commands) commandOwners.set(command.id, owner.id);
        continue;
      }
      const added = { ...structuredClone(detected), primary: false };
      profiles.push(added);
      byId.set(added.id, added);
      for (const command of added.commands) commandOwners.set(command.id, added.id);
      addedProfileIds.push(added.id);
      continue;
    }
    const update = mergeDetectedProfileDefinition(current, detected);
    if (update !== null) updatedProfiles.push(update);
    for (const command of current.commands) commandOwners.set(command.id, current.id);
  }
  return {
    proposedProfiles: {
      schemaVersion: "OwlCodaRunKitProfilesV1",
      profiles,
    },
    addedProfileIds,
    updatedProfiles,
  };
}

function blockedReconcile(
  detection,
  issueCodes,
  currentProfilesSha256 = null,
  dryRun = true,
) {
  return {
    schemaVersion: "OwlCodaRunKitProfilesReconcilePlanV1",
    status: "profiles_reconcile_blocked",
    valid: false,
    exitCode: 2,
    dryRun,
    writesPerformed: 0,
    detectionSha256: detection?.detectionSha256 ?? null,
    currentProfilesSha256,
    issueCodes: [...new Set(issueCodes)].sort(),
    authorizationGranted: false,
  };
}

function validateReconcileReceipt(receipt, reconcileSha256) {
  const hash = /^[a-f0-9]{64}$/;
  const receiptKeys = [
    "schemaVersion",
    "status",
    "exitCode",
    "writesPerformed",
    "dryRun",
    "reconcileSha256",
    "detectionSha256",
    "beforeProfilesSha256",
    "appliedProfilesSha256",
    "addedProfileIds",
    "updatedProfiles",
    "receiptPath",
    "issueCodes",
    "authorizationGranted",
  ];
  const receiptPath = path.join(
    ".owlcoda",
    "runkit",
    "profile-reconcile-receipts",
    `${reconcileSha256}.json`,
  );
  if (
    !exactKeys(receipt, receiptKeys)
    || receiptKeys.some((key) => !Object.hasOwn(receipt, key))
    || receipt.schemaVersion !== "OwlCodaRunKitProfilesReconcileReceiptV1"
    || receipt.status !== "profiles_reconciled"
    || receipt.exitCode !== 0
    || receipt.writesPerformed !== 2
    || receipt.dryRun !== false
    || receipt.reconcileSha256 !== reconcileSha256
    || !hash.test(receipt.detectionSha256 ?? "")
    || !hash.test(receipt.beforeProfilesSha256 ?? "")
    || !hash.test(receipt.appliedProfilesSha256 ?? "")
    || !Array.isArray(receipt.addedProfileIds)
    || receipt.addedProfileIds.some((value) => !safeIdentifier(value))
    || !Array.isArray(receipt.updatedProfiles)
    || receipt.updatedProfiles.some((update) => (
      !exactKeys(update, [
        "profileId",
        "addedPaths",
        "addedCommandIds",
        "updatedCommandIds",
      ])
      || !safeIdentifier(update.profileId)
      || !Array.isArray(update.addedPaths)
      || update.addedPaths.some((value) => typeof value !== "string")
      || !Array.isArray(update.addedCommandIds)
      || update.addedCommandIds.some((value) => !safeIdentifier(value))
      || !Array.isArray(update.updatedCommandIds)
      || update.updatedCommandIds.some((value) => !safeIdentifier(value))
    ))
    || receipt.receiptPath !== receiptPath
    || !Array.isArray(receipt.issueCodes)
    || receipt.issueCodes.length !== 0
    || receipt.authorizationGranted !== false
  ) {
    throw new Error("profile_reconcile_transaction_receipt_invalid");
  }
  return receiptPath;
}

function isInitializationProfileScaffold(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.schemaVersion === "OwlCodaRunKitProfilesV1"
    && Array.isArray(value.profiles)
    && value.profiles.length === 0
    && Object.keys(value).sort().join(",") === "profiles,schemaVersion";
}

function recoverProfileReconcileTransaction(root) {
  const runtimeRoot = path.join(root, ".owlcoda", "runkit");
  if (!existsSync(runtimeRoot)) return null;
  trustedDirectoryInsideRoot(root, runtimeRoot);
  const transactionNames = readdirSync(runtimeRoot)
    .filter((entry) => entry.startsWith(".profile-reconcile-") && entry.endsWith(".lock"));
  if (transactionNames.length === 0) return null;
  if (
    transactionNames.length !== 1
    || !/^\.profile-reconcile-[a-f0-9]{64}\.lock$/u.test(transactionNames[0])
  ) {
    throw new Error("profile_reconcile_transaction_set_invalid");
  }
  const transactionName = transactionNames[0];
  const reconcileSha256 = transactionName.slice(
    ".profile-reconcile-".length,
    -".lock".length,
  );
  const transactionRoot = path.join(runtimeRoot, transactionName);
  trustedDirectoryInsideRoot(root, transactionRoot);
  const entries = readdirSync(transactionRoot).sort();
  if (
    entries.some((entry) => ![
      "previous-profiles.json",
      "profiles.json",
      "receipt.json",
    ].includes(entry))
  ) {
    throw new Error("profile_reconcile_transaction_contents_untrusted");
  }
  const previousProfiles = path.join(transactionRoot, "previous-profiles.json");
  const stagedProfiles = path.join(transactionRoot, "profiles.json");
  const stagedReceipt = path.join(transactionRoot, "receipt.json");
  const receiptRoot = ensureDirectoryChain(
    root,
    ".owlcoda/runkit/profile-reconcile-receipts",
  );
  const receiptAbsolutePath = path.join(receiptRoot, `${reconcileSha256}.json`);
  const receiptSource = existsSync(stagedReceipt) ? stagedReceipt : receiptAbsolutePath;
  const receipt = JSON.parse(readRegularFileInsideRoot(root, receiptSource));
  const receiptPath = validateReconcileReceipt(receipt, reconcileSha256);
  if (path.join(root, receiptPath) !== receiptAbsolutePath) {
    throw new Error("profile_reconcile_transaction_receipt_path_invalid");
  }
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (!exactRegularFileBytes(receiptSource, receiptBytes)) {
    throw new Error("profile_reconcile_transaction_receipt_mismatch");
  }
  const previousBytes = readRegularFileInsideRoot(root, previousProfiles);
  if (sha256(previousBytes) !== receipt.beforeProfilesSha256) {
    throw new Error("profile_reconcile_transaction_preimage_mismatch");
  }
  const profilesPath = path.join(runtimeRoot, "profiles.json");
  const currentProfilesSha256 = profilesFileHash(root);
  if (
    currentProfilesSha256 !== receipt.beforeProfilesSha256
    && currentProfilesSha256 !== receipt.appliedProfilesSha256
  ) {
    throw new Error("profile_reconcile_transaction_profile_mismatch");
  }
  if (existsSync(stagedProfiles)) {
    const stagedProfilesBytes = readRegularFileInsideRoot(root, stagedProfiles);
    if (sha256(stagedProfilesBytes) !== receipt.appliedProfilesSha256) {
      throw new Error("profile_reconcile_transaction_staged_profile_mismatch");
    }
  } else if (currentProfilesSha256 !== receipt.appliedProfilesSha256) {
    throw new Error("profile_reconcile_transaction_staged_profile_missing");
  }
  if (
    existsSync(receiptAbsolutePath)
    && !exactRegularFileBytes(receiptAbsolutePath, receiptBytes)
  ) {
    throw new Error("profile_reconcile_transaction_committed_receipt_mismatch");
  }

  let profilesCommittedByRecovery = false;
  try {
    if (currentProfilesSha256 === receipt.beforeProfilesSha256) {
      renameSync(stagedProfiles, profilesPath);
      profilesCommittedByRecovery = true;
    }
    if (!existsSync(receiptAbsolutePath)) {
      commitCreateOnlyStagedFile(stagedReceipt, receiptAbsolutePath, receiptBytes);
    }
  } catch (error) {
    if (
      profilesCommittedByRecovery
      && profilesFileHash(root) === receipt.appliedProfilesSha256
    ) {
      renameSync(previousProfiles, profilesPath);
    }
    throw error;
  }
  rmSync(transactionRoot, { recursive: true });
  return receipt;
}

export function reconcileProfilesV2({
  workspaceRoot,
  apply = false,
  projectToolResolver,
  onAfterProfilesCommit,
} = {}) {
  const root = resolveBoundedWorkspaceRoot(workspaceRoot);
  if (apply) {
    try {
      const recovered = recoverProfileReconcileTransaction(root);
      if (recovered !== null) return recovered;
    } catch {
      return blockedReconcile(
        null,
        ["profile_reconcile_transaction_recovery_invalid"],
        null,
        false,
      );
    }
  }
  let currentProfilesSha256;
  let currentProfiles;
  let currentProfilesBytes;
  let replacesInitializationScaffold = false;
  try {
    currentProfilesSha256 = profilesFileHash(root);
    if (currentProfilesSha256 === null) {
      return blockedReconcile(null, ["profiles_missing"], null, !apply);
    }
    currentProfilesBytes = readFileSync(boundedRegularFile(
      root,
      path.join(".owlcoda", "runkit", "profiles.json"),
    ), "utf8");
    currentProfiles = readWorkspaceJsonBounded(
      root,
      path.join(".owlcoda", "runkit", "profiles.json"),
    );
    replacesInitializationScaffold = isInitializationProfileScaffold(currentProfiles);
    const documentIssues = validateProfileDocument(currentProfiles);
    if (documentIssues.length > 0 && !replacesInitializationScaffold) {
      return blockedReconcile(null, documentIssues, currentProfilesSha256, !apply);
    }
  } catch {
    return blockedReconcile(
      null,
      ["profile_reconcile_current_profiles_invalid"],
      null,
      !apply,
    );
  }

  const detection = detectProfilesV3({ workspaceRoot: root, projectToolResolver });
  const detectionIssues = verifyDetectionInputs(root, detection, {
    allowedApplyStatuses: ["profiles_already_exists"],
    schemaVersion: "OwlCodaRunKitProfileDetectionV3",
    checkChangedPaths: true,
  });
  if (detection.currentProfilesSha256 !== currentProfilesSha256) {
    detectionIssues.push("profile_reconcile_detection_preimage_mismatch");
  }
  if (detectionIssues.length > 0) {
    return blockedReconcile(detection, detectionIssues, currentProfilesSha256, !apply);
  }

  const merged = replacesInitializationScaffold
    ? {
        proposedProfiles: structuredClone(detection.proposedProfiles),
        addedProfileIds: detection.proposedProfiles.profiles
          .map(profile => profile.id)
          .sort(),
        updatedProfiles: [],
      }
    : mergeDetectedProfiles(currentProfiles, detection.proposedProfiles);
  const proposedIssues = validateProfileDocumentWithDetectedSurfaces(
    root,
    merged.proposedProfiles,
  );
  if (proposedIssues.length > 0) {
    return blockedReconcile(detection, proposedIssues, currentProfilesSha256, !apply);
  }
  const proposedProfilesBytes = `${JSON.stringify(merged.proposedProfiles, null, 2)}\n`;
  const proposedProfilesSha256 = sha256(proposedProfilesBytes);
  const normalizationOnly = proposedProfilesSha256 !== currentProfilesSha256
    && merged.addedProfileIds.length === 0
    && merged.updatedProfiles.length === 0;
  const planBody = {
    detectionSha256: detection.detectionSha256,
    currentProfilesSha256,
    proposedProfilesSha256,
    normalizationOnly,
    addedProfileIds: merged.addedProfileIds,
    updatedProfiles: merged.updatedProfiles,
  };
  const reconcileSha256 = sha256(canonicalJson(planBody));
  const plan = {
    schemaVersion: "OwlCodaRunKitProfilesReconcilePlanV1",
    status: proposedProfilesSha256 === currentProfilesSha256
      ? "profiles_already_current"
      : "profiles_reconcile_ready",
    valid: true,
    exitCode: 0,
    dryRun: !apply,
    writesPerformed: 0,
    reconcileSha256,
    ...planBody,
    proposedProfiles: merged.proposedProfiles,
    issueCodes: [],
    authorizationGranted: false,
  };
  if (!apply || proposedProfilesSha256 === currentProfilesSha256) return plan;
  if (normalizationOnly) {
    return {
      ...plan,
      status: "profiles_already_current",
    };
  }

  let runtimeRoot;
  let receiptRoot;
  try {
    runtimeRoot = ensureDirectoryChain(root, ".owlcoda/runkit");
    receiptRoot = ensureDirectoryChain(
      root,
      ".owlcoda/runkit/profile-reconcile-receipts",
    );
  } catch {
    return blockedReconcile(
      detection,
      ["profile_reconcile_directory_untrusted"],
      currentProfilesSha256,
      false,
    );
  }
  const profilesPath = path.join(runtimeRoot, "profiles.json");
  const receiptPath = path.join(
    ".owlcoda",
    "runkit",
    "profile-reconcile-receipts",
    `${reconcileSha256}.json`,
  );
  const receiptAbsolutePath = path.join(receiptRoot, `${reconcileSha256}.json`);
  const receipt = {
    schemaVersion: "OwlCodaRunKitProfilesReconcileReceiptV1",
    status: "profiles_reconciled",
    exitCode: 0,
    writesPerformed: 2,
    dryRun: false,
    reconcileSha256,
    detectionSha256: detection.detectionSha256,
    beforeProfilesSha256: currentProfilesSha256,
    appliedProfilesSha256: proposedProfilesSha256,
    addedProfileIds: merged.addedProfileIds,
    updatedProfiles: merged.updatedProfiles,
    receiptPath,
    issueCodes: [],
    authorizationGranted: false,
  };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  const transactionRoot = path.join(
    runtimeRoot,
    `.profile-reconcile-${reconcileSha256}.lock`,
  );
  try {
    mkdirSync(transactionRoot);
  } catch (error) {
    return blockedReconcile(
      detection,
      [error?.code === "EEXIST"
        ? "profile_reconcile_transaction_active"
        : "profile_reconcile_transaction_failed"],
      currentProfilesSha256,
      false,
    );
  }
  let profilesCommitted = false;
  let preserveTransaction = false;
  try {
    if (profilesFileHash(root) !== currentProfilesSha256) {
      throw new Error("profile_reconcile_preimage_changed");
    }
    if (existsSync(receiptAbsolutePath)) {
      throw new Error("profile_reconcile_receipt_already_exists");
    }
    const previousProfiles = path.join(transactionRoot, "previous-profiles.json");
    const stagedProfiles = path.join(transactionRoot, "profiles.json");
    const stagedReceipt = path.join(transactionRoot, "receipt.json");
    writeFileSync(previousProfiles, currentProfilesBytes, { flag: "wx" });
    writeFileSync(stagedProfiles, proposedProfilesBytes, { flag: "wx" });
    writeFileSync(stagedReceipt, receiptBytes, { flag: "wx" });
    if (!exactRegularFileBytes(stagedProfiles, proposedProfilesBytes)) {
      throw new Error("profile_reconcile_staged_profiles_invalid");
    }
    renameSync(stagedProfiles, profilesPath);
    profilesCommitted = true;
    onAfterProfilesCommit?.();
    commitCreateOnlyStagedFile(stagedReceipt, receiptAbsolutePath, receiptBytes);
    return receipt;
  } catch {
    let issueCode = "profile_reconcile_transaction_failed";
    if (
      profilesCommitted
      && profilesFileHash(root) === proposedProfilesSha256
    ) {
      const previousProfiles = path.join(transactionRoot, "previous-profiles.json");
      try {
        if (!exactRegularFileBytes(previousProfiles, currentProfilesBytes)) {
          throw new Error("profile_reconcile_previous_profiles_invalid");
        }
        renameSync(previousProfiles, profilesPath);
      } catch {
        preserveTransaction = true;
        issueCode = "profile_reconcile_transaction_rollback_failed";
      }
    } else if (profilesCommitted) {
      preserveTransaction = true;
      issueCode = "profile_reconcile_transaction_rollback_failed";
    }
    return blockedReconcile(
      detection,
      [issueCode],
      currentProfilesSha256,
      false,
    );
  } finally {
    if (!preserveTransaction) {
      rmSync(transactionRoot, { recursive: true, force: true });
    }
  }
}

function exactKeys(value, allowed) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.includes(key));
}

function representativePath(rule) {
  return rule.endsWith("/**")
    ? `${rule.slice(0, -3)}/__owlrunkit_profile_surface__`
    : rule;
}

function validateProfileDocument(config) {
  const issues = [];
  if (
    !exactKeys(config, ["schemaVersion", "profiles"])
    || config.schemaVersion !== "OwlCodaRunKitProfilesV1"
    || !Array.isArray(config.profiles)
    || config.profiles.length === 0
  ) {
    return ["profiles_document_invalid"];
  }

  const ids = new Set();
  const commandIds = new Set();
  for (const profile of config.profiles) {
    if (!exactKeys(profile, [
      "commands",
      "id",
      "paths",
      "primary",
      "requiresProfileIds",
      "role",
    ])) {
      issues.push("profile_shape_invalid");
      continue;
    }
    if (typeof profile.id !== "string" || profile.id.length === 0) {
      issues.push("profile_id_invalid");
    } else if (ids.has(profile.id)) {
      issues.push(`duplicate_profile_id:${profile.id}`);
    } else {
      ids.add(profile.id);
    }
    if (!Array.isArray(profile.paths) || profile.paths.length === 0) {
      issues.push(`profile_paths_missing:${profile.id ?? "unknown"}`);
    }
    if (profile.role !== undefined && !["primary", "supporting"].includes(profile.role)) {
      issues.push(`profile_role_invalid:${profile.id ?? "unknown"}`);
    }
    if (profile.primary !== undefined && typeof profile.primary !== "boolean") {
      issues.push(`profile_primary_invalid:${profile.id ?? "unknown"}`);
    }
    if (
      profile.requiresProfileIds !== undefined
      && (
        !Array.isArray(profile.requiresProfileIds)
        || profile.requiresProfileIds.some((id) => typeof id !== "string" || id.length === 0)
        || new Set(profile.requiresProfileIds).size !== profile.requiresProfileIds.length
      )
    ) {
      issues.push(`profile_requirements_invalid:${profile.id ?? "unknown"}`);
    }
    if (profile.commands !== undefined) {
      if (!Array.isArray(profile.commands)) {
        issues.push(`profile_commands_invalid:${profile.id ?? "unknown"}`);
      } else {
        for (const entry of profile.commands) {
          if (
            !exactKeys(entry, ["argv", "cwd", "executable", "id"])
            || typeof entry.id !== "string"
            || entry.id.length === 0
            || typeof entry.cwd !== "string"
            || entry.cwd.length === 0
            || typeof entry.executable !== "string"
            || entry.executable.length === 0
            || !Array.isArray(entry.argv)
            || entry.argv.some((argument) => typeof argument !== "string" || argument.length === 0)
          ) {
            issues.push(`profile_command_invalid:${profile.id ?? "unknown"}`);
            break;
          }
          try {
            safeIdentifier(entry.id, "profile command id");
          } catch {
            issues.push(`profile_command_id_invalid:${profile.id}:${entry.id}`);
          }
          try {
            safeRelativePath(entry.cwd, "profile command cwd", { allowDot: true });
          } catch {
            issues.push(`profile_command_cwd_invalid:${profile.id}:${entry.id}`);
          }
          if (commandIds.has(entry.id)) {
            issues.push(`duplicate_profile_command_id:${entry.id}`);
          } else {
            commandIds.add(entry.id);
          }
        }
      }
    }
  }
  if (issues.length > 0) return [...new Set(issues)].sort();

  try {
    const changedPaths = config.profiles.flatMap((profile) =>
      profile.paths.map(representativePath));
    resolveProfileImpactDetailed({ changedPaths, profiles: config.profiles });
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  for (const profile of config.profiles) {
    for (const requiredId of profile.requiresProfileIds ?? []) {
      if (!ids.has(requiredId)) {
        issues.push(`required_profile_missing:${profile.id}:${requiredId}`);
      }
    }
  }
  const actionable = config.profiles.filter((profile) =>
    (profile.role ?? "primary") === "primary"
    && Array.isArray(profile.commands)
    && profile.commands.length > 0);
  if (actionable.length === 0) issues.push("actionable_primary_profile_missing");
  const explicitPrimaryIds = actionable
    .filter((profile) => profile.primary === true)
    .map((profile) => profile.id)
    .sort();
  if (explicitPrimaryIds.length > 1) {
    issues.push(`ambiguous_primary_profile:${explicitPrimaryIds.join(",")}`);
  } else if (explicitPrimaryIds.length === 0 && actionable.length > 1) {
    issues.push(`ambiguous_primary_profile:${actionable.map((profile) => profile.id).sort().join(",")}`);
  }
  return [...new Set(issues)].sort();
}

function profileLauncherIssues(config) {
  const issues = [];
  for (const profile of config.profiles ?? []) {
    for (const command of profile.commands ?? []) {
      if (typeof command.executable !== "string" || !path.isAbsolute(command.executable)) {
        continue;
      }
      const identity = `${profile.id ?? "unknown"}:${command.id ?? "unknown"}`;
      try {
        const stat = lstatSync(command.executable);
        if (stat.isSymbolicLink()) {
          issues.push(`profile_launcher_symlink_rejected:${identity}`);
        } else if (
          !stat.isFile()
          || realpathSync(command.executable) !== path.resolve(command.executable)
        ) {
          issues.push(`profile_launcher_not_regular_file:${identity}`);
        }
      } catch {
        issues.push(`profile_launcher_unavailable:${identity}`);
      }
    }
  }
  return issues;
}

function validateProfileDocumentWithDetectedSurfaces(root, config) {
  const issues = validateProfileDocument(config);
  if (issues.length > 0) return issues;
  issues.push(...profileLauncherIssues(config));
  const detected = detectProfiles({ workspaceRoot: root });
  const detectedPaths = detected.candidates.flatMap((profile) =>
    profile.paths.map(representativePath));
  if (detectedPaths.length > 0) {
    const impact = resolveProfileImpactDetailed({
      changedPaths: detectedPaths,
      profiles: config.profiles,
    });
    issues.push(...impact.uncoveredPaths.map((value) =>
      `uncovered_detected_surface:${value}`));
    issues.push(...impact.warnings
      .filter((warning) => warning.startsWith("supporting_only_match:"))
      .map((warning) => `detected_surface_${warning}`));
  }
  return [...new Set(issues)].sort();
}

export function validateProfiles({ workspaceRoot } = {}) {
  const root = resolveBoundedWorkspaceRoot(workspaceRoot);
  const issues = [];
  let profileIds = [];
  try {
    const config = readWorkspaceJsonBounded(
      root,
      path.join(".owlcoda", "runkit", "profiles.json"),
    );
    profileIds = Array.isArray(config.profiles)
      ? config.profiles
        .map((profile) => profile?.id)
        .filter((id) => typeof id === "string")
        .sort()
      : [];
    issues.push(...validateProfileDocumentWithDetectedSurfaces(root, config));
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  const valid = issues.length === 0;
  return {
    schemaVersion: "OwlCodaRunKitProfilesValidationV1",
    status: valid ? "valid" : "invalid",
    valid,
    exitCode: valid ? 0 : 2,
    profileIds,
    issues: [...new Set(issues)].sort(),
    authorizationGranted: false,
  };
}

export function resolveProfilesImpact({ workspaceRoot, changedPaths } = {}) {
  const root = resolveBoundedWorkspaceRoot(workspaceRoot);
  const config = readWorkspaceJsonBounded(
    root,
    path.join(".owlcoda", "runkit", "profiles.json"),
  );
  const documentIssues = validateProfileDocument(config);
  if (documentIssues.length > 0) {
    return {
      schemaVersion: "OwlCodaRunKitProfileImpactV1",
      status: "profile_impact_blocked",
      valid: false,
      exitCode: 2,
      changedPaths: [...new Set(changedPaths)].sort(),
      decision: "invalid_profiles",
      primaryProfileId: null,
      directProfileIds: [],
      transitiveProfileIds: [],
      supportingProfileIds: [],
      selectedProfileIds: [],
      uncoveredPaths: [],
      warnings: [],
      issues: documentIssues,
      authorizationGranted: false,
    };
  }
  const impact = resolveProfileImpactDetailed({
    changedPaths,
    profiles: config.profiles,
  });
  const issues = [
    ...impact.uncoveredPaths.map((value) => `uncovered_changed_path:${value}`),
    ...impact.warnings.filter((warning) =>
      warning.startsWith("supporting_only_match:")
      || warning.startsWith("ambiguous_primary_profile:")),
  ];
  const valid = impact.decision === "targeted_profiles" && issues.length === 0;
  return {
    schemaVersion: "OwlCodaRunKitProfileImpactV1",
    status: valid ? "profile_impact_resolved" : "profile_impact_blocked",
    valid,
    exitCode: valid ? 0 : 2,
    changedPaths: [...new Set(changedPaths)].sort(),
    ...impact,
    issues: [...new Set(issues)].sort(),
    authorizationGranted: false,
  };
}
