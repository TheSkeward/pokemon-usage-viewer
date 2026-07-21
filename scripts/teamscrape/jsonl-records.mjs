/**
 * @fileoverview Append-only JSONL helpers with latest-record semantics. A
 * source post can be edited without changing its stable id; appending the
 * revision keeps writes interruption-safe, while readers count only the last
 * complete occurrence.
 */
import fs from 'node:fs';

/** @return {!Map<string, !Object>} Latest complete record for each id. */
export function readJsonlLatest(file) {
  const latest = new Map();
  if (!fs.existsSync(file)) return latest;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.id != null) latest.set(String(record.id), record);
    } catch {
      // An interrupted append can tear only the final record.
    }
  }
  return latest;
}

/**
 * Append a new or revised record. Exact repeats are no-ops.
 * @return {boolean} Whether the file changed.
 */
export function appendJsonlRecord(file, record, latest) {
  const id = String(record.id);
  const serialized = JSON.stringify(record);
  const previous = latest.get(id);
  if (previous && JSON.stringify(previous) === serialized) return false;
  fs.appendFileSync(file, `${serialized}\n`);
  latest.set(id, record);
  return true;
}
