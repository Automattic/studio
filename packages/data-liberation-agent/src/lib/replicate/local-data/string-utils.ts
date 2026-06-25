// src/lib/replicate/local-data/string-utils.ts
//
// Small shared string helpers for the local-data PHP/JS code generators and the
// anchor-driven markup rewriters. Kept in one place so the PHP-literal escaping,
// RegExp escaping, and `#id` selector parsing have a single definition.

/** PHP single-quoted string literal with ' and \ escaped. */
export function phpLiteral(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Escape a string for use as a literal inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The id half of a `#foo` selector, or null for non-id selectors. */
export function anchorId(selector: string): string | null {
  const m = /^#([\w-]+)$/.exec(selector.trim());
  return m ? m[1] : null;
}
