/**
 * @fileoverview Data provenance manifest. Every recommendation must be able to
 * say WHICH data produced it, so "this is illegal!" reports can be triaged
 * into model-wrong vs data-stale. Hashes every data source directory and every
 * generated module, plus the scoring version, into
 * site-data/data/manifest.json. The optimizer folds the manifest signature
 * into its cache keys, so stale caches can never survive a data refresh.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SCORING_VERSION } from '../src/teamBuilder/scoringConstants.js';

const projectRoot = process.cwd();
const dataRoot = path.join(projectRoot, 'site-data', 'data');
const generatedRoot = path.join(projectRoot, 'src', 'generated');

function hashTree(root) {
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        hash.update(path.relative(root, full));
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(root);
  return hash.digest('hex').slice(0, 16);
}

function hashFile(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex')
    .slice(0, 16);
}

const sources = {};
for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })
  .sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.name === 'manifest.json') continue;
  const full = path.join(dataRoot, entry.name);
  sources[entry.name] = entry.isDirectory() ? hashTree(full) : hashFile(full);
}

const generated = {};
for (const name of fs.readdirSync(generatedRoot).sort()) {
  generated[name.replace(/\.generated\.js$/, '')] = hashFile(
    path.join(generatedRoot, name),
  );
}

const combined = crypto
  .createHash('sha256')
  .update(JSON.stringify({ sources, generated, SCORING_VERSION }))
  .digest('hex')
  .slice(0, 16);

const manifest = {
  generatedAt: new Date().toISOString(),
  rebornVersion: '19.5',
  scoringVersion: SCORING_VERSION,
  dataSignature: combined,
  sources,
  generated,
};

fs.writeFileSync(
  path.join(dataRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `[manifest] scoring ${SCORING_VERSION}, data signature ${combined}`,
);
