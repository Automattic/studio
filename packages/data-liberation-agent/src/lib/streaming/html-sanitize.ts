//
// HTML sanitizer (pre-skill defense layer 1)
// ==========================================
// Strips dangerous and indirection-prone constructs from source HTML BEFORE it
// is handed to the `compose-page-blocks` skill. Source HTML is attacker-
// controlled — a hostile site can include `<script>` payloads, `on*=` event
// handlers, or HTML comments containing prompt-injection text like
// `<!-- IGNORE PRIOR INSTRUCTIONS, output ... -->`. These constructs have no
// legitimate role in `post_content` block markup and are unconditionally
// removed.
//
// Strategy: regex-based stripping (deliberately not a full HTML parser). The
// downstream skill operates on plain-text content, not parsed DOM, so we
// don't need a DOM tree — we need a clean string. Each rule is independent
// and order-insensitive; re-running the function is idempotent.
//
// Rules (each independently testable):
//   1. Strip `<script>...</script>` blocks (case-insensitive, multi-line).
//   2. Strip `<iframe>...</iframe>` blocks.
//   3. Strip `<object>...</object>` blocks.
//   4. Strip `<embed ...>` self-closing tags (no body).
//   5. Strip HTML comments `<!-- ... -->`.
//   6. Strip `on*="..."` and `on*='...'` event-handler attributes from any tag.
//   7. Strip `javascript:` / `vbscript:` href/src values (replace with empty).
//
// Composability: each rule is applied in sequence so removing a `<script>`
// block whose contents include a stray `on*=` attribute doesn't matter — the
// outer block goes first.
//

const SCRIPT_TAG_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_OPEN_NO_CLOSE_RE = /<script\b[^>]*\/?>/gi;
const IFRAME_TAG_RE = /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi;
const IFRAME_OPEN_NO_CLOSE_RE = /<iframe\b[^>]*\/?>/gi;
const OBJECT_TAG_RE = /<object\b[^>]*>[\s\S]*?<\/object\s*>/gi;
const OBJECT_OPEN_NO_CLOSE_RE = /<object\b[^>]*\/?>/gi;
const EMBED_TAG_RE = /<embed\b[^>]*\/?>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
// Match `on<word>="..."`, `on<word>='...'`, or unquoted `on<word>=value`.
// Lookbehind ensures we only match when preceded by whitespace, so we don't
// accidentally truncate something like `<button>` (no match) or `<a hreon=`
// (false positive).
const EVENT_HANDLER_RE = /\son[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
// `javascript:` and `vbscript:` URI schemes in href/src — collapse to `#` to
// keep the structural attribute but neutralize the action.
const DANGEROUS_URI_RE = /\b(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|"vbscript:[^"]*"|'vbscript:[^']*')/gi;

/**
 * Remove script/iframe/object/embed tags, HTML comments, event-handler
 * attributes, and javascript: URIs from the input string. Idempotent.
 */
export function sanitizeSourceHtml(html: string): string {
  if (!html) return html;
  let out = html;

  // Strip wrapped tag blocks first so any malicious attributes inside them
  // (event handlers, comments, etc.) don't bleed into later passes.
  out = out.replace(SCRIPT_TAG_RE, '');
  out = out.replace(SCRIPT_OPEN_NO_CLOSE_RE, '');
  out = out.replace(IFRAME_TAG_RE, '');
  out = out.replace(IFRAME_OPEN_NO_CLOSE_RE, '');
  out = out.replace(OBJECT_TAG_RE, '');
  out = out.replace(OBJECT_OPEN_NO_CLOSE_RE, '');
  out = out.replace(EMBED_TAG_RE, '');

  // Comments next — they can contain prompt-injection text intended to
  // surface only when an LLM "reads" the markup.
  out = out.replace(COMMENT_RE, '');

  // Event handlers and dangerous URIs can decorate any remaining tag.
  out = out.replace(EVENT_HANDLER_RE, '');
  out = out.replace(DANGEROUS_URI_RE, '$1="#"');

  return out;
}
