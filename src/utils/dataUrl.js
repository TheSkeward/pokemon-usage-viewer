// Builds a URL into the static /data tree, honouring Vite's BASE_URL so the
// same code works on the dev server and under the GitHub Pages base path.

export function dataUrl(path) {
  const base = import.meta.env.BASE_URL || "/";
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleanPath = String(path).replace(/^\/+/, "");
  return `${cleanBase}/data/${cleanPath}`;
}
