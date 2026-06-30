// src/lib/html-escape.ts
//
// The single home for HTML entity escaping. Three escalating variants — pick by
// CONTEXT, not by convenience:
//   escapeHtmlText  &<>      — text-node content (no attributes)
//   escapeHtmlAttr  &<>"     — text + double-quoted attribute values
//   escapeHtml      &<>"'    — full set, safe in any HTML context
//
// Each builds on the previous, so the entity set is defined once. The apostrophe
// is emitted as &#039; (numeric) to match the long-standing reconstruct output.

/** Escape &, <, > — the minimal set for HTML text-node content. */
export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape &, <, >, " — text plus double-quoted attribute values. */
export function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, '&quot;');
}

/** Escape &, <, >, ", ' — the full set, safe in any HTML context. */
export function escapeHtml(s: string): string {
  return escapeHtmlAttr(s).replace(/'/g, '&#039;');
}
