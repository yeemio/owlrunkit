import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { inspectRuntimeIsolationV1 } from "./onboarding-doctor.mjs";
import {
  resolveVerificationEnvelopeBackendV1,
  validateVerificationEnvelopeV1,
} from "./verification-envelope.mjs";

const PREFLIGHT_SCHEMA = "OwlCodaRunKitFormalEnvelopePreflightV1";
const NATIVE_TOOLCHAIN_TOOLS = new Set(["esbuild", "vite", "vitest"]);
const KNOWN_SCRIPT_TOOLS = [
  "biome",
  "eslint",
  "esbuild",
  "jest",
  "markdownlint",
  "markdownlint-cli2",
  "prettier",
  "stylelint",
  "vite",
  "vitest",
];

function executableName(value) {
  return path.basename(value).toLowerCase().replace(/\.(?:cmd|exe)$/u, "");
}

function effectiveInvocation(phase) {
  const direct = executableName(phase.executable);
  if (
    direct === "node"
    && typeof phase.argv[0] === "string"
    && /^(?:npm-cli|pnpm|yarn)(?:\.[cm]?js)?$/u.test(
      path.basename(phase.argv[0]).toLowerCase(),
    )
  ) {
    const launcher = path.basename(phase.argv[0]).toLowerCase();
    return {
      tool: launcher.startsWith("npm")
        ? "npm"
        : launcher.startsWith("pnpm")
          ? "pnpm"
          : "yarn",
      argv: phase.argv.slice(1),
    };
  }
  return { tool: direct, argv: [...phase.argv] };
}

function packageScriptName(invocation) {
  if (!new Set(["npm", "pnpm", "yarn"]).has(invocation.tool)) return null;
  const actionIndex = invocation.argv.findIndex(value => value === "run" || value === "run-script");
  return actionIndex >= 0 && typeof invocation.argv[actionIndex + 1] === "string"
    ? invocation.argv[actionIndex + 1]
    : null;
}

function readPackageScript(root, cwd, scriptName) {
  if (scriptName === null) return null;
  const manifestPath = path.join(root, cwd, "package.json");
  if (!existsSync(manifestPath)) return null;
  const stat = lstatSync(manifestPath);
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || stat.size > 1_048_576
    || realpathSync(manifestPath) !== path.resolve(manifestPath)
  ) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return typeof manifest.scripts?.[scriptName] === "string"
    ? manifest.scripts[scriptName]
    : null;
}

function patternRoot(pattern) {
  return pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function temporaryDirectoryBinding({ root, envelope, needed }) {
  const declared = Object.hasOwn(envelope.environment.values, "TMPDIR")
    ? envelope.environment.values.TMPDIR
    : null;
  const resolved = declared === null
    ? null
    : path.resolve(root, envelope.cwd, declared);
  const writableRoots = envelope.paths.disposableScratch
    .filter(pattern => pattern.endsWith("/**"))
    .map(pattern => path.resolve(root, patternRoot(pattern)));
  const matchedRoot = resolved === null
    ? null
    : writableRoots.find(writable => inside(writable, resolved)) ?? null;
  return {
    needed,
    environmentName: "TMPDIR",
    declaredValue: declared,
    resolvedPath: resolved,
    scratchRoot: matchedRoot,
    disposition: !needed
      ? "not_required"
      : resolved !== null && inside(root, resolved) && matchedRoot !== null
        ? "bound_to_disposable_scratch"
        : declared === null
          ? "not_declared"
          : "outside_disposable_scratch_tree",
  };
}

function detectedScriptTools(script) {
  if (script === null) return [];
  const alternatives = KNOWN_SCRIPT_TOOLS.join("|");
  const pattern = new RegExp(
    `(?:^|[\\s;&|])(?:[^\\s;&|/]+/)*(${alternatives})(?=\\s|$|[;&|])`,
    "giu",
  );
  return [...new Set(
    [...script.matchAll(pattern)]
      .map(match => match[1].toLowerCase()),
  )].sort();
}

function issue({ code, severity, phase, message, repairCommand }) {
  return { code, severity, phase, message, repairCommand };
}

function existingRegularRealpath(value) {
  try {
    const resolved = realpathSync(value);
    const stat = lstatSync(resolved);
    if (!stat.isFile()) return null;
    return resolved;
  } catch {
    return null;
  }
}

function packageToolExecutables({ root, cwd, detectedTools }) {
  const packageRoot = path.join(root, cwd);
  const values = [];
  for (const tool of detectedTools) {
    const launcher = existingRegularRealpath(
      path.join(packageRoot, "node_modules", ".bin", tool),
    );
    if (launcher) values.push(launcher);
  }
  if (detectedTools.some(tool => NATIVE_TOOLCHAIN_TOOLS.has(tool))) {
    for (const candidate of [
      path.join(packageRoot, "node_modules", "esbuild", "bin", "esbuild"),
      path.join(packageRoot, "node_modules", "@esbuild", "darwin-arm64", "bin", "esbuild"),
      path.join(packageRoot, "node_modules", "@esbuild", "darwin-x64", "bin", "esbuild"),
      path.join(packageRoot, "node_modules", "@esbuild", "linux-arm64", "bin", "esbuild"),
      path.join(packageRoot, "node_modules", "@esbuild", "linux-x64", "bin", "esbuild"),
    ]) {
      const resolved = existingRegularRealpath(candidate);
      if (resolved) values.push(resolved);
    }
  }
  return [...new Set(values)].sort();
}

function requiredSubprocesses({ root, cwd, invocation, detectedTools, platform }) {
  const required = [];
  if (new Set(["npm", "pnpm", "yarn"]).has(invocation.tool)) {
    if (existsSync("/bin/sh")) required.push(realpathSync("/bin/sh"));
  }
  if (platform === "darwin" && invocation.tool === "git" && existsSync("/usr/bin/xcrun")) {
    required.push(realpathSync("/usr/bin/xcrun"));
  }
  required.push(...packageToolExecutables({ root, cwd, detectedTools }));
  return [...new Set(required)].sort();
}

function phaseRows(envelope) {
  return ["setup", "check", "teardown"]
    .map(name => ({ name, command: envelope.phases[name] }))
    .filter(row => row.command !== null);
}

export function preflightFormalEnvelopeV1({
  workspaceRoot,
  envelope,
  platform = process.platform,
  backend = resolveVerificationEnvelopeBackendV1({ platform }),
} = {}) {
  const root = realpathSync(workspaceRoot);
  const validated = validateVerificationEnvelopeV1({ workspaceRoot: root, envelope });
  const runtimeIsolation = inspectRuntimeIsolationV1({ workspaceRoot: root });
  const issues = [];
  if (!backend.available) {
    issues.push(issue({
      code: "envelope_capability_missing",
      severity: "blocker",
      phase: null,
      message: `No Formal enforcement backend is available: ${backend.reason}.`,
      repairCommand: "Use a supported enforcement backend; do not weaken the envelope.",
    }));
  }

  const phases = phaseRows(validated.envelope).map(({ name, command }) => {
    const invocation = effectiveInvocation(command);
    const scriptName = packageScriptName(invocation);
    const script = readPackageScript(root, validated.envelope.cwd, scriptName);
    const detectedTools = detectedScriptTools(script);
    const requiredExecutables = requiredSubprocesses({
      root,
      cwd: validated.envelope.cwd,
      invocation,
      detectedTools,
      platform,
    });
    const missingExecutables = requiredExecutables.filter(executable => (
      validated.envelope.process.allowSubprocesses !== true
      || !validated.envelope.process.allowedExecutables.includes(executable)
    ));
    if (missingExecutables.length > 0) {
      issues.push(issue({
        code: "subprocess_capability_missing",
        severity: "blocker",
        phase: name,
        message: `${invocation.tool} requires subprocess executables not admitted by the envelope: ${missingExecutables.join(", ")}.`,
        repairCommand: `Set process.allowSubprocesses=true and add the exact regular executable paths: ${missingExecutables.join(", ")}.`,
      }));
    }
    const scanRoot = path.resolve(root, validated.envelope.cwd);
    const runtimeRoot = path.resolve(root, ".owlcoda/runkit");
    const phaseRuntimeIsolation = inspectRuntimeIsolationV1({ workspaceRoot: scanRoot });
    const affectedRuntimeScripts = scriptName === null
      ? []
      : phaseRuntimeIsolation.affectedScripts.filter(row => row.script === scriptName);
    const runtimeCollector = affectedRuntimeScripts.length > 0;
    if (scriptName !== null
      && runtimeCollector
      && inside(scanRoot, runtimeRoot)) {
      issues.push(issue({
        code: "runkit_runtime_scan_conflict",
        severity: "blocker",
        phase: name,
        message: `Project script ${scriptName} broadly scans the workspace and can enter the protected RunKit runtime root.`,
        repairCommand: `Exclude ${runtimeIsolation.recommendedIgnore} through the tool's supported ignore configuration.`,
      }));
    }
    const needsTemporaryDirectory = detectedTools.some(tool => NATIVE_TOOLCHAIN_TOOLS.has(tool));
    const temporaryDirectory = temporaryDirectoryBinding({
      root,
      envelope: validated.envelope,
      needed: needsTemporaryDirectory,
    });
    if (temporaryDirectory.disposition === "outside_disposable_scratch_tree") {
      issues.push(issue({
        code: "temporary_directory_not_declared",
        severity: "blocker",
        phase: name,
        message: "TMPDIR is declared outside a disposableScratch directory tree.",
        repairCommand: "Bind TMPDIR to a directory covered by one declared disposableScratch/** pattern.",
      }));
    } else if (temporaryDirectory.disposition === "not_declared") {
      issues.push(issue({
        code: "temporary_directory_may_be_required",
        severity: "warning",
        phase: name,
        message: `${detectedTools.join(", ")} may require a writable temporary directory or native helper process.`,
        repairCommand: "If the tool requires temporary writes, bind TMPDIR to a declared disposableScratch/** directory and admit only the exact helper executable.",
      }));
    }
    const devicePaths = [...command.argv, ...Object.values(validated.envelope.environment.values)]
      .filter(value => typeof value === "string" && value.startsWith("/dev/"));
    if (devicePaths.length > 0) {
      issues.push(issue({
        code: "device_path_dependency_detected",
        severity: "warning",
        phase: name,
        message: `The command declares device paths that may be incompatible with the sandbox: ${[...new Set(devicePaths)].join(", ")}.`,
        repairCommand: "Replace device-path dependencies with a declared disposableScratch file when possible.",
      }));
    }
    return {
      name,
      executable: command.executable,
      argv: [...command.argv],
      effectiveTool: invocation.tool,
      packageScript: scriptName,
      packageScriptCommand: script,
      detectedTools,
      requiredExecutables,
      temporaryDirectory,
      runtimeScan: {
        scanRoot,
        protectedRuntimeRoot: runtimeRoot,
        canReachProtectedRuntime: inside(scanRoot, runtimeRoot),
        collectorDetected: runtimeCollector,
        affectedScripts: affectedRuntimeScripts,
      },
    };
  });

  const orderedIssues = issues.sort((left, right) => (
    `${left.phase ?? ""}\u0000${left.code}`.localeCompare(`${right.phase ?? ""}\u0000${right.code}`)
  ));
  const blocked = orderedIssues.some(row => row.severity === "blocker");
  return {
    schemaVersion: PREFLIGHT_SCHEMA,
    status: blocked ? "blocked" : "ready",
    exitCode: blocked ? 2 : 0,
    envelopeId: validated.envelope.envelopeId,
    envelopeSha256: validated.envelopeSha256,
    backend,
    phases,
    runtimeIsolation,
    issues: orderedIssues,
    nextAllowedAction: blocked
      ? "repair_envelope_and_repeat_preflight"
      : "run_formal_check_with_exact_envelope",
    authorizationGranted: false,
  };
}

export function formatFormalEnvelopePreflightHumanV1(result) {
  const lines = [
    `Formal envelope preflight: ${result.status.toUpperCase()}`,
    `Backend: ${result.backend.id}${result.backend.available ? "" : " (unavailable)"}`,
  ];
  lines.push("Phases:");
  for (const phase of result.phases) {
    lines.push(`  ${phase.name}: ${[phase.executable, ...phase.argv].join(" ")}`);
    lines.push(`    Required subprocesses: ${phase.requiredExecutables.join(", ") || "none"}`);
    lines.push(
      `    Temporary directory: ${phase.temporaryDirectory.disposition}`
      + `${phase.temporaryDirectory.resolvedPath ? ` (${phase.temporaryDirectory.resolvedPath})` : ""}`,
    );
  }
  lines.push(
    `RunKit runtime scan: ${result.runtimeIsolation.status}; protected root .owlcoda/runkit/.`,
  );
  for (const row of result.issues) {
    lines.push(`${row.severity.toUpperCase()} ${row.code}${row.phase ? ` [${row.phase}]` : ""}: ${row.message}`);
    lines.push(`  Fix: ${row.repairCommand}`);
  }
  lines.push(`Next: ${result.nextAllowedAction}`);
  lines.push("Authority: no Git, release, deployment, production, or business authorization granted.");
  return `${lines.join("\n")}\n`;
}
