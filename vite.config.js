import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

// A per-deploy id so the running app can detect when a newer build is live (see
// src/updateNotifier.js). The commit SHA changes every deploy — including the
// daily data-refresh commit — and is stable across rebuilds of the same commit.
// Falls back to a timestamp when git isn't available.
function resolveBuildId() {
  // Prefer the checked-out HEAD over GITHUB_SHA: the daily data-refresh job
  // commits new data before building, so HEAD reflects what's actually deployed
  // while GITHUB_SHA would still point at the pre-refresh tip.
  try {
    return execSync('git rev-parse --short=12 HEAD').toString().trim();
  } catch {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
    return String(Date.now());
  }
}

const BUILD_ID = resolveBuildId();

// Emits version.json alongside the build so the deployed id is fetchable without
// parsing the bundle. Not emitted by the dev server (no build step), where the
// notifier stays dormant.
function emitVersionJson(buildId) {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId }),
      });
    },
  };
}

function localDataMiddleware() {
  return {
    name: 'local-data-middleware',
    configureServer(server) {
      const dataRoot = path.resolve(process.cwd(), 'site-data', 'data');

      server.middlewares.use('/data', async (req, res, next) => {
        try {
          const requestPath = decodeURIComponent(req.url || '/');
          const relativePath = requestPath.replace(/^\/+/, '');
          const filePath = path.resolve(dataRoot, relativePath);

          if (!filePath.startsWith(dataRoot)) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
          }

          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile()) {
            next();
            return;
          }

          if (filePath.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }

          fs.createReadStream(filePath).pipe(res);
        } catch (error) {
          if (error.code === 'ENOENT') {
            next();
            return;
          }
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/pokemon-usage-viewer/' : '/',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [localDataMiddleware(), emitVersionJson(BUILD_ID)],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(process.cwd(), 'index.html'),
        pool: path.resolve(process.cwd(), 'pool.html'),
      },
    },
  },
});
