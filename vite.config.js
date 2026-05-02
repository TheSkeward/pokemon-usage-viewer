import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

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
  plugins: [localDataMiddleware()],
});
