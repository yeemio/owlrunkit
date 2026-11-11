import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export function linuxRuntimeHelper() {
  if (process.platform !== "linux" || !["arm64", "x64"].includes(process.arch)) return null;
  const executable = path.join(import.meta.dirname, `peer-linux-${process.arch}`);
  try {
    if (realpathSync(executable) === executable && lstatSync(executable).isFile()) return executable;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}
