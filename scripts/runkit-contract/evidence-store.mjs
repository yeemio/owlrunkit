import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const EVIDENCE_ROOT = ".owlcoda/runkit/evidence";
const STORAGE_DIRECTORIES = Object.freeze({
  raw: "raw-sha256",
  base64_json: "encoded-sha256",
});

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function ensureDirectoryChain(workspaceRoot, relativeDirectory) {
  const root = realpathSync(workspaceRoot);
  let current = root;
  for (const segment of relativeDirectory.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      try {
        mkdirSync(current);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Evidence store component must be a real directory: ${current}`);
    }
    const resolved = realpathSync(current);
    if (!withinRoot(root, resolved)) {
      throw new Error(`Evidence store component escapes the workspace: ${current}`);
    }
  }
  return { root, directory: current };
}

function storedBytes(bytes, encoding) {
  if (encoding === "raw") return bytes;
  return Buffer.from(`${JSON.stringify({ encoding: "base64", data: bytes.toString("base64") })}\n`);
}

function verifyExistingObject({ root, objectPath, expectedBytes }) {
  const stat = lstatSync(objectPath);
  if (stat.isSymbolicLink() || !stat.isFile() || !withinRoot(root, realpathSync(objectPath))) {
    throw new Error("Evidence object must be a regular in-workspace file.");
  }
  const descriptor = openSync(objectPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size !== expectedBytes.byteLength) {
      throw new Error("Evidence object byte conflict for an existing SHA-256 path.");
    }
    const actual = Buffer.allocUnsafe(expectedBytes.byteLength + 1);
    let offset = 0;
    while (offset < actual.byteLength) {
      const bytesRead = readSync(descriptor, actual, offset, actual.byteLength - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== expectedBytes.byteLength || !actual.subarray(0, offset).equals(expectedBytes)) {
      throw new Error("Evidence object byte conflict for an existing SHA-256 path.");
    }
  } finally {
    closeSync(descriptor);
  }
}

export function persistEvidenceBytes({ workspaceRoot, bytes, encoding = "raw" }) {
  if (!Buffer.isBuffer(bytes)) throw new Error("Evidence object requires bytes.");
  const storageDirectory = STORAGE_DIRECTORIES[encoding];
  if (storageDirectory === undefined) throw new Error("Evidence object encoding is unsupported.");
  const { root, directory } = ensureDirectoryChain(
    workspaceRoot,
    `${EVIDENCE_ROOT}/${storageDirectory}`,
  );
  const digest = sha256Hex(bytes);
  const objectPath = path.join(directory, digest);
  const expectedBytes = storedBytes(bytes, encoding);
  let created = false;
  if (!existsSync(objectPath)) {
    const temporaryPath = path.join(directory, `.tmp-${process.pid}-${randomUUID()}`);
    try {
      writeFileSync(temporaryPath, expectedBytes, { flag: "wx", mode: 0o400 });
      chmodSync(temporaryPath, 0o400);
      try {
        linkSync(temporaryPath, objectPath);
        created = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
  verifyExistingObject({ root, objectPath, expectedBytes });
  return {
    schemaVersion: "OwlCodaRunKitEvidenceObjectRefV1",
    storage: `create_only_${encoding}_sha256`,
    path: path.relative(root, objectPath).split(path.sep).join("/"),
    absolutePath: objectPath,
    sha256: `sha256:${digest}`,
    digest,
    sizeBytes: bytes.byteLength,
    created,
  };
}
