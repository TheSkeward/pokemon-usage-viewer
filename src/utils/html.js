export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Attribute values need the same escaping as text content; kept as a named
// alias so call sites read clearly at the point of use.
export const escapeAttr = escapeHtml;
