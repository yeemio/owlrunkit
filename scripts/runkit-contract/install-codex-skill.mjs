#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  currentCoreIdentity,
  isDirectExecution,
  validateProjectConfigV2,
} from "./core-contract.mjs";
import {
  defaultFleetRegistryPath,
  discoverFleet,
} from "./fleet-discovery.mjs";
import { inspectProjectControlState } from "./project-control-state.mjs";
import { resolveProjectCli } from "./project-cli-resolver.mjs";
import { validateStoredRegistryAdoptionEvidence } from "./registry-adoption-gate.mjs";

const MANIFEST_FILE = ".owlcoda-install-manifest.json";
const TRANSACTION_SCHEMA = "OwlCodaRunKitSharedSkillTransactionV1";
const TRANSACTION_OWNER_FILE = "shared-skill-owner.json";
const MAX_PROJECT_EVIDENCE_BYTES = 1_048_576;
const MAX_PROJECT_LOCKFILE_BYTES = 33_554_432;
const MAX_FLEET_PROJECTS = 256;
const MAX_SKILL_RECEIPT_BYTES = 134_217_728;
const MAX_V2_SKILL_RECEIPT_BYTES = 33_554_432;
const MAX_TRANSACTION_JOURNAL_BYTES = 16_777_216;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameCoreIdentity(left, right) {
  return [
    "contractVersion",
    "coreVersion",
    "coreManifestSha256",
    "coreSourceRef",
  ].every((field) => (
    typeof left?.[field] === "string"
    && left[field] === right?.[field]
  ));
}

function validLegacyConfigV1(config) {
  return config?.schemaVersion === "OwlCodaRunKitConfigV1"
    && config?.core?.contractVersion === "0.1"
    && config?.authorizationPolicy === "external_explicit_authority_required";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function projectRuntimeRepairDetail(issueCode, workspaceRoot, version) {
  return `${issueCode}; install exact owlrunkit@${version} with the project's lockfile-owning package manager, then run npx --no-install owlrunkit bootstrap --workspace ${shellQuote(workspaceRoot)} --exact owlrunkit@${version} --apply`;
}

function projectAdoptionRepairDetail(issueCodes, workspaceRoot, version) {
  return `${issueCodes.join(",")}; run npx --no-install owlrunkit adopt --workspace ${shellQuote(workspaceRoot)} --exact owlrunkit@${version}`;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

async function readProjectEvidenceBytes(workspaceRoot, relativePath, {
  maxBytes = MAX_PROJECT_EVIDENCE_BYTES,
  pathInvalidCode = "adoption_evidence_path_invalid",
  tooLargeCode = "adoption_evidence_too_large",
  identityChangedCode = "adoption_evidence_identity_changed",
} = {}) {
  const root = await realpath(path.resolve(workspaceRoot));
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (
    relative.length === 0
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(pathInvalidCode);
  }
  let current = root;
  const segments = relative.split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = await lstat(current);
    const leaf = index === segments.length - 1;
    if (
      stat.isSymbolicLink()
      || (!leaf && !stat.isDirectory())
      || (leaf && !stat.isFile())
    ) {
      throw new Error(pathInvalidCode);
    }
  }
  if (await realpath(target) !== target) {
    throw new Error(pathInvalidCode);
  }
  const handle = await open(target, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) {
      throw new Error(tooLargeCode);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const currentStat = await lstat(target);
    if (
      currentStat.isSymbolicLink()
      || !currentStat.isFile()
      || !sameFileIdentity(before, after)
      || !sameFileIdentity(after, currentStat)
      || await realpath(target) !== target
    ) {
      throw new Error(identityChangedCode);
    }
    return { bytes, path: target };
  } finally {
    await handle.close();
  }
}

async function governedProjectFiles(projectCli, {
  configPath,
  configBytes,
  adoptionPath,
  adoptionBytes,
}) {
  const workspaceRoot = projectCli.workspaceRoot;
  const specs = [
    {
      role: "workspace_package_manifest",
      absolutePath: path.join(workspaceRoot, "package.json"),
      maxBytes: MAX_PROJECT_EVIDENCE_BYTES,
    },
    {
      role: "lockfile",
      absolutePath: path.join(workspaceRoot, projectCli.lockfilePath),
      maxBytes: MAX_PROJECT_LOCKFILE_BYTES,
    },
    {
      role: "installed_package_manifest",
      absolutePath: path.join(projectCli.packageRoot, "package.json"),
      maxBytes: MAX_PROJECT_EVIDENCE_BYTES,
    },
  ];
  const files = [];
  for (const spec of specs) {
    const evidence = await readProjectEvidenceBytes(
      workspaceRoot,
      path.relative(workspaceRoot, spec.absolutePath),
      {
        maxBytes: spec.maxBytes,
        pathInvalidCode: "project_governed_file_invalid",
        tooLargeCode: "project_governed_file_too_large",
        identityChangedCode: "project_governed_file_identity_changed",
      },
    );
    files.push({
      role: spec.role,
      path: evidence.path,
      sha256: `sha256:${sha256(evidence.bytes)}`,
    });
  }
  files.push(
    {
      role: "project_config",
      path: configPath,
      sha256: `sha256:${sha256(configBytes)}`,
    },
    {
      role: "registry_adoption",
      path: adoptionPath,
      sha256: `sha256:${sha256(adoptionBytes)}`,
    },
  );
  return {
    files,
    sha256: `sha256:${sha256(Buffer.from(`${JSON.stringify(files)}\n`))}`,
  };
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWriteBytes(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, bytes, { flag: "wx" });
  await rename(temporaryPath, filePath);
}

function transactionJournalPath(targetRoot) {
  return `${path.resolve(targetRoot)}.transaction.json`;
}

function transactionDigest(body) {
  return `sha256:${sha256(Buffer.from(`${JSON.stringify(body)}\n`))}`;
}

function boundedJsonBytes(value, maxBytes, tooLargeCode) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (bytes.length > maxBytes) throw new Error(tooLargeCode);
  return bytes;
}

function transactionEvidenceRoot(transaction) {
  return path.join(
    path.resolve(transaction.archiveRoot),
    "transactions",
    transaction.transactionId,
  );
}

function transactionConfigReferenceIsValid(entry, side, transaction) {
  const base64 = entry[`${side}Base64`];
  const evidencePath = entry[`${side}Path`];
  return typeof entry.configPath === "string"
    && typeof entry[`${side}Sha256`] === "string"
    && (
      (typeof base64 === "string" && evidencePath === undefined)
      || (
        base64 === undefined
        && typeof evidencePath === "string"
        && pathIsStrictChild(transactionEvidenceRoot(transaction), evidencePath)
      )
    );
}

function pathIsStrictChild(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function writeTransactionJournal(journalPath, transaction, {
  exclusive = false,
} = {}) {
  const body = { ...transaction };
  delete body.transactionSha256;
  const stored = {
    ...body,
    transactionSha256: transactionDigest(body),
  };
  const bytes = boundedJsonBytes(
    stored,
    MAX_TRANSACTION_JOURNAL_BYTES,
    "skill_update_transaction_journal_too_large",
  );
  if (exclusive) {
    const temporaryPath = `${journalPath}.pending-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      await link(temporaryPath, journalPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  } else {
    await atomicWriteBytes(journalPath, bytes);
  }
  return stored;
}

async function readTransactionJournal(journalPath, {
  targetRoot,
  archiveRoot,
} = {}) {
  const stat = await lstat(journalPath);
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || stat.size > MAX_TRANSACTION_JOURNAL_BYTES
  ) {
    throw new Error("skill_update_transaction_journal_invalid");
  }
  const transaction = JSON.parse(await readFile(journalPath, "utf8"));
  const body = { ...transaction };
  delete body.transactionSha256;
  const resolvedTarget = path.resolve(targetRoot);
  const resolvedArchive = path.resolve(archiveRoot);
  if (
    transaction.schemaVersion !== TRANSACTION_SCHEMA
    || !new Set(["install", "restore", "restore_locking"]).has(
      transaction.operation,
    )
    || transaction.targetRoot !== resolvedTarget
    || transaction.archiveRoot !== resolvedArchive
    || transaction.authorizationGranted !== false
    || !/^[0-9a-f-]{36}$/u.test(transaction.transactionId ?? "")
    || transaction.transactionSha256 !== transactionDigest(body)
    || !Array.isArray(transaction.projectRoots)
    || transaction.projectRoots.some(root => typeof root !== "string")
  ) {
    throw new Error("skill_update_transaction_journal_invalid");
  }
  if (transaction.operation === "restore_locking") {
    if (transaction.phase !== "locking") {
      throw new Error("skill_update_transaction_journal_invalid");
    }
  } else if (transaction.operation === "install") {
    if (
      !new Set([
        "prepared",
        "locked",
        "prior_archived",
        "candidate_installed",
        "receipt_pending",
        "committed",
        "rolled_back",
      ]).has(transaction.phase)
      || typeof transaction.stagingRoot !== "string"
      || typeof transaction.toManifestSha256 !== "string"
    ) {
      throw new Error("skill_update_transaction_journal_invalid");
    }
    const resolvedStaging = path.resolve(transaction.stagingRoot);
    if (
      path.dirname(resolvedStaging) !== path.dirname(resolvedTarget)
      || !path.basename(resolvedStaging).startsWith(".owlcoda-runkit.install-")
    ) {
      throw new Error("skill_update_transaction_journal_invalid");
    }
    if (transaction.adoptionOnly === true && (
      transaction.priorManaged !== false
      || transaction.priorManifestSha256 !== transaction.toManifestSha256
      || transaction.priorArchivePath !== null
    )) {
      throw new Error("skill_update_transaction_journal_invalid");
    }
    if (transaction.priorManifestSha256 === null) {
      if (transaction.priorArchivePath !== null) {
        throw new Error("skill_update_transaction_journal_invalid");
      }
    } else if (transaction.adoptionOnly !== true && (
      typeof transaction.priorArchivePath !== "string"
      || !pathIsStrictChild(resolvedArchive, transaction.priorArchivePath)
    )) {
      throw new Error("skill_update_transaction_journal_invalid");
    }
  } else if (transaction.operation === "restore" && (
    !new Set([
      "prepared",
      "current_archived",
      "prior_restored",
      "configs_restoring",
      "receipt_pending",
      "committed",
      "rolled_back",
    ]).has(transaction.phase)
    || typeof transaction.fromManifestSha256 !== "string"
    || typeof transaction.toManifestSha256 !== "string"
    || typeof transaction.priorManaged !== "boolean"
    || typeof transaction.priorArchivePath !== "string"
    || !pathIsStrictChild(resolvedArchive, transaction.priorArchivePath)
    || typeof transaction.replacedInstallationArchivePath !== "string"
    || !pathIsStrictChild(
      resolvedArchive,
      transaction.replacedInstallationArchivePath,
    )
    || typeof transaction.sourceUpgradeReceiptPath !== "string"
    || !pathIsStrictChild(
      path.join(resolvedArchive, "receipts"),
      transaction.sourceUpgradeReceiptPath,
    )
    || typeof transaction.sourceUpgradeReceiptSha256 !== "string"
    || !Array.isArray(transaction.legacyConfigRestores)
    || typeof transaction.receiptPath !== "string"
    || typeof transaction.receiptSha256 !== "string"
  )) {
    throw new Error("skill_update_transaction_journal_invalid");
  }
  if (transaction.operation === "restore") {
    const allowedConfigPaths = new Set(transaction.projectRoots.map(root => (
      path.join(path.resolve(root), ".owlcoda/runkit/config.json")
    )));
    for (const entry of transaction.legacyConfigRestores) {
      if (!allowedConfigPaths.has(path.resolve(entry.configPath ?? ""))) {
        throw new Error("skill_update_transaction_journal_invalid");
      }
      if (transaction.phase === "committed") {
        if (
          !transactionConfigReferenceIsValid(entry, "before", transaction)
          || !transactionConfigReferenceIsValid(entry, "after", transaction)
        ) {
          throw new Error("skill_update_transaction_journal_invalid");
        }
      } else {
        await transactionConfigBytes(entry, "before", transaction);
        await transactionConfigBytes(entry, "after", transaction);
      }
    }
  }
  if (transaction.receiptPath != null && (
    !pathIsStrictChild(
      path.join(resolvedArchive, "receipts"),
      transaction.receiptPath,
    )
    || typeof transaction.receiptSha256 !== "string"
  )) {
    throw new Error("skill_update_transaction_journal_invalid");
  }
  return transaction;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function readOwnedLock(lockPath) {
  const stat = await lstat(lockPath);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error("skill_update_lock_invalid");
  }
  const ownerPath = stat.isDirectory()
    ? path.join(lockPath, TRANSACTION_OWNER_FILE)
    : lockPath;
  const ownerStat = await lstat(ownerPath);
  if (
    ownerStat.isSymbolicLink()
    || !ownerStat.isFile()
    || ownerStat.size > MAX_PROJECT_EVIDENCE_BYTES
  ) {
    throw new Error("skill_update_lock_invalid");
  }
  return JSON.parse(await readFile(ownerPath, "utf8"));
}

async function acquireOwnedDirectoryLock(lockPath, {
  activeCode,
  transactionId,
  targetRoot,
  recoverStale = false,
}) {
  const owner = {
    schemaVersion: "OwlCodaRunKitSharedSkillLockOwnerV1",
    transactionId,
    pid: process.pid,
    targetRoot: path.resolve(targetRoot),
    authorizationGranted: false,
  };
  const parent = path.dirname(lockPath);
  const temporaryPath = path.join(
    parent,
    `.${path.basename(lockPath)}.pending-${randomUUID()}`,
  );
  await writeFile(
    temporaryPath,
    `${JSON.stringify(owner, null, 2)}\n`,
    { flag: "wx" },
  );
  const activate = async () => {
    try {
      await link(temporaryPath, lockPath);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      return false;
    }
  };
  try {
    if (!await activate()) {
      if (recoverStale) {
        let existing = null;
        try {
          existing = await readOwnedLock(lockPath);
        } catch {
          // Unknown locks are never removed automatically.
        }
        if (
          existing?.schemaVersion === "OwlCodaRunKitSharedSkillLockOwnerV1"
          && existing.targetRoot === path.resolve(targetRoot)
          && existing.authorizationGranted === false
          && !processIsAlive(existing.pid)
        ) {
          await rm(lockPath, { recursive: true, force: true });
          if (!await activate()) throw new Error(activeCode);
        } else {
          throw new Error(activeCode);
        }
      } else {
        throw new Error(activeCode);
      }
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return async () => {
    if (!await exists(lockPath)) return;
    const currentOwner = await readOwnedLock(lockPath);
    if (currentOwner.transactionId !== transactionId) {
      throw new Error("skill_update_lock_owner_changed");
    }
    await rm(lockPath, { recursive: true, force: true });
  };
}

async function nextAvailablePath(parentRoot, baseName) {
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1
      ? ""
      : `-attempt-${String(attempt).padStart(3, "0")}`;
    const candidate = path.join(parentRoot, `${baseName}${suffix}`);
    if (!await exists(candidate)) return candidate;
  }
}

async function writeAppendOnlyReceipt(receiptsRoot, baseName, receipt) {
  await mkdir(receiptsRoot, { recursive: true });
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1
      ? ""
      : `-attempt-${String(attempt).padStart(3, "0")}`;
    const receiptPath = path.join(receiptsRoot, `${baseName}${suffix}.json`);
    try {
      await writeFile(
        receiptPath,
        `${JSON.stringify(receipt, null, 2)}\n`,
        { flag: "wx" },
      );
      return receiptPath;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
}

async function nextAppendOnlyReceiptPath(receiptsRoot, baseName) {
  await mkdir(receiptsRoot, { recursive: true });
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1
      ? ""
      : `-attempt-${String(attempt).padStart(3, "0")}`;
    const receiptPath = path.join(receiptsRoot, `${baseName}${suffix}.json`);
    if (!await exists(receiptPath)) return receiptPath;
  }
}

async function fileMap(root, { excludeManifest = true } = {}) {
  const files = {};
  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excludeManifest && relativePath === MANIFEST_FILE) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolutePath, relativePath);
      else if (entry.isFile()) files[relativePath] = sha256(await readFile(absolutePath));
      else throw new Error(`unsupported_skill_entry:${relativePath}`);
    }
  }
  await walk(root);
  return files;
}

function contentSha256(files) {
  const stream = Object.entries(files).map(([name, hash]) => `${name}\tsha256:${hash}\n`).join("");
  return sha256(stream);
}

async function buildManifest(root, repositoryRoot) {
  const wholeFileSha256 = await fileMap(root);
  const manifestSha256 = contentSha256(wholeFileSha256);
  return {
    schemaVersion: "OwlCodaRunKitSkillInstallManifestV1",
    skillName: "owlcoda-runkit",
    manifestSha256: `sha256:${manifestSha256}`,
    sourceRef: `artifact:sha256:${manifestSha256}`,
    sourceRepository: path.resolve(repositoryRoot),
    fileCount: Object.keys(wholeFileSha256).length,
    wholeFileSha256,
  };
}

async function replaceManifestAtomically(targetRoot, manifest) {
  const temporaryRoot = await mkdtemp(path.join(path.dirname(targetRoot), ".owlcoda-runkit.manifest-"));
  try {
    const temporaryManifest = path.join(temporaryRoot, MANIFEST_FILE);
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await rename(temporaryManifest, path.join(targetRoot, MANIFEST_FILE));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function assemble({ repositoryRoot, stagingRoot }) {
  const skillSource = path.join(repositoryRoot, "integrations/codex/skills/owlcoda-runkit");
  const coreSource = path.join(repositoryRoot, "scripts/runkit-contract");
  const attestSource = path.join(repositoryRoot, "packages/attest");
  const contractV01Source = path.join(repositoryRoot, "docs/architecture/OWLCODA_RUN_KIT_CONTRACT_V0_1.md");
  const contractV02Source = path.join(repositoryRoot, "docs/architecture/OWLCODA_RUN_KIT_CONTRACT_V0_2.md");
  for (const required of [path.join(skillSource, "SKILL.md"), path.join(skillSource, "agents/openai.yaml"), coreSource, attestSource, contractV01Source, contractV02Source]) {
    if (!await exists(required)) throw new Error(`missing_authoritative_skill_source:${required}`);
  }
  await cp(skillSource, stagingRoot, { recursive: true });
  await mkdir(path.join(stagingRoot, "scripts"), { recursive: true });
  await cp(coreSource, path.join(stagingRoot, "scripts/runkit-contract"), { recursive: true });
  await mkdir(path.join(stagingRoot, "packages"), { recursive: true });
  await cp(attestSource, path.join(stagingRoot, "packages/attest"), { recursive: true });
  await mkdir(path.join(stagingRoot, "references"), { recursive: true });
  await cp(contractV01Source, path.join(stagingRoot, "references/contract-v0.1.md"));
  await cp(contractV02Source, path.join(stagingRoot, "references/contract-v0.2.md"));
  const manifest = await buildManifest(stagingRoot, repositoryRoot);
  await writeFile(path.join(stagingRoot, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export async function inspectInstalledSkill({ targetRoot } = {}) {
  if (typeof targetRoot !== "string" || targetRoot.length === 0) throw new Error("targetRoot is required");
  if (!await exists(targetRoot)) return { status: "missing", valid: false };
  const manifestPath = path.join(targetRoot, MANIFEST_FILE);
  if (!await exists(manifestPath)) {
    const wholeFileSha256 = await fileMap(targetRoot);
    return {
      status: "unmanaged",
      valid: false,
      manifestSha256: `sha256:${contentSha256(wholeFileSha256)}`,
      wholeFileSha256,
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return { status: "drifted", valid: false, issues: ["invalid install manifest"] };
  }
  const actualFiles = await fileMap(targetRoot);
  const actualSha256 = `sha256:${contentSha256(actualFiles)}`;
  const issues = [];
  if (manifest.schemaVersion !== "OwlCodaRunKitSkillInstallManifestV1") issues.push("unsupported install manifest schema");
  if (manifest.manifestSha256 !== actualSha256) issues.push("installed_skill_drift: content fingerprint mismatch");
  if (JSON.stringify(manifest.wholeFileSha256) !== JSON.stringify(actualFiles)) issues.push("installed_skill_drift: file map mismatch");
  return {
    status: issues.length === 0 ? "valid" : "drifted",
    valid: issues.length === 0,
    manifestSha256: actualSha256,
    wholeFileSha256: actualFiles,
    manifest,
    issues,
  };
}

export async function inspectInstalledSkillCompatibility({ targetRoot } = {}) {
  const integrity = await inspectInstalledSkill({ targetRoot });
  if (!integrity.valid) {
    return {
      ...integrity,
      integrityValid: false,
      authorizationGranted: false,
    };
  }

  const expectedCore = currentCoreIdentity();
  let installedSkillVersion = null;
  let installedConfigCore = null;
  const issues = [];
  try {
    const skillText = await readFile(path.join(targetRoot, "SKILL.md"), "utf8");
    installedSkillVersion = skillText.match(/standalone `owlrunkit@(\d+\.\d+\.\d+)`/u)?.[1] ?? null;
    installedConfigCore = JSON.parse(await readFile(
      path.join(targetRoot, "assets/templates/config.json"),
      "utf8",
    )).core ?? null;
  } catch {
    issues.push("installed_skill_version_declaration_invalid");
  }

  const installedConfigCoreVersion = installedConfigCore?.coreVersion ?? null;
  if (installedSkillVersion === null || installedConfigCoreVersion === null) {
    issues.push("installed_skill_core_version_declaration_missing");
  } else if (
    installedSkillVersion !== expectedCore.coreVersion
    || installedConfigCoreVersion !== expectedCore.coreVersion
  ) {
    issues.push(
      `installed_skill_core_version_mismatch:expected_${expectedCore.coreVersion}`
      + `:skill_${installedSkillVersion}:config_${installedConfigCoreVersion}`,
    );
  } else if (!sameCoreIdentity(installedConfigCore, expectedCore)) {
    issues.push(
      `installed_skill_core_identity_mismatch:expected_${expectedCore.coreManifestSha256}`
      + `:config_${installedConfigCore?.coreManifestSha256 ?? "missing"}`,
    );
  }

  return {
    ...integrity,
    status: issues.length === 0 ? "valid" : "version_mismatch",
    valid: issues.length === 0,
    integrityValid: true,
    expectedCoreVersion: expectedCore.coreVersion,
    expectedCore,
    installedSkillVersion,
    installedConfigCoreVersion,
    installedConfigCore,
    issues,
    authorizationGranted: false,
  };
}

async function inspectFleetSnapshot({
  workspaceRoots = null,
  fleetManifestPath = null,
  fleetRoots = null,
  fleetRegistryPath = null,
} = {}) {
  let discovery;
  try {
    discovery = await discoverFleet({
      workspaceRoots,
      fleetManifestPath,
      fleetRoots,
      fleetRegistryPath,
    });
  } catch (error) {
    if (
      workspaceRoots === null
      && fleetManifestPath === null
      && fleetRoots === null
      && error?.message === "fleet_registry_missing"
    ) {
      throw new Error("skill_update_fleet_registry_missing");
    }
    throw error;
  }
  if (!discovery.complete) {
    const details = discovery.issues
      .map(issue => `${issue.code}:${issue.path}`)
      .join(",");
    throw new Error(
      `skill_update_fleet_discovery_incomplete:${details}`,
    );
  }
  const projects = [];
  for (const workspaceRoot of discovery.workspaceRoots) {
    const inspected = await inspectProjectForSkillChange(workspaceRoot);
    const activeBlockers = inspected.blockers.filter(blocker => (
      blocker.code === "active_execution"
      || blocker.code === "active_lease"
      || blocker.code === "control_state_invalid"
    ));
    if (activeBlockers.length > 0) {
      const detail = activeBlockers
        .map(blocker => blocker.artifactId ?? blocker.detail)
        .join(",");
      throw new Error(
        `skill_update_blocked_active_execution:${workspaceRoot}:${detail}`,
      );
    }
    const configBlocker = inspected.blockers.find(
      blocker => blocker.code === "project_config_invalid",
    );
    if (configBlocker) {
      throw new Error(
        `skill_update_fleet_config_invalid:${workspaceRoot}:${configBlocker.detail}`,
      );
    }
    const runtimeBlocker = inspected.blockers.find(
      blocker => blocker.code === "project_runtime_mismatch",
    );
    if (runtimeBlocker) {
      throw new Error(
        `skill_update_project_runtime_invalid:${workspaceRoot}:${runtimeBlocker.detail}`,
      );
    }
    const adoptionBlocker = inspected.blockers.find(
      blocker => blocker.code === "project_adoption_mismatch",
    );
    if (adoptionBlocker) {
      throw new Error(
        `skill_update_project_adoption_invalid:${workspaceRoot}:${adoptionBlocker.detail}`,
      );
    }
    projects.push(inspected.binding);
  }
  return { discovery, projects };
}

export async function inspectFleetForSkillChange(options = {}) {
  return (await inspectFleetSnapshot(options)).projects;
}

export async function inspectProjectForSkillChange(workspaceRoot) {
  const expectedCore = currentCoreIdentity();
  const blockers = [];
  const control = inspectProjectControlState({ workspaceRoot }).upgradeSafety;
  for (const artifactId of control.activeRunIds) {
    blockers.push({ code: "active_execution", workspaceRoot, artifactId });
  }
  for (const artifactId of control.activeLeaseIds) {
    blockers.push({ code: "active_lease", workspaceRoot, artifactId });
  }
  for (const issue of control.issues) {
    blockers.push({ code: "control_state_invalid", workspaceRoot, detail: issue });
  }

  const configPath = path.join(workspaceRoot, ".owlcoda/runkit/config.json");
  let configBytes = null;
  let config = null;
  try {
    configBytes = await readFile(configPath);
    config = JSON.parse(configBytes.toString("utf8"));
  } catch (error) {
    blockers.push({
      code: "project_config_invalid",
      workspaceRoot,
      detail: error instanceof SyntaxError
        ? "invalid_json"
        : error instanceof Error ? error.message : String(error),
    });
  }
  if (config !== null) {
    const validation = config.schemaVersion === "OwlCodaRunKitConfigV2"
      ? validateProjectConfigV2(config)
      : null;
    if ((validation !== null && !validation.valid)
      || (validation === null && !validLegacyConfigV1(config))) {
      blockers.push({
        code: "project_config_invalid",
        workspaceRoot,
        detail: validation?.issues?.join(",") ?? "unsupported_config",
      });
    }
  }

  let projectCli = null;
  let adoptionPath = null;
  let adoptionBytes = null;
  let governedFiles = null;
  if (!blockers.some(blocker => blocker.code === "project_config_invalid")) {
    projectCli = resolveProjectCli({
      workspaceRoot,
      expectedVersion: expectedCore.coreVersion,
    });
    if (projectCli.status !== "bound") {
      const issueCode = projectCli.issueCodes?.join(",")
        || "project_cli_install_binding_mismatch";
      blockers.push({
        code: "project_runtime_mismatch",
        workspaceRoot,
        detail: projectRuntimeRepairDetail(
          issueCode,
          workspaceRoot,
          expectedCore.coreVersion,
        ),
      });
    } else {
      const adoptionRelativePath = path.join(
        ".owlcoda/runkit/adoption",
        `owlrunkit-${expectedCore.coreVersion}.json`,
      );
      let adoption = null;
      try {
        const evidence = await readProjectEvidenceBytes(
          projectCli.workspaceRoot,
          adoptionRelativePath,
        );
        adoptionPath = evidence.path;
        adoptionBytes = evidence.bytes;
        adoption = JSON.parse(adoptionBytes.toString("utf8"));
      } catch (error) {
        blockers.push({
          code: "project_adoption_mismatch",
          workspaceRoot,
          detail: projectAdoptionRepairDetail(
            [error instanceof SyntaxError
              ? "adoption_evidence_invalid_json"
              : error instanceof Error ? error.message : String(error)],
            workspaceRoot,
            expectedCore.coreVersion,
          ),
        });
      }
      if (adoption !== null) {
        const validation = validateStoredRegistryAdoptionEvidence({
          evidence: adoption,
          packageName: "owlrunkit",
          version: expectedCore.coreVersion,
          localInstall: projectCli,
        });
        if (!validation.valid) {
          blockers.push({
            code: "project_adoption_mismatch",
            workspaceRoot,
            detail: projectAdoptionRepairDetail(
              validation.issueCodes,
              workspaceRoot,
              expectedCore.coreVersion,
            ),
          });
        }
      }
      if (!blockers.some(blocker => (
        blocker.code === "project_runtime_mismatch"
        || blocker.code === "project_adoption_mismatch"
      ))) {
        try {
          governedFiles = await governedProjectFiles(projectCli, {
            configPath,
            configBytes,
            adoptionPath,
            adoptionBytes,
          });
        } catch (error) {
          blockers.push({
            code: "project_runtime_mismatch",
            workspaceRoot,
            detail: projectRuntimeRepairDetail(
              error instanceof Error ? error.message : String(error),
              workspaceRoot,
              expectedCore.coreVersion,
            ),
          });
        }
      }
    }
  }

  const binding = projectCli?.status === "bound"
    && configBytes !== null
    && adoptionBytes !== null
    && governedFiles !== null
    && !blockers.some(blocker => (
      blocker.code === "project_config_invalid"
      || blocker.code === "project_runtime_mismatch"
      || blocker.code === "project_adoption_mismatch"
    ))
    ? {
        workspaceRoot: projectCli.workspaceRoot,
        configPath,
        configSha256: sha256(configBytes),
        packageName: projectCli.packageName,
        packageVersion: projectCli.version,
        packageManager: projectCli.packageManager,
        lockfilePath: path.join(projectCli.workspaceRoot, projectCli.lockfilePath),
        packageRoot: projectCli.packageRoot,
        cliPath: projectCli.cliPath,
        coreVersion: projectCli.installedCoreBinding.coreVersion,
        coreManifestSha256: projectCli.installedCoreBinding.coreManifestSha256,
        adoptionPath,
        adoptionSha256: sha256(adoptionBytes),
        governedFiles: governedFiles.files,
        governedFilesSha256: governedFiles.sha256,
        authorizationGranted: false,
      }
    : null;
  return {
    project: {
      workspaceRoot,
      configPath,
      configCoreVersion: config?.core?.coreVersion ?? null,
      activeRunIds: [...control.activeRunIds],
      activeLeaseIds: [...control.activeLeaseIds],
      upgradeSafe: blockers.length === 0,
    },
    blockers,
    binding,
  };
}

async function acquireProjectControlLocks(projects, {
  transactionId,
  targetRoot,
}) {
  const releases = [];
  try {
    for (const project of [...projects].sort((left, right) => (
      left.workspaceRoot < right.workspaceRoot
        ? -1
        : left.workspaceRoot > right.workspaceRoot ? 1 : 0
    ))) {
      const canonicalWorkspaceRoot = await realpath(
        path.resolve(project.workspaceRoot),
      );
      const runtimeRoot = path.join(
        canonicalWorkspaceRoot,
        ".owlcoda/runkit",
      );
      const runtimeStat = await lstat(runtimeRoot);
      if (
        runtimeStat.isSymbolicLink()
        || !runtimeStat.isDirectory()
        || await realpath(runtimeRoot) !== runtimeRoot
      ) {
        throw new Error(
          `skill_update_project_control_root_invalid:${project.workspaceRoot}`,
        );
      }
      releases.push(await acquireOwnedDirectoryLock(
        path.join(runtimeRoot, "control.lock"),
        {
          activeCode:
            `skill_update_project_control_transaction_active:${project.workspaceRoot}`,
          transactionId,
          targetRoot,
        },
      ));
    }
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
  return async () => {
    for (const release of releases.reverse()) await release();
  };
}

function sameFleetIdentity(left, right) {
  return left.discovery.frozenManifestSha256
      === right.discovery.frozenManifestSha256
    && left.discovery.source === right.discovery.source
    && (left.discovery.registrySha256 ?? null)
      === (right.discovery.registrySha256 ?? null);
}

function usesFleetRegistry(source) {
  return source.workspaceRoots === null
    && source.fleetManifestPath === null
    && source.fleetRoots === null;
}

function fleetRegistryPathFor(source) {
  return path.resolve(source.fleetRegistryPath ?? defaultFleetRegistryPath());
}

async function acquireFleetRegistryTransactionLock(source, {
  transactionId,
  targetRoot,
}) {
  if (!usesFleetRegistry(source)) return null;
  const registryPath = fleetRegistryPathFor(source);
  await mkdir(path.dirname(registryPath), { recursive: true });
  return acquireOwnedDirectoryLock(`${registryPath}.lock`, {
    activeCode: "skill_update_fleet_registry_transaction_active",
    transactionId,
    targetRoot,
    recoverStale: true,
  });
}

function fleetBindingFromSnapshot(snapshot) {
  const { discovery } = snapshot;
  return {
    schemaVersion: "OwlCodaRunKitFleetBindingV1",
    source: discovery.source,
    frozenManifestSha256: discovery.frozenManifestSha256,
    registryPath: discovery.registryPath ?? null,
    registrySha256: discovery.registrySha256 ?? null,
    manifestPath: discovery.manifestPath ?? null,
    coverageRoots: [...discovery.coverageRoots],
    workspaceRoots: [...discovery.workspaceRoots],
    authorizationGranted: false,
  };
}

function sourceFromFleetBinding(binding) {
  if (
    binding?.schemaVersion !== "OwlCodaRunKitFleetBindingV1"
    || binding.authorizationGranted !== false
    || typeof binding.frozenManifestSha256 !== "string"
    || !Array.isArray(binding.coverageRoots)
    || !Array.isArray(binding.workspaceRoots)
  ) {
    throw new Error("skill_rollback_fleet_binding_invalid");
  }
  if (binding.source === "explicit_workspaces") {
    return {
      workspaceRoots: binding.workspaceRoots,
      fleetManifestPath: null,
      fleetRoots: null,
      fleetRegistryPath: null,
    };
  }
  if (binding.source === "fleet_manifest" && typeof binding.manifestPath === "string") {
    return {
      workspaceRoots: null,
      fleetManifestPath: binding.manifestPath,
      fleetRoots: null,
      fleetRegistryPath: null,
    };
  }
  if (binding.source === "fleet_roots") {
    return {
      workspaceRoots: null,
      fleetManifestPath: null,
      fleetRoots: binding.coverageRoots,
      fleetRegistryPath: null,
    };
  }
  if (
    new Set(["fleet_registry", "fleet_registry_membership"]).has(binding.source)
    && typeof binding.registryPath === "string"
  ) {
    return {
      workspaceRoots: null,
      fleetManifestPath: null,
      fleetRoots: null,
      fleetRegistryPath: binding.registryPath,
    };
  }
  throw new Error("skill_rollback_fleet_binding_invalid");
}

function sameFleetBinding(binding, snapshot) {
  const current = fleetBindingFromSnapshot(snapshot);
  return JSON.stringify(binding) === JSON.stringify(current);
}

function sameProjectBindings(left, right) {
  if (left.length !== right.length) return false;
  return left.every((project, index) => {
    const candidate = right[index];
    return project.workspaceRoot === candidate.workspaceRoot
      && project.governedFilesSha256 === candidate.governedFilesSha256;
  });
}

async function lockFleetForSkillChange(source, {
  preliminary,
  transactionId,
  targetRoot,
}) {
  let releaseProjects = null;
  try {
    const frozen = await inspectFleetSnapshot(source);
    if (!sameFleetIdentity(preliminary, frozen)) {
      throw new Error("skill_update_fleet_identity_changed");
    }
    releaseProjects = await acquireProjectControlLocks(frozen.projects, {
      transactionId,
      targetRoot,
    });
    const locked = await inspectFleetSnapshot(source);
    if (
      !sameFleetIdentity(frozen, locked)
      || !sameProjectBindings(frozen.projects, locked.projects)
    ) {
      throw new Error("skill_update_fleet_identity_changed");
    }
    return {
      snapshot: locked,
      async release() {
        await releaseProjects();
        releaseProjects = null;
      },
    };
  } catch (error) {
    if (releaseProjects !== null) await releaseProjects();
    throw error;
  }
}

async function removeTransactionProjectLocks(transaction) {
  for (const workspaceRoot of [...transaction.projectRoots].sort().reverse()) {
    const lockPath = path.join(workspaceRoot, ".owlcoda/runkit/control.lock");
    if (!await exists(lockPath)) continue;
    let owner = null;
    try {
      owner = await readOwnedLock(lockPath);
    } catch {
      continue;
    }
    if (
      owner.schemaVersion !== "OwlCodaRunKitSharedSkillLockOwnerV1"
      || owner.transactionId !== transaction.transactionId
      || owner.targetRoot !== transaction.targetRoot
      || owner.authorizationGranted !== false
    ) {
      continue;
    }
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function inspectExpectedInstallation(root, expectedManifestSha256, {
  allowUnmanaged = false,
} = {}) {
  if (!await exists(root)) return { status: "missing" };
  const inspected = await inspectInstalledSkill({ targetRoot: root });
  const identityValid = inspected.manifestSha256 === expectedManifestSha256
    && (inspected.valid || (allowUnmanaged && inspected.status === "unmanaged"));
  if (!identityValid) {
    throw new Error("skill_update_transaction_installation_identity_mismatch");
  }
  return inspected;
}

async function transactionReceiptIsCommitted(transaction) {
  if (transaction.receiptPath === null) {
    return transaction.phase === "committed"
      && (
        transaction.operation === "restore"
        || transaction.priorManifestSha256 === null
        || transaction.adoptionOnly === true
      );
  }
  if (!await exists(transaction.receiptPath)) return false;
  const bytes = await readFile(transaction.receiptPath);
  if (`sha256:${sha256(bytes)}` !== transaction.receiptSha256) return false;
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString("utf8"));
  } catch {
    return false;
  }
  if (transaction.operation === "install") {
    return receipt.schemaVersion === "OwlCodaRunKitSkillUpgradeReceiptV2"
      && receipt.operation === "upgrade"
      && receipt.targetRoot === transaction.targetRoot
      && receipt.archiveRoot === transaction.archiveRoot
      && receipt.fromManifestSha256 === transaction.priorManifestSha256
      && receipt.toManifestSha256 === transaction.toManifestSha256
      && receipt.priorArchivePath === transaction.priorArchivePath
      && receipt.priorManaged === (transaction.priorManaged !== false)
      && receipt.projectMutationPerformed === false
      && receipt.authorizationGranted === false;
  }
  return new Set([
    "OwlCodaRunKitSkillRollbackReceiptV1",
    "OwlCodaRunKitSkillRollbackReceiptV2",
  ]).has(receipt.schemaVersion)
    && receipt.operation === "rollback"
    && receipt.sourceUpgradeReceiptPath === transaction.sourceUpgradeReceiptPath
    && `sha256:${receipt.sourceUpgradeReceiptSha256}`
      === transaction.sourceUpgradeReceiptSha256
    && receipt.targetRoot === transaction.targetRoot
    && receipt.archiveRoot === transaction.archiveRoot
    && receipt.fromManifestSha256 === transaction.fromManifestSha256
    && receipt.toManifestSha256 === transaction.toManifestSha256
    && receipt.replacedInstallationArchivePath
      === transaction.replacedInstallationArchivePath
    && receipt.authorizationGranted === false;
}

async function cleanRecoveredTransaction(transaction, journalPath) {
  await removeTransactionProjectLocks(transaction);
  await rm(journalPath, { force: true });
  await rm(transactionEvidenceRoot(transaction), {
    recursive: true,
    force: true,
  });
}

async function recoverInterruptedInstallTransaction(
  transaction,
  { resolvedTarget, resolvedArchive, journalPath },
) {
  if (transaction.phase === "rolled_back") {
    await cleanRecoveredTransaction(transaction, journalPath);
    return {
      status: "recovered_rolled_back_transaction",
      transactionId: transaction.transactionId,
      authorizationGranted: false,
    };
  }
  const priorManaged = transaction.priorManaged !== false;
  if (transaction.adoptionOnly === true) {
    const target = await inspectExpectedInstallation(
      resolvedTarget,
      transaction.toManifestSha256,
      { allowUnmanaged: true },
    );
    const committed = target.valid
      && await transactionReceiptIsCommitted(transaction);
    if (target.status === "missing") {
      throw new Error("skill_update_transaction_installation_identity_mismatch");
    }
    if (!committed && target.valid) {
      await rm(path.join(resolvedTarget, MANIFEST_FILE), { force: true });
      await inspectExpectedInstallation(
        resolvedTarget,
        transaction.priorManifestSha256,
        { allowUnmanaged: true },
      );
    }
    if (await exists(transaction.stagingRoot)) {
      await inspectExpectedInstallation(
        transaction.stagingRoot,
        transaction.toManifestSha256,
      );
      await rm(transaction.stagingRoot, { recursive: true, force: true });
    }
    if (!committed) {
      transaction = await writeTransactionJournal(journalPath, {
        ...transaction,
        phase: "rolled_back",
      });
    }
    await cleanRecoveredTransaction(transaction, journalPath);
    return {
      status: committed
        ? "recovered_committed_transaction"
        : "recovered_rolled_back_transaction",
      transactionId: transaction.transactionId,
      authorizationGranted: false,
    };
  }

  const target = await inspectExpectedInstallation(
    resolvedTarget,
    transaction.toManifestSha256,
  ).catch(async (error) => {
    if (transaction.priorManifestSha256 !== null) {
      const prior = await inspectExpectedInstallation(
        resolvedTarget,
        transaction.priorManifestSha256,
        { allowUnmanaged: !priorManaged },
      ).catch(() => null);
      if (prior !== null) return prior;
    }
    throw error;
  });
  const committed = target.status !== "missing"
    && target.manifestSha256 === transaction.toManifestSha256
    && await transactionReceiptIsCommitted(transaction);
  if (committed) {
    if (transaction.priorManifestSha256 !== null) {
      await inspectExpectedInstallation(
        transaction.priorArchivePath,
        transaction.priorManifestSha256,
        { allowUnmanaged: !priorManaged },
      );
    }
    if (await exists(transaction.stagingRoot)) {
      await inspectExpectedInstallation(
        transaction.stagingRoot,
        transaction.toManifestSha256,
      );
      await rm(transaction.stagingRoot, { recursive: true, force: true });
    }
    await cleanRecoveredTransaction(transaction, journalPath);
    return {
      status: "recovered_committed_transaction",
      transactionId: transaction.transactionId,
      authorizationGranted: false,
    };
  }

  await mkdir(resolvedArchive, { recursive: true });
  if (transaction.priorManifestSha256 === null) {
    if (target.status !== "missing") {
      if (target.manifestSha256 !== transaction.toManifestSha256) {
        throw new Error("skill_update_transaction_installation_identity_mismatch");
      }
      const failedArchivePath = await nextAvailablePath(
        resolvedArchive,
        `owlcoda-runkit-failed-${transaction.toManifestSha256.slice(7)}`,
      );
      await rename(resolvedTarget, failedArchivePath);
    }
  } else {
    const priorArchive = await inspectExpectedInstallation(
      transaction.priorArchivePath,
      transaction.priorManifestSha256,
      { allowUnmanaged: !priorManaged },
    );
    if (
      target.status !== "missing"
      && target.manifestSha256 === transaction.priorManifestSha256
    ) {
      if (priorArchive.status !== "missing") {
        throw new Error("skill_update_transaction_prior_identity_duplicated");
      }
    } else {
      if (priorArchive.status === "missing") {
        throw new Error("skill_update_transaction_prior_identity_missing");
      }
      if (target.status !== "missing") {
        if (target.manifestSha256 !== transaction.toManifestSha256) {
          throw new Error("skill_update_transaction_installation_identity_mismatch");
        }
        const failedArchivePath = await nextAvailablePath(
          resolvedArchive,
          `owlcoda-runkit-failed-${transaction.toManifestSha256.slice(7)}`,
        );
        await rename(resolvedTarget, failedArchivePath);
      }
      await rename(transaction.priorArchivePath, resolvedTarget);
    }
  }
  if (await exists(transaction.stagingRoot)) {
    await inspectExpectedInstallation(
      transaction.stagingRoot,
      transaction.toManifestSha256,
    );
    await rm(transaction.stagingRoot, { recursive: true, force: true });
  }
  transaction = await writeTransactionJournal(journalPath, {
    ...transaction,
    phase: "rolled_back",
  });
  await cleanRecoveredTransaction(transaction, journalPath);
  return {
    status: "recovered_rolled_back_transaction",
    transactionId: transaction.transactionId,
    authorizationGranted: false,
  };
}

async function transactionConfigBytes(entry, side, transaction) {
  const base64 = entry[`${side}Base64`];
  const evidencePath = entry[`${side}Path`];
  const expectedSha256 = entry[`${side}Sha256`];
  if (
    typeof entry.configPath !== "string"
    || typeof expectedSha256 !== "string"
  ) {
    throw new Error("skill_update_transaction_journal_invalid");
  }
  let bytes;
  if (typeof base64 === "string" && evidencePath === undefined) {
    bytes = Buffer.from(base64, "base64");
    if (bytes.length > MAX_PROJECT_EVIDENCE_BYTES) {
      throw new Error("skill_update_transaction_journal_invalid");
    }
  } else if (
    base64 === undefined
    && typeof evidencePath === "string"
    && transaction !== undefined
    && pathIsStrictChild(transactionEvidenceRoot(transaction), evidencePath)
  ) {
    const root = transactionEvidenceRoot(transaction);
    const evidence = await readProjectEvidenceBytes(
      root,
      path.relative(root, evidencePath),
      {
        maxBytes: MAX_PROJECT_EVIDENCE_BYTES,
        pathInvalidCode: "skill_update_transaction_journal_invalid",
        tooLargeCode: "skill_update_transaction_journal_invalid",
        identityChangedCode: "skill_update_transaction_journal_invalid",
      },
    );
    bytes = evidence.bytes;
  } else {
    throw new Error("skill_update_transaction_journal_invalid");
  }
  if (`sha256:${sha256(bytes)}` !== expectedSha256) {
    throw new Error("skill_update_transaction_journal_invalid");
  }
  return bytes;
}

async function writeLegacyConfigRestoreEvidence(transaction, restores) {
  for (const restore of restores) {
    if (
      restore.beforeBytes.length > MAX_PROJECT_EVIDENCE_BYTES
      || restore.afterBytes.length > MAX_PROJECT_EVIDENCE_BYTES
    ) {
      throw new Error("skill_rollback_legacy_config_too_large");
    }
  }
  const root = transactionEvidenceRoot(transaction);
  await mkdir(path.dirname(root), { recursive: true });
  await mkdir(root);
  const entries = [];
  for (const [index, restore] of restores.entries()) {
    const stem = String(index).padStart(3, "0");
    const beforePath = path.join(root, `${stem}-before.json`);
    const afterPath = path.join(root, `${stem}-after.json`);
    await writeFile(beforePath, restore.beforeBytes, { flag: "wx" });
    await writeFile(afterPath, restore.afterBytes, { flag: "wx" });
    entries.push({
      configPath: restore.configPath,
      beforeSha256: `sha256:${sha256(restore.beforeBytes)}`,
      beforePath,
      afterSha256: `sha256:${sha256(restore.afterBytes)}`,
      afterPath,
    });
  }
  return entries;
}

async function maybeInspectExpectedInstallation(root, expectedManifestSha256, options) {
  try {
    const inspected = await inspectExpectedInstallation(
      root,
      expectedManifestSha256,
      options,
    );
    return inspected.status === "missing" ? null : inspected;
  } catch {
    return null;
  }
}

async function recoverInterruptedRestoreTransaction(
  transaction,
  { resolvedTarget, journalPath },
) {
  if (transaction.phase === "rolled_back") {
    await cleanRecoveredTransaction(transaction, journalPath);
    return {
      status: "recovered_rolled_back_transaction",
      transactionId: transaction.transactionId,
      authorizationGranted: false,
    };
  }
  const sourceReceiptBytes = await readFile(transaction.sourceUpgradeReceiptPath);
  if (`sha256:${sha256(sourceReceiptBytes)}` !== transaction.sourceUpgradeReceiptSha256) {
    throw new Error("skill_update_transaction_source_receipt_identity_mismatch");
  }
  const targetPrior = await maybeInspectExpectedInstallation(
    resolvedTarget,
    transaction.toManifestSha256,
    { allowUnmanaged: !transaction.priorManaged },
  );
  const targetCurrent = targetPrior === null
    ? await maybeInspectExpectedInstallation(
        resolvedTarget,
        transaction.fromManifestSha256,
      )
    : null;
  if (await exists(resolvedTarget) && targetPrior === null && targetCurrent === null) {
    throw new Error("skill_update_transaction_installation_identity_mismatch");
  }
  const committed = targetPrior !== null
    && await transactionReceiptIsCommitted(transaction);
  if (committed) {
    const priorArchive = await maybeInspectExpectedInstallation(
      transaction.priorArchivePath,
      transaction.toManifestSha256,
      { allowUnmanaged: !transaction.priorManaged },
    );
    const replaced = await maybeInspectExpectedInstallation(
      transaction.replacedInstallationArchivePath,
      transaction.fromManifestSha256,
    );
    if (priorArchive !== null || replaced === null) {
      throw new Error("skill_update_transaction_installation_identity_mismatch");
    }
    for (const entry of transaction.legacyConfigRestores) {
      const actual = await readFile(entry.configPath);
      if (`sha256:${sha256(actual)}` !== entry.afterSha256) {
        throw new Error("skill_update_transaction_config_identity_mismatch");
      }
    }
    await cleanRecoveredTransaction(transaction, journalPath);
    return {
      status: "recovered_committed_transaction",
      operation: "restore",
      transactionId: transaction.transactionId,
      manifestSha256: transaction.toManifestSha256,
      rollbackReceipt: transaction.receiptPath,
      replacedInstallation: {
        manifestSha256: transaction.fromManifestSha256,
        archivePath: transaction.replacedInstallationArchivePath,
      },
      projectMutationPerformed: transaction.legacyConfigRestores.length > 0,
      authorizationGranted: false,
    };
  }

  const priorArchive = await maybeInspectExpectedInstallation(
    transaction.priorArchivePath,
    transaction.toManifestSha256,
    { allowUnmanaged: !transaction.priorManaged },
  );
  const replaced = await maybeInspectExpectedInstallation(
    transaction.replacedInstallationArchivePath,
    transaction.fromManifestSha256,
  );
  if (targetPrior !== null) {
    if (priorArchive !== null) {
      throw new Error("skill_update_transaction_prior_identity_duplicated");
    }
    await rename(resolvedTarget, transaction.priorArchivePath);
  } else if (priorArchive === null) {
    throw new Error("skill_update_transaction_prior_identity_missing");
  }
  if (targetCurrent === null) {
    if (replaced === null) {
      throw new Error("skill_update_transaction_installation_identity_mismatch");
    }
    await rename(transaction.replacedInstallationArchivePath, resolvedTarget);
  } else if (replaced !== null) {
    throw new Error("skill_update_transaction_installation_identity_duplicated");
  }
  for (const entry of transaction.legacyConfigRestores) {
    await atomicWriteBytes(
      entry.configPath,
      await transactionConfigBytes(entry, "before", transaction),
    );
  }
  transaction = await writeTransactionJournal(journalPath, {
    ...transaction,
    phase: "rolled_back",
  });
  await cleanRecoveredTransaction(transaction, journalPath);
  return {
    status: "recovered_rolled_back_transaction",
    transactionId: transaction.transactionId,
    authorizationGranted: false,
  };
}

export async function recoverInterruptedCodexSkillTransaction({
  targetRoot,
  archiveRoot,
} = {}) {
  if (typeof targetRoot !== "string" || typeof archiveRoot !== "string") {
    throw new Error("targetRoot and archiveRoot are required");
  }
  const resolvedTarget = path.resolve(targetRoot);
  const resolvedArchive = path.resolve(archiveRoot);
  const journalPath = transactionJournalPath(resolvedTarget);
  if (!await exists(journalPath)) {
    return { status: "no_pending_transaction", authorizationGranted: false };
  }
  const transaction = await readTransactionJournal(journalPath, {
    targetRoot: resolvedTarget,
    archiveRoot: resolvedArchive,
  });
  const context = { resolvedTarget, resolvedArchive, journalPath };
  if (transaction.operation === "restore_locking") {
    await cleanRecoveredTransaction(transaction, journalPath);
    return {
      status: "recovered_rolled_back_transaction",
      operation: "restore_locking",
      transactionId: transaction.transactionId,
      authorizationGranted: false,
    };
  }
  return transaction.operation === "install"
    ? recoverInterruptedInstallTransaction(transaction, context)
    : recoverInterruptedRestoreTransaction(transaction, context);
}

async function inspectLegacyProjectsForRollback(workspaceRoots) {
  const projects = [];
  for (const workspaceRoot of workspaceRoots) {
    const safety = inspectProjectControlState({ workspaceRoot }).upgradeSafety;
    if (safety.status !== "safe") {
      const blockers = [
        ...safety.activeRunIds,
        ...safety.activeLeaseIds,
        ...safety.issues,
      ].join(",");
      throw new Error(
        `skill_update_blocked_active_execution:${workspaceRoot}:${blockers}`,
      );
    }
    const configPath = path.join(workspaceRoot, ".owlcoda/runkit/config.json");
    const configBytes = await readFile(configPath);
    let config;
    try {
      config = JSON.parse(configBytes.toString("utf8"));
    } catch {
      throw new Error(`skill_update_fleet_config_invalid:${workspaceRoot}:invalid_json`);
    }
    const validation = config?.schemaVersion === "OwlCodaRunKitConfigV2"
      ? validateProjectConfigV2(config)
      : null;
    if ((validation !== null && !validation.valid)
      || (validation === null && !validLegacyConfigV1(config))) {
      throw new Error(
        `skill_update_fleet_config_invalid:${workspaceRoot}:${validation?.issues?.join(",") ?? "unsupported_config"}`,
      );
    }
    projects.push({
      workspaceRoot,
      configPath,
      configBytes,
      configSha256: sha256(configBytes),
    });
  }
  return projects;
}

export async function installCodexSkill({
  repositoryRoot,
  targetRoot,
  archiveRoot,
  expectedUnmanagedManifestSha256 = null,
  workspaceRoots = null,
  fleetManifestPath = null,
  fleetRoots = null,
  fleetRegistryPath = null,
} = {}) {
  if (typeof repositoryRoot !== "string" || typeof targetRoot !== "string" || typeof archiveRoot !== "string") {
    throw new Error("repositoryRoot, targetRoot, and archiveRoot are required");
  }
  const resolvedTargetRoot = path.resolve(targetRoot);
  const resolvedArchiveRoot = path.resolve(archiveRoot);
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const source = {
    workspaceRoots,
    fleetManifestPath,
    fleetRoots,
    fleetRegistryPath,
  };
  const parent = path.dirname(resolvedTargetRoot);
  await mkdir(parent, { recursive: true });
  const transactionId = randomUUID();
  const releaseSkillLock = await acquireOwnedDirectoryLock(
    `${resolvedTargetRoot}.lock`,
    {
      activeCode: "skill_update_shared_skill_transaction_active",
      transactionId,
      targetRoot: resolvedTargetRoot,
      recoverStale: true,
    },
  );
  let stagingRoot = null;
  let stagingPresent = true;
  let fleetLock = null;
  let releaseRegistryLock = null;
  let transaction = null;
  const journalPath = transactionJournalPath(resolvedTargetRoot);
  try {
    releaseRegistryLock = await acquireFleetRegistryTransactionLock(source, {
      transactionId,
      targetRoot: resolvedTargetRoot,
    });
    await recoverInterruptedCodexSkillTransaction({
      targetRoot: resolvedTargetRoot,
      archiveRoot: resolvedArchiveRoot,
    });
    stagingRoot = await mkdtemp(path.join(parent, ".owlcoda-runkit.install-"));
    const desired = await assemble({
      repositoryRoot: resolvedRepositoryRoot,
      stagingRoot,
    });
    const prior = await inspectInstalledSkill({ targetRoot: resolvedTargetRoot });
    const explicitFleetSource = (
      workspaceRoots !== null
      || fleetManifestPath !== null
      || fleetRoots !== null
      || fleetRegistryPath !== null
    );
    const registeredFleetExists = await exists(fleetRegistryPathFor(source));
    if (prior.status === "unmanaged") {
      if (prior.manifestSha256 === desired.manifestSha256) {
        const preliminary = explicitFleetSource || registeredFleetExists
          ? await inspectFleetSnapshot(source)
          : null;
        transaction = await writeTransactionJournal(journalPath, {
          schemaVersion: TRANSACTION_SCHEMA,
          transactionId,
          operation: "install",
          phase: "prepared",
          targetRoot: resolvedTargetRoot,
          archiveRoot: resolvedArchiveRoot,
          stagingRoot,
          priorManifestSha256: prior.manifestSha256,
          priorArchivePath: null,
          priorManaged: false,
          adoptionOnly: true,
          toManifestSha256: desired.manifestSha256,
          projectRoots: preliminary?.projects.map(project => project.workspaceRoot) ?? [],
          receiptPath: null,
          receiptSha256: null,
          authorizationGranted: false,
        }, { exclusive: true });
        if (preliminary !== null) {
          fleetLock = await lockFleetForSkillChange(source, {
            preliminary,
            transactionId,
            targetRoot: resolvedTargetRoot,
          });
        }
        transaction = await writeTransactionJournal(journalPath, {
          ...transaction,
          phase: "locked",
        });
        await replaceManifestAtomically(resolvedTargetRoot, desired);
        transaction = await writeTransactionJournal(journalPath, {
          ...transaction,
          phase: "candidate_installed",
        });
        if (fleetLock !== null) {
          const postflight = await inspectFleetSnapshot(source);
          if (
            !sameFleetIdentity(fleetLock.snapshot, postflight)
            || !sameProjectBindings(fleetLock.snapshot.projects, postflight.projects)
          ) {
            throw new Error("skill_update_fleet_postflight_changed");
          }
        }
        transaction = await writeTransactionJournal(journalPath, {
          ...transaction,
          phase: "committed",
        });
        if (fleetLock !== null) {
          await fleetLock.release();
          fleetLock = null;
        }
        await rm(journalPath, { force: true });
        transaction = null;
        return { status: "adopted", manifestSha256: desired.manifestSha256, previousInstallation: null };
      }
      if (prior.manifestSha256 !== expectedUnmanagedManifestSha256) {
        throw new Error("installed_skill_drift: unmanaged installation differs from authoritative source and expected prior manifest");
      }
    }
    if (
      prior.status !== "missing"
      && prior.status !== "unmanaged"
      && !prior.valid
    ) {
      throw new Error(`installed_skill_drift: ${prior.issues.join("; ")}`);
    }
    if (
      prior.status !== "missing"
      && prior.manifestSha256 === desired.manifestSha256
    ) {
      if (prior.manifest?.sourceRepository !== desired.sourceRepository) {
        await replaceManifestAtomically(resolvedTargetRoot, desired);
        return { status: "provenance_updated", manifestSha256: desired.manifestSha256, previousInstallation: null };
      }
      return { status: "unchanged", manifestSha256: desired.manifestSha256, previousInstallation: null };
    }
    const shouldInspectFleet = prior.status !== "missing"
      || explicitFleetSource
      || registeredFleetExists;
    const preliminary = shouldInspectFleet
      ? await inspectFleetSnapshot(source)
      : null;
    let archivePath = null;
    if (prior.status !== "missing") {
      await mkdir(resolvedArchiveRoot, { recursive: true });
      archivePath = await nextAvailablePath(
        resolvedArchiveRoot,
        `owlcoda-runkit-${prior.manifestSha256.slice(7)}`,
      );
    }
    transaction = await writeTransactionJournal(journalPath, {
      schemaVersion: TRANSACTION_SCHEMA,
      transactionId,
      operation: "install",
      phase: "prepared",
      targetRoot: resolvedTargetRoot,
      archiveRoot: resolvedArchiveRoot,
      stagingRoot,
      priorManifestSha256: prior.status === "missing"
        ? null
        : prior.manifestSha256,
      priorArchivePath: archivePath,
      priorManaged: prior.status !== "unmanaged",
      adoptionOnly: false,
      toManifestSha256: desired.manifestSha256,
      projectRoots: preliminary?.projects.map(project => project.workspaceRoot) ?? [],
      receiptPath: null,
      receiptSha256: null,
      authorizationGranted: false,
    }, { exclusive: true });
    if (preliminary !== null) {
      fleetLock = await lockFleetForSkillChange(source, {
        preliminary,
        transactionId,
        targetRoot: resolvedTargetRoot,
      });
    }
    transaction = await writeTransactionJournal(journalPath, {
      ...transaction,
      phase: "locked",
    });
    let upgradeReceipt = null;
    let upgradeReceiptBytes = null;
    let projectBindings = [];
    if (archivePath !== null) {
      projectBindings = fleetLock.snapshot.projects.map(project => ({
        ...project,
        postflightConfigSha256: project.configSha256,
        postflightAdoptionSha256: project.adoptionSha256,
        postflightGovernedFiles: project.governedFiles,
        postflightGovernedFilesSha256: project.governedFilesSha256,
      }));
      upgradeReceiptBytes = boundedJsonBytes({
        schemaVersion: "OwlCodaRunKitSkillUpgradeReceiptV2",
        operation: "upgrade",
        targetRoot: resolvedTargetRoot,
        archiveRoot: resolvedArchiveRoot,
        fromManifestSha256: prior.manifestSha256,
        toManifestSha256: desired.manifestSha256,
        priorArchivePath: archivePath,
        priorManaged: prior.status !== "unmanaged",
        fleetBinding: fleetBindingFromSnapshot(fleetLock.snapshot),
        projects: projectBindings,
        projectMutationPerformed: false,
        authorizationGranted: false,
      }, MAX_V2_SKILL_RECEIPT_BYTES, "skill_update_receipt_too_large");
      upgradeReceipt = await nextAppendOnlyReceiptPath(
        path.join(resolvedArchiveRoot, "receipts"),
        `skill-upgrade-${prior.manifestSha256.slice(7)}-to-${desired.manifestSha256.slice(7)}`,
      );
    }
    if (archivePath !== null) {
      await rename(resolvedTargetRoot, archivePath);
      transaction = await writeTransactionJournal(journalPath, {
        ...transaction,
        phase: "prior_archived",
      });
    }
    await rename(stagingRoot, resolvedTargetRoot);
    stagingPresent = false;
    transaction = await writeTransactionJournal(journalPath, {
      ...transaction,
      phase: "candidate_installed",
    });
    let postflight = null;
    if (fleetLock !== null) {
      postflight = await inspectFleetSnapshot(source);
      if (
        !sameFleetIdentity(fleetLock.snapshot, postflight)
        || !sameProjectBindings(
          fleetLock.snapshot.projects,
          postflight.projects,
        )
      ) {
        throw new Error("skill_update_fleet_postflight_changed");
      }
    }

    if (archivePath !== null) {
      transaction = await writeTransactionJournal(journalPath, {
        ...transaction,
        phase: "receipt_pending",
        receiptPath: upgradeReceipt,
        receiptSha256: `sha256:${sha256(upgradeReceiptBytes)}`,
      });
      await writeFile(upgradeReceipt, upgradeReceiptBytes, { flag: "wx" });
    }
    transaction = await writeTransactionJournal(journalPath, {
      ...transaction,
      phase: "committed",
    });
    if (fleetLock !== null) {
      await fleetLock.release();
      fleetLock = null;
    }
    await rm(journalPath, { force: true });
    transaction = null;
    if (archivePath === null) {
      return {
        status: "installed",
        manifestSha256: desired.manifestSha256,
        previousInstallation: null,
        projectMutationPerformed: false,
      };
    }
    return {
      status: "updated",
      manifestSha256: desired.manifestSha256,
      previousInstallation: {
        manifestSha256: prior.manifestSha256,
        archivePath,
      },
      upgradeReceipt,
      projectBindings,
      projectMutationPerformed: false,
    };
  } catch (error) {
    if (transaction !== null || await exists(journalPath)) {
      try {
        await recoverInterruptedCodexSkillTransaction({
          targetRoot: resolvedTargetRoot,
          archiveRoot: resolvedArchiveRoot,
        });
        transaction = null;
      } catch (recoveryError) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; `
          + `skill_update_transaction_recovery_failed:${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
        );
      }
    }
    throw error;
  } finally {
    if (fleetLock !== null) await fleetLock.release();
    if (stagingPresent && stagingRoot !== null) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
    if (releaseRegistryLock !== null) await releaseRegistryLock();
    await releaseSkillLock();
  }
}

async function readUpgradeReceiptForRestore({
  targetRoot,
  archiveRoot,
  upgradeReceiptPath,
}) {
  if (
    typeof targetRoot !== "string"
    || typeof archiveRoot !== "string"
    || typeof upgradeReceiptPath !== "string"
  ) {
    throw new Error("targetRoot, archiveRoot, and upgradeReceiptPath are required");
  }
  const resolvedTarget = path.resolve(targetRoot);
  const resolvedArchive = path.resolve(archiveRoot);
  const resolvedReceipt = path.resolve(upgradeReceiptPath);
  const receiptRelative = path.relative(
    path.join(resolvedArchive, "receipts"),
    resolvedReceipt,
  );
  if (
    receiptRelative.startsWith("..")
    || path.isAbsolute(receiptRelative)
    || !receiptRelative.endsWith(".json")
  ) {
    throw new Error("skill_rollback_receipt_outside_archive");
  }
  const receiptStat = await lstat(resolvedReceipt);
  if (
    receiptStat.isSymbolicLink()
    || !receiptStat.isFile()
    || receiptStat.size > MAX_SKILL_RECEIPT_BYTES
  ) {
    throw new Error("skill_rollback_receipt_too_large");
  }
  const receiptBytes = await readFile(resolvedReceipt);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const legacyReceipt = receipt.schemaVersion === "OwlCodaRunKitSkillUpgradeReceiptV1";
  const boundReceipt = receipt.schemaVersion === "OwlCodaRunKitSkillUpgradeReceiptV2";
  if (
    (!legacyReceipt && !boundReceipt)
    || receipt.operation !== "upgrade"
    || receipt.targetRoot !== resolvedTarget
    || receipt.archiveRoot !== resolvedArchive
    || receipt.authorizationGranted !== false
    || !Array.isArray(receipt.projects)
    || receipt.projects.length > MAX_FLEET_PROJECTS
    || (legacyReceipt && receipt.projects.length === 0)
    || (boundReceipt && receipt.projectMutationPerformed !== false)
  ) {
    throw new Error("skill_rollback_receipt_invalid");
  }
  if (boundReceipt) {
    if (receiptBytes.length > MAX_V2_SKILL_RECEIPT_BYTES) {
      throw new Error("skill_rollback_receipt_too_large");
    }
    sourceFromFleetBinding(receipt.fleetBinding);
  }
  const resolvedPriorArchive = path.resolve(receipt.priorArchivePath);
  const priorArchiveRelative = path.relative(
    resolvedArchive,
    resolvedPriorArchive,
  );
  if (
    receipt.priorArchivePath !== resolvedPriorArchive
    || priorArchiveRelative.startsWith("..")
    || path.isAbsolute(priorArchiveRelative)
    || priorArchiveRelative.length === 0
    || priorArchiveRelative === "receipts"
    || priorArchiveRelative.startsWith(`receipts${path.sep}`)
  ) {
    throw new Error("skill_rollback_prior_archive_outside_root");
  }
  if (legacyReceipt) {
    for (const project of receipt.projects) {
      project.workspaceRoot = await realpath(path.resolve(project.workspaceRoot));
      project.configPath = await realpath(path.resolve(project.configPath));
    }
  }
  return {
    receipt,
    receiptBytes,
    legacyReceipt,
    boundReceipt,
    resolvedTarget,
    resolvedArchive,
    resolvedReceipt,
    resolvedPriorArchive,
  };
}

function restoreFleetSource(receipt, options) {
  if (receipt.schemaVersion === "OwlCodaRunKitSkillUpgradeReceiptV2") {
    return sourceFromFleetBinding(receipt.fleetBinding);
  }
  const source = {
    workspaceRoots: options.workspaceRoots ?? null,
    fleetManifestPath: options.fleetManifestPath ?? null,
    fleetRoots: options.fleetRoots ?? null,
    fleetRegistryPath: options.fleetRegistryPath ?? null,
  };
  if (
    source.workspaceRoots === null
    && source.fleetManifestPath === null
    && source.fleetRoots === null
    && source.fleetRegistryPath === null
  ) {
    throw new Error("skill_rollback_current_fleet_source_required");
  }
  return source;
}

async function discoverLegacyFleetForRestore(source) {
  const discovery = await discoverFleet(source);
  if (!discovery.complete) {
    const detail = discovery.issues
      .map(issue => `${issue.code}:${issue.path}`)
      .join(",");
    throw new Error(`skill_update_fleet_discovery_incomplete:${detail}`);
  }
  return discovery;
}

function sameWorkspaceRoots(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

async function restoreCodexSkillUnlocked({
  receiptRecord,
  fleetSource,
  transactionId,
} = {}) {
  const {
    receipt,
    receiptBytes,
    legacyReceipt,
    boundReceipt,
    resolvedTarget,
    resolvedArchive,
    resolvedReceipt,
    resolvedPriorArchive,
  } = receiptRecord;
  const current = await inspectInstalledSkill({ targetRoot: resolvedTarget });
  if (!current.valid || current.manifestSha256 !== receipt.toManifestSha256) {
    throw new Error("skill_rollback_current_identity_mismatch");
  }
  const priorManaged = receipt.priorManaged !== false;
  const prior = await inspectExpectedInstallation(
    resolvedPriorArchive,
    receipt.fromManifestSha256,
    { allowUnmanaged: !priorManaged },
  ).catch(() => null);
  if (prior === null) {
    throw new Error("skill_rollback_prior_identity_mismatch");
  }
  let currentSnapshot = null;
  let currentProjects;
  if (boundReceipt) {
    currentSnapshot = await inspectFleetSnapshot(fleetSource);
    if (
      receipt.fleetBinding !== undefined
      && !sameFleetBinding(receipt.fleetBinding, currentSnapshot)
    ) {
      throw new Error("skill_rollback_fleet_identity_changed");
    }
    if (!sameWorkspaceRoots(
      currentSnapshot.discovery.workspaceRoots,
      receipt.projects.map(project => project.workspaceRoot),
    )) {
      throw new Error("skill_rollback_fleet_identity_changed");
    }
    currentProjects = currentSnapshot.projects;
  } else {
    const discovery = await discoverLegacyFleetForRestore(fleetSource);
    if (!sameWorkspaceRoots(
      discovery.workspaceRoots,
      receipt.projects.map(project => project.workspaceRoot),
    )) {
      throw new Error("skill_rollback_fleet_identity_changed");
    }
    currentProjects = await inspectLegacyProjectsForRollback(
      discovery.workspaceRoots,
    );
  }
  const journalPath = transactionJournalPath(resolvedTarget);
  let transaction = await writeTransactionJournal(journalPath, {
    schemaVersion: TRANSACTION_SCHEMA,
    transactionId,
    operation: "restore_locking",
    phase: "locking",
    targetRoot: resolvedTarget,
    archiveRoot: resolvedArchive,
    projectRoots: currentProjects.map(project => project.workspaceRoot),
    authorizationGranted: false,
  }, { exclusive: true });
  let releaseProjectLocks = null;
  try {
    releaseProjectLocks = await acquireProjectControlLocks(
      currentProjects,
      { transactionId, targetRoot: resolvedTarget },
    );
    let lockedSnapshot = null;
    let lockedProjects;
    if (boundReceipt) {
      lockedSnapshot = await inspectFleetSnapshot(fleetSource);
      if (
        (receipt.fleetBinding !== undefined
          && !sameFleetBinding(receipt.fleetBinding, lockedSnapshot))
        || !sameFleetIdentity(currentSnapshot, lockedSnapshot)
      ) {
        throw new Error("skill_rollback_fleet_identity_changed");
      }
      lockedProjects = lockedSnapshot.projects;
    } else {
      const lockedDiscovery = await discoverLegacyFleetForRestore(fleetSource);
      if (!sameWorkspaceRoots(
        lockedDiscovery.workspaceRoots,
        currentProjects.map(project => project.workspaceRoot),
      )) {
        throw new Error("skill_rollback_fleet_identity_changed");
      }
      lockedProjects = await inspectLegacyProjectsForRollback(
        lockedDiscovery.workspaceRoots,
      );
    }
    const lockedIdentityValid = boundReceipt
      ? sameProjectBindings(currentProjects, lockedProjects)
      : currentProjects.every((project, index) => (
          project.workspaceRoot === lockedProjects[index]?.workspaceRoot
          && project.configSha256 === lockedProjects[index]?.configSha256
        ));
    if (!lockedIdentityValid) {
      throw new Error("skill_rollback_project_identity_changed");
    }
    currentProjects = lockedProjects;
    const receiptProjectByRoot = new Map(
      receipt.projects.map((project) => [project.workspaceRoot, project]),
    );
    const legacyConfigRestoreBytes = [];
    for (const project of currentProjects) {
      const expected = receiptProjectByRoot.get(project.workspaceRoot);
      const legacyAfterBytes = legacyReceipt
        && typeof expected?.fromConfigBase64 === "string"
        ? Buffer.from(expected.fromConfigBase64, "base64")
        : null;
      const legacyIdentityValid = legacyReceipt
        && expected?.configPath === project.configPath
        && expected.toConfigSha256 === project.configSha256
        && legacyAfterBytes !== null
        && sha256(legacyAfterBytes) === expected.fromConfigSha256;
      const boundIdentityValid = boundReceipt
        && expected?.configPath === project.configPath
        && expected.configSha256 === project.configSha256
        && expected.postflightConfigSha256 === project.configSha256
        && expected.packageName === project.packageName
        && expected.packageVersion === project.packageVersion
        && expected.packageManager === project.packageManager
        && expected.lockfilePath === project.lockfilePath
        && expected.packageRoot === project.packageRoot
        && expected.cliPath === project.cliPath
        && expected.coreVersion === project.coreVersion
        && expected.coreManifestSha256 === project.coreManifestSha256
        && expected.adoptionPath === project.adoptionPath
        && expected.adoptionSha256 === project.adoptionSha256
        && expected.postflightAdoptionSha256 === project.adoptionSha256
        && expected.governedFilesSha256 === project.governedFilesSha256
        && expected.postflightGovernedFilesSha256
          === project.governedFilesSha256
        && JSON.stringify(expected.governedFiles)
          === JSON.stringify(project.governedFiles)
        && JSON.stringify(expected.postflightGovernedFiles)
          === JSON.stringify(project.governedFiles)
        && expected.authorizationGranted === false;
      if (!legacyIdentityValid && !boundIdentityValid) {
        throw new Error(
          `skill_rollback_project_identity_mismatch:${project.workspaceRoot}`,
        );
      }
      if (legacyIdentityValid) {
        legacyConfigRestoreBytes.push({
          configPath: project.configPath,
          beforeBytes: project.configBytes,
          afterBytes: legacyAfterBytes,
        });
      }
    }
    const legacyConfigRestores = legacyReceipt
      ? await writeLegacyConfigRestoreEvidence({
          archiveRoot: resolvedArchive,
          transactionId,
        }, legacyConfigRestoreBytes)
      : [];
    const currentArchivePath = await nextAvailablePath(
      resolvedArchive,
      `owlcoda-runkit-${current.manifestSha256.slice(7)}`,
    );
    const rollbackReceiptBody = {
      schemaVersion: legacyReceipt
        ? "OwlCodaRunKitSkillRollbackReceiptV1"
        : "OwlCodaRunKitSkillRollbackReceiptV2",
      operation: "rollback",
      sourceUpgradeReceiptPath: resolvedReceipt,
      sourceUpgradeReceiptSha256: sha256(receiptBytes),
      targetRoot: resolvedTarget,
      archiveRoot: resolvedArchive,
      fromManifestSha256: receipt.toManifestSha256,
      toManifestSha256: receipt.fromManifestSha256,
      restoredArchivePath: resolvedPriorArchive,
      replacedInstallationArchivePath: currentArchivePath,
      priorManaged,
      ...(boundReceipt && receipt.fleetBinding !== undefined
        ? { fleetBinding: receipt.fleetBinding }
        : {}),
      projects: receipt.projects.map((project) => legacyReceipt
        ? {
            workspaceRoot: project.workspaceRoot,
            restoredConfigSha256: project.fromConfigSha256,
          }
        : {
            workspaceRoot: project.workspaceRoot,
            configSha256: project.configSha256,
            adoptionSha256: project.adoptionSha256,
            governedFilesSha256: project.governedFilesSha256,
          }),
      ...(boundReceipt ? { projectMutationPerformed: false } : {}),
      authorizationGranted: false,
    };
    const rollbackReceiptBytes = boundedJsonBytes(
      rollbackReceiptBody,
      MAX_V2_SKILL_RECEIPT_BYTES,
      "skill_rollback_receipt_too_large",
    );
    const rollbackReceipt = await nextAppendOnlyReceiptPath(
      path.join(resolvedArchive, "receipts"),
      `skill-rollback-${receipt.toManifestSha256.slice(7)}-to-${receipt.fromManifestSha256.slice(7)}`,
    );
    transaction = await writeTransactionJournal(journalPath, {
      schemaVersion: TRANSACTION_SCHEMA,
      transactionId,
      operation: "restore",
      phase: "prepared",
      targetRoot: resolvedTarget,
      archiveRoot: resolvedArchive,
      fromManifestSha256: receipt.toManifestSha256,
      toManifestSha256: receipt.fromManifestSha256,
      priorArchivePath: resolvedPriorArchive,
      replacedInstallationArchivePath: currentArchivePath,
      priorManaged,
      sourceUpgradeReceiptPath: resolvedReceipt,
      sourceUpgradeReceiptSha256: `sha256:${sha256(receiptBytes)}`,
      projectRoots: currentProjects.map(project => project.workspaceRoot),
      legacyConfigRestores,
      receiptPath: rollbackReceipt,
      receiptSha256: `sha256:${sha256(rollbackReceiptBytes)}`,
      authorizationGranted: false,
    });
    await rename(resolvedTarget, currentArchivePath);
    transaction = await writeTransactionJournal(journalPath, {
      ...transaction,
      phase: "current_archived",
    });
    await rename(resolvedPriorArchive, resolvedTarget);
    transaction = await writeTransactionJournal(journalPath, {
      ...transaction,
      phase: "prior_restored",
    });
    if (legacyReceipt) {
      transaction = await writeTransactionJournal(journalPath, {
        ...transaction,
        phase: "configs_restoring",
      });
      for (const entry of legacyConfigRestores) {
        await atomicWriteBytes(
          entry.configPath,
          await transactionConfigBytes(entry, "after", transaction),
        );
      }
    }
    transaction = await writeTransactionJournal(journalPath, {
      ...transaction,
      phase: "receipt_pending",
    });
    await writeFile(rollbackReceipt, rollbackReceiptBytes, { flag: "wx" });
    transaction = await writeTransactionJournal(journalPath, {
      ...transaction,
      phase: "committed",
    });
    await releaseProjectLocks();
    releaseProjectLocks = null;
    await rm(transactionEvidenceRoot(transaction), {
      recursive: true,
      force: true,
    });
    await rm(journalPath, { force: true });
    transaction = null;
    return {
      status: "restored",
      manifestSha256: receipt.fromManifestSha256,
      rollbackReceipt,
      replacedInstallation: {
        manifestSha256: receipt.toManifestSha256,
        archivePath: currentArchivePath,
      },
      projectMutationPerformed: legacyReceipt,
      authorizationGranted: false,
    };
  } catch (error) {
    if (transaction !== null || await exists(journalPath)) {
      try {
        await recoverInterruptedCodexSkillTransaction({
          targetRoot: resolvedTarget,
          archiveRoot: resolvedArchive,
        });
        transaction = null;
      } catch (recoveryError) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; `
          + `skill_update_transaction_recovery_failed:${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
        );
      }
    }
    throw error;
  } finally {
    if (releaseProjectLocks !== null) await releaseProjectLocks();
  }
}

export async function restoreCodexSkill(options = {}) {
  const { targetRoot, archiveRoot, upgradeReceiptPath } = options;
  if (typeof targetRoot !== "string" || typeof archiveRoot !== "string") {
    throw new Error("targetRoot and archiveRoot are required");
  }
  const resolvedTarget = path.resolve(targetRoot);
  await mkdir(path.dirname(resolvedTarget), { recursive: true });
  const transactionId = randomUUID();
  const releaseSkillLock = await acquireOwnedDirectoryLock(
    `${resolvedTarget}.lock`,
    {
      activeCode: "skill_update_shared_skill_transaction_active",
      transactionId,
      targetRoot: resolvedTarget,
      recoverStale: true,
    },
  );
  let releaseRegistryLock = null;
  try {
    const receiptRecord = await readUpgradeReceiptForRestore({
      targetRoot,
      archiveRoot,
      upgradeReceiptPath,
    });
    const fleetSource = restoreFleetSource(receiptRecord.receipt, options);
    releaseRegistryLock = await acquireFleetRegistryTransactionLock(fleetSource, {
      transactionId,
      targetRoot: resolvedTarget,
    });
    const recovered = await recoverInterruptedCodexSkillTransaction({
      targetRoot: resolvedTarget,
      archiveRoot,
    });
    if (
      recovered.status === "recovered_committed_transaction"
      && recovered.operation === "restore"
    ) {
      return {
        status: "restored",
        manifestSha256: recovered.manifestSha256,
        rollbackReceipt: recovered.rollbackReceipt,
        replacedInstallation: recovered.replacedInstallation,
        projectMutationPerformed: recovered.projectMutationPerformed,
        recoveredTransaction: true,
        authorizationGranted: false,
      };
    }
    return await restoreCodexSkillUnlocked({
      receiptRecord,
      fleetSource,
      transactionId,
    });
  } finally {
    if (releaseRegistryLock !== null) await releaseRegistryLock();
    await releaseSkillLock();
  }
}

export async function recoverCodexSkillForActiveFleet({
  targetRoot,
  archiveRoot,
  archivedInstallationPath,
  workspaceRoots = null,
  fleetManifestPath = null,
  fleetRoots = null,
} = {}) {
  if (
    typeof targetRoot !== "string"
    || typeof archiveRoot !== "string"
    || typeof archivedInstallationPath !== "string"
    || (
      (!Array.isArray(workspaceRoots) || workspaceRoots.length === 0)
      && (typeof fleetManifestPath !== "string" || fleetManifestPath.length === 0)
      && (!Array.isArray(fleetRoots) || fleetRoots.length === 0)
    )
  ) {
    throw new Error(
      "targetRoot, archiveRoot, archivedInstallationPath, and a fleet source are required",
    );
  }
  const resolvedTarget = path.resolve(targetRoot);
  const resolvedArchive = path.resolve(archiveRoot);
  const resolvedPrior = path.resolve(archivedInstallationPath);
  const priorRelative = path.relative(resolvedArchive, resolvedPrior);
  if (
    priorRelative.startsWith("..")
    || path.isAbsolute(priorRelative)
    || priorRelative.length === 0
  ) {
    throw new Error("skill_recovery_archive_outside_root");
  }
  const current = await inspectInstalledSkill({ targetRoot: resolvedTarget });
  const prior = await inspectInstalledSkill({ targetRoot: resolvedPrior });
  if (!current.valid || !prior.valid) {
    throw new Error("skill_recovery_installation_identity_invalid");
  }
  const archivedCoreModule = await import(pathToFileURL(path.join(
    resolvedPrior,
    "scripts/runkit-contract/core-contract.mjs",
  )).href);
  const archivedCore = archivedCoreModule.currentCoreIdentity?.();
  if (!archivedCore || typeof archivedCore.coreManifestSha256 !== "string") {
    throw new Error("skill_recovery_archived_core_identity_missing");
  }
  const discovery = await discoverFleet({
    workspaceRoots,
    fleetManifestPath,
    fleetRoots,
  });
  if (!discovery.complete) {
    throw new Error(
      `skill_recovery_fleet_discovery_incomplete:${discovery.unreachableRoots.join(",")}`,
    );
  }
  const projects = [];
  let activeRunCount = 0;
  for (const workspaceRoot of discovery.workspaceRoots) {
    const configPath = path.join(
      workspaceRoot,
      ".owlcoda/runkit/config.json",
    );
    const configBytes = await readFile(configPath);
    const config = JSON.parse(configBytes.toString("utf8"));
    if (!sameCoreIdentity(config.core, archivedCore)) {
      throw new Error(
        `skill_recovery_config_core_mismatch:${workspaceRoot}`,
      );
    }
    const safety = inspectProjectControlState({
      workspaceRoot,
      currentCore: archivedCore,
    }).upgradeSafety;
    if (safety.issues.length > 0) {
      throw new Error(
        `skill_recovery_control_state_invalid:${workspaceRoot}:${safety.issues.join(",")}`,
      );
    }
    const activeRunSet = new Set(safety.activeRunIds);
    if (safety.activeLeaseIds.some((leaseId) => (
      !activeRunSet.has(leaseId.split(":", 1)[0])
    ))) {
      throw new Error(
        `skill_recovery_lease_without_matching_active_run:${workspaceRoot}`,
      );
    }
    for (const runId of safety.activeRunIds) {
      const enginePinPath = path.join(
        workspaceRoot,
        ".owlcoda/runkit/executions",
        runId,
        "engine-pin.json",
      );
      const pinStat = await lstat(enginePinPath);
      if (pinStat.isSymbolicLink() || !pinStat.isFile()) {
        throw new Error(
          `skill_recovery_engine_pin_invalid:${workspaceRoot}:${runId}`,
        );
      }
      const enginePin = JSON.parse(await readFile(enginePinPath, "utf8"));
      if (!sameCoreIdentity(enginePin, archivedCore)) {
        throw new Error(
          `skill_recovery_active_pin_mismatch:${workspaceRoot}:${runId}`,
        );
      }
      activeRunCount += 1;
    }
    projects.push({
      workspaceRoot,
      configSha256: sha256(configBytes),
      activeRunIds: safety.activeRunIds,
      activeLeaseIds: safety.activeLeaseIds,
    });
  }
  if (activeRunCount === 0) {
    throw new Error("skill_recovery_active_execution_required");
  }
  const replacedInstallationArchivePath = await nextAvailablePath(
    resolvedArchive,
    `owlcoda-runkit-replaced-${current.manifestSha256.slice(7)}`,
  );
  await rename(resolvedTarget, replacedInstallationArchivePath);
  try {
    await rename(resolvedPrior, resolvedTarget);
    const recoveryReceipt = await writeAppendOnlyReceipt(
      path.join(resolvedArchive, "receipts"),
      `skill-active-recovery-${current.manifestSha256.slice(7)}-to-${prior.manifestSha256.slice(7)}`,
      {
        schemaVersion: "OwlCodaRunKitSkillActiveRecoveryReceiptV1",
        operation: "active_execution_recovery",
        targetRoot: resolvedTarget,
        archiveRoot: resolvedArchive,
        fromManifestSha256: current.manifestSha256,
        toManifestSha256: prior.manifestSha256,
        restoredCore: archivedCore,
        restoredArchivePath: resolvedPrior,
        replacedInstallationArchivePath,
        projects,
        authorizationGranted: false,
      },
    );
    return {
      status: "recovered_active_fleet",
      manifestSha256: prior.manifestSha256,
      core: archivedCore,
      recoveryReceipt,
      replacedInstallationArchivePath,
      authorizationGranted: false,
    };
  } catch (error) {
    if (await exists(resolvedTarget)) {
      await rename(resolvedTarget, resolvedPrior);
    }
    await rename(replacedInstallationArchivePath, resolvedTarget);
    throw error;
  }
}

function parseOptions(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error("Options must be --name value pairs");
    const name = flag.slice(2);
    if (name === "workspace" || name === "fleet-root") {
      options[name] ??= [];
      options[name].push(value);
    } else {
      options[name] = value;
    }
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  try {
    const [command, ...rest] = argv;
    const options = parseOptions(rest);
    if (command === "install") {
      const output = await installCodexSkill({
        repositoryRoot: options.repository,
        targetRoot: options.target,
        archiveRoot: options.archive,
        expectedUnmanagedManifestSha256: options["expected-unmanaged"] ?? null,
        workspaceRoots: options.workspace ?? null,
        fleetManifestPath: options["fleet-manifest"] ?? null,
        fleetRoots: options["fleet-root"] ?? null,
        fleetRegistryPath: options.registry ?? null,
      });
      return { exitCode: 0, ...output };
    }
    if (command === "inspect") {
      const output = await inspectInstalledSkillCompatibility({ targetRoot: options.target });
      return { exitCode: output.valid ? 0 : 2, ...output };
    }
    if (command === "restore") {
      const output = await restoreCodexSkill({
        targetRoot: options.target,
        archiveRoot: options.archive,
        upgradeReceiptPath: options.receipt,
        workspaceRoots: options.workspace ?? null,
        fleetManifestPath: options["fleet-manifest"] ?? null,
        fleetRoots: options["fleet-root"] ?? null,
        fleetRegistryPath: options.registry ?? null,
      });
      return { exitCode: 0, ...output };
    }
    if (command === "recover-active") {
      const output = await recoverCodexSkillForActiveFleet({
        targetRoot: options.target,
        archiveRoot: options.archive,
        archivedInstallationPath: options["archived-installation"],
        workspaceRoots: options.workspace ?? null,
        fleetManifestPath: options["fleet-manifest"] ?? null,
        fleetRoots: options["fleet-root"] ?? null,
      });
      return { exitCode: 0, ...output };
    }
    throw new Error(
      "Usage: install-codex-skill.mjs <install|inspect|restore|recover-active> [options]",
    );
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    if (issue.startsWith("skill_update_blocked_active_execution:")) {
      return {
        status: "skill_update_blocked_active_execution",
        exitCode: 2,
        issues: [issue],
      };
    }
    return { status: "invalid_input", exitCode: 3, issues: [error instanceof Error ? error.message : String(error)] };
  }
}

if (isDirectExecution(import.meta.url)) {
  const result = await runCli();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}
