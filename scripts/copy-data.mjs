import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, 'site-data', 'data');
const targetDir = path.join(projectRoot, 'dist', 'data');

try {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
  console.log(`copied ${sourceDir} -> ${targetDir}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
