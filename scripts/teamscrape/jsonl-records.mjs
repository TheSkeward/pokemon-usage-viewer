/**
 * @fileoverview Append-only JSONL helpers with latest-record semantics. A
 * source post can be edited without changing its stable id; appending the
 * revision keeps writes interruption-safe, while readers count only the last
 * complete occurrence.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} file
 * @return {!Map<string, !Object>} Latest complete record for each id.
 */
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
 * @param {string} file
 * @param {!Object} record
 * @param {!Map<string, !Object>} latest
 * @return {boolean} Whether the file changed.
 */
export function appendJsonlRecord(file, record, latest) {
  const id = String(record.id);
  const serialized = JSON.stringify(record);
  const previous = latest.get(id);
  if (previous && JSON.stringify(previous) === serialized) return false;
  // A kill mid-append can leave the file without a trailing newline; an
  // unguarded append would weld this record onto the torn tail, producing
  // one unparsable line that drops BOTH records for every future reader.
  let prefix = '';
  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    if (stat.size > 0) {
      const tail = Buffer.alloc(1);
      const fd = fs.openSync(file, 'r');
      fs.readSync(fd, tail, 0, 1, stat.size - 1);
      fs.closeSync(fd);
      if (tail.toString() !== '\n') prefix = '\n';
    }
  }
  fs.appendFileSync(file, `${prefix}${serialized}\n`);
  latest.set(id, record);
  return true;
}

/**
 * Per-format archive files under one filename prefix
 * (`<prefix><formatId>.jsonl`), each opened lazily with its latest-record
 * map on first use.
 * @param {string} archiveDir Directory holding the archive files.
 * @param {string} prefix Filename prefix, e.g. 'forum-'.
 * @return {{
 *   forFormat: function(string):
 *       {file: string, latest: !Map<string, !Object>},
 *   entries: function():
 *       !IterableIterator<!Array<string|{file: string, latest: !Map}>>,
 * }} forFormat opens (or reuses) a format's archive; entries iterates the
 *     archives opened so far.
 */
export function createFormatArchives(archiveDir, prefix) {
  const byFormat = new Map();
  return {
    forFormat(formatId) {
      if (!byFormat.has(formatId)) {
        const file = path.join(archiveDir, `${prefix}${formatId}.jsonl`);
        byFormat.set(formatId, { file, latest: readJsonlLatest(file) });
      }
      return byFormat.get(formatId);
    },
    entries: () => byFormat.entries(),
  };
}
