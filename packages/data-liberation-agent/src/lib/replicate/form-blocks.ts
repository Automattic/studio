/**
 * Serialize block comment attrs exactly like @wordpress/blocks
 * `serializeAttributes`: JSON with the characters that could terminate the
 * comment delimiter (or smuggle markup) unicode-escaped. Keeps a crafted
 * source value (e.g. containing `-->`) from breaking out of the comment.
 * Exported for variation-hoist, which rewrites existing comment attrs and must
 * not lose this escaping (JSON.parse decodes `--` to literal `--`).
 */
export function serializeBlockAttrs(attrs: Record<string, unknown>): string {
  return JSON.stringify(attrs)
    .replace(/--/g, '\\u002d\\u002d')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\"/g, '\\u0022');
}
