import postcss, { type Rule } from 'postcss';
import * as cheerio from 'cheerio';
import selectorParser from 'postcss-selector-parser';

/** Extract the rightmost compound selector (the "key" used for matching). */
function keyCompound(selector: string): string | null {
  try {
    let key = '';
    selectorParser((sels) => {
      const sel = sels.first;
      const nodes = sel.nodes;
      let buf = '';
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].type === 'combinator') break;
        buf = nodes[i].toString() + buf;
      }
      key = buf.trim();
    }).processSync(selector);
    return key || null;
  } catch {
    return null; // unparseable -> keep on doubt
  }
}

export function treeshakeCss(css: string, carriedHtml: string): string {
  const $ = cheerio.load(carriedHtml);
  const root = postcss.parse(css);
  root.walkRules((rule: Rule) => {
    // Keep on doubt: only consider top-level, non-keyframe rules.
    if (rule.parent && rule.parent.type === 'atrule') return;
    const keep = rule.selectors.some((sel) => {
      const key = keyCompound(sel);
      if (!key) return true;                                  // unparseable -> keep
      if (/^(html|body|:root)(\b|$)/i.test(key)) return true; // structural -> keep (word boundary)
      // Strip pseudo-classes/elements (:hover, ::before, :not(...)) so we match the
      // base element's existence; cheerio silently returns 0 for :hover et al.
      const base = key.replace(/:{1,2}[\w-]+(\([^)]*\))?/g, '').trim();
      if (!base) return true;                                 // pseudo-only key -> keep on doubt
      try { return $(base).length > 0; } catch { return true; } // bad selector -> keep
    });
    if (!keep) rule.remove();
  });
  return root.toString();
}
