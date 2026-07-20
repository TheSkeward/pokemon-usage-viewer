import fs from "node:fs/promises";
import path from "node:path";

/** @return {!Promise<*>} */
export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

/** @return {!Promise<*>} Parsed JSON, or null when the file does not exist. */
export async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** Writes JSON atomically (tmp file + rename), creating parent directories. */
export async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(data)}\n`);
  await fs.rename(`${filePath}.tmp`, filePath);
}
