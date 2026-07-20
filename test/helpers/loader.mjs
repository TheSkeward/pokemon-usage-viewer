// Node module-loader hooks so the real app modules run under node --test:
// appends `.js` to extensionless relative imports (Vite resolves these; plain
// Node doesn't) and rewrites `import.meta.env` to a global the harness sets.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (/^[./]/.test(specifier) && !/\.(m?js|cjs|json)$/.test(specifier)) {
    try {
      const candidate = new URL(specifier + '.js', context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        const resolved = await next(specifier + '.js', context);
        return { ...resolved, shortCircuit: true };
      }
    } catch {
      /* fall through to the default resolver */
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.js')) {
    const result = await next(url, context);
    const source = result.source?.toString() ?? '';
    if (source.includes('import.meta.env')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: source.replace(/import\.meta\.env\b/g, '(globalThis.__ENV__)'),
      };
    }
    return result;
  }
  return next(url, context);
}
