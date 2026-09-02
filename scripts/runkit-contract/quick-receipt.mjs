import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { persistEvidenceBytes } from "./evidence-store.mjs";
import { sha256Bytes } from "./quick-canonical.mjs";

const QUICK_ROOT = ".owlcoda/runkit/quick";
const OUTPUT_SUMMARY_BYTES = 16 * 1024;
const OUTPUT_SUMMARY_LINES = 3;

function withinRoot(root, candidate) {
  const remainder = path.relative(root, candidate);
  return remainder !== ""
    && !remainder.startsWith(`..${path.sep}`)
    && remainder !== ".."
    && !path.isAbsolute(remainder);
}

function ensureDirectoryChain(workspaceRoot, relativeDirectory) {
  const root = realpathSync(workspaceRoot);
  let current = root;
  for (const segment of relativeDirectory.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Quick receipt store component must be a real directory: ${current}`);
    }
    const resolved = realpathSync(current);
    if (!withinRoot(root, resolved)) {
      throw new Error(`Quick receipt store escapes the workspace: ${current}`);
    }
  }
  return current;
}

function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  renameSync(temporary, filePath);
}

export function createQuickReceiptStore(workspaceRoot, receiptId = `quick-${Date.now()}-${randomUUID()}`) {
  if (!/^[a-zA-Z0-9._-]+$/.test(receiptId)) throw new Error("receiptId is unsafe");
  const receiptRoot = ensureDirectoryChain(workspaceRoot, `${QUICK_ROOT}/receipts/${receiptId}`);
  const stdoutPath = path.join(receiptRoot, "stdout.log");
  const stderrPath = path.join(receiptRoot, "stderr.log");
  const stdoutFd = openSync(stdoutPath, "wx", 0o600);
  const stderrFd = openSync(stderrPath, "wx", 0o600);
  const rootStat = lstatSync(receiptRoot);
  const stdoutStat = fstatSync(stdoutFd);
  const stderrStat = fstatSync(stderrFd);
  return {
    receiptId,
    receiptRoot,
    receiptPath: path.join(receiptRoot, "receipt.json"),
    stdoutPath,
    stderrPath,
    stdoutFd,
    stderrFd,
    receiptRootIdentity: {
      dev: rootStat.dev,
      ino: rootStat.ino,
    },
    stdoutIdentity: {
      dev: stdoutStat.dev,
      ino: stdoutStat.ino,
    },
    stderrIdentity: {
      dev: stderrStat.dev,
      ino: stderrStat.ino,
    },
  };
}

export function closeQuickOutputFiles(store) {
  closeSync(store.stdoutFd);
  closeSync(store.stderrFd);
}

function cleanOutputLine(line) {
  const withoutAnsi = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "");
  return [...withoutAnsi]
    .filter((character) => character === "\t" || character.codePointAt(0) >= 32)
    .join("")
    .trim();
}

function cleanOutputLines(text) {
  return text
    .split(/\r?\n/u)
    .map(cleanOutputLine)
    .filter(Boolean);
}

function summarizeOutputBytes(bytes) {
  if (bytes.byteLength <= OUTPUT_SUMMARY_BYTES) {
    const lines = cleanOutputLines(bytes.toString("utf8"));
    return {
      headLines: lines.slice(0, OUTPUT_SUMMARY_LINES),
      tailLines: lines.slice(-OUTPUT_SUMMARY_LINES),
      truncated: lines.length > OUTPUT_SUMMARY_LINES * 2,
    };
  }

  const windowBytes = Math.floor(OUTPUT_SUMMARY_BYTES / 2);
  let headText = bytes.subarray(0, windowBytes).toString("utf8");
  const lastHeadBreak = headText.lastIndexOf("\n");
  if (lastHeadBreak >= 0) headText = headText.slice(0, lastHeadBreak + 1);

  let tailText = bytes.subarray(bytes.byteLength - windowBytes).toString("utf8");
  const firstTailBreak = tailText.indexOf("\n");
  if (firstTailBreak >= 0) tailText = tailText.slice(firstTailBreak + 1);

  return {
    headLines: cleanOutputLines(headText).slice(0, OUTPUT_SUMMARY_LINES),
    tailLines: cleanOutputLines(tailText).slice(-OUTPUT_SUMMARY_LINES),
    truncated: true,
  };
}

function outputArtifact(workspaceRoot, filePath) {
  const bytes = readFileSync(filePath);
  const evidence = persistEvidenceBytes({ workspaceRoot, bytes });
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Quick output material is not a regular file: ${filePath}`);
  }
  const replacement = `${filePath}.cas-${process.pid}-${randomUUID()}`;
  try {
    copyFileSync(evidence.absolutePath, replacement, constants.COPYFILE_FICLONE);
    chmodSync(replacement, 0o600);
    renameSync(replacement, filePath);
  } finally {
    rmSync(replacement, { force: true });
  }
  return {
    artifact: {
      path: path.relative(realpathSync(workspaceRoot), filePath).split(path.sep).join("/"),
      sha256: evidence.sha256,
      sizeBytes: bytes.byteLength,
    },
    summary: summarizeOutputBytes(bytes),
    evidence,
  };
}

function assertStorePath(root, filePath, expectedIdentity, expectedType) {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || (expectedType === "file" ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`Quick receipt store ${expectedType} is not trusted: ${filePath}`);
  }
  if (stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino) {
    throw new Error(`Quick receipt store ${expectedType} identity changed: ${filePath}`);
  }
  const resolved = realpathSync(filePath);
  if (!withinRoot(root, resolved)) {
    throw new Error(`Quick receipt store ${expectedType} escapes the workspace: ${filePath}`);
  }
}

function validateQuickReceiptStore(workspaceRoot, store) {
  const root = realpathSync(workspaceRoot);
  assertStorePath(root, store.receiptRoot, store.receiptRootIdentity, "directory");
  assertStorePath(root, store.stdoutPath, store.stdoutIdentity, "file");
  assertStorePath(root, store.stderrPath, store.stderrIdentity, "file");
  if (store.stdinPath !== undefined) {
    assertStorePath(root, store.stdinPath, store.stdinIdentity, "file");
    const bytes = readFileSync(store.stdinPath);
    if (
      bytes.byteLength !== store.stdinArtifact.sizeBytes
      || sha256Bytes(bytes) !== store.stdinArtifact.sha256
    ) {
      throw new Error(`Quick receipt store stdin material changed: ${store.stdinPath}`);
    }
  }
}

export function persistQuickInputArtifact({ workspaceRoot, store, bytes }) {
  if (!Buffer.isBuffer(bytes)) throw new Error("Quick stdin material must be bytes.");
  validateQuickReceiptStore(workspaceRoot, store);
  const stdinPath = path.join(store.receiptRoot, "stdin.bin");
  writeFileSync(stdinPath, bytes, { flag: "wx", mode: 0o600 });
  const stat = lstatSync(stdinPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Quick receipt store stdin material is not trusted: ${stdinPath}`);
  }
  const root = realpathSync(workspaceRoot);
  const resolved = realpathSync(stdinPath);
  if (!withinRoot(root, resolved)) {
    throw new Error(`Quick receipt store stdin material escapes the workspace: ${stdinPath}`);
  }
  store.stdinPath = stdinPath;
  store.stdinIdentity = { dev: stat.dev, ino: stat.ino };
  store.stdinArtifact = {
    path: path.relative(root, resolved).split(path.sep).join("/"),
    sha256: sha256Bytes(bytes),
    sizeBytes: bytes.byteLength,
  };
  return {
    artifact: store.stdinArtifact,
    inputPath: stdinPath,
  };
}

export function persistQuickReceipt({ workspaceRoot, store, receipt }) {
  validateQuickReceiptStore(workspaceRoot, store);
  const receiptStdin = receipt.inputArtifacts?.stdin;
  if (
    (store.stdinArtifact === undefined) !== (receiptStdin === undefined)
    || store.stdinArtifact !== undefined
      && (
        receiptStdin.path !== store.stdinArtifact.path
        || receiptStdin.sha256 !== store.stdinArtifact.sha256
        || receiptStdin.sizeBytes !== store.stdinArtifact.sizeBytes
      )
  ) {
    throw new Error("Quick receipt stdin binding does not match the persisted material.");
  }
  const stdout = outputArtifact(workspaceRoot, store.stdoutPath);
  const stderr = outputArtifact(workspaceRoot, store.stderrPath);
  const complete = {
    ...receipt,
    outputArtifacts: {
      stdout: stdout.artifact,
      stderr: stderr.artifact,
    },
  };
  atomicWriteJson(store.receiptPath, complete);
  const evidenceRows = [stdout.evidence, stderr.evidence];
  return {
    receipt: complete,
    receiptPath: store.receiptPath,
    receiptSha256: sha256Bytes(readFileSync(store.receiptPath)),
    outputSummary: {
      stdoutHead: stdout.summary.headLines,
      stdoutTail: stdout.summary.tailLines,
      stderrHead: stderr.summary.headLines,
      stderrTail: stderr.summary.tailLines,
      stdoutTruncated: stdout.summary.truncated,
      stderrTruncated: stderr.summary.truncated,
    },
    evidenceStorage: {
      mode: "content_addressed_sha256",
      objectPaths: [...new Set(evidenceRows.map(row => row.path))].sort(),
      uniqueBytes: evidenceRows
        .filter(row => row.created)
        .reduce((total, row) => total + row.sizeBytes, 0),
      reusedBytes: evidenceRows
        .filter(row => !row.created)
        .reduce((total, row) => total + row.sizeBytes, 0),
    },
  };
}

export function quickReceiptRoot(workspaceRoot) {
  return path.join(realpathSync(workspaceRoot), ...QUICK_ROOT.split("/"), "receipts");
}
