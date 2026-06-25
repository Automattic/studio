//
// wxr-template-patch.ts
// =====================
// Single-pass patch of reconstructed post_content + the _wp_page_template
// assignment into the FULL WXR, so the portable output.wxr matches the Studio
// render. Keyed by slug (WP post IDs don't exist until import). Mirrors the carry
// path's item-split + function-replacer + CDATA-escape pattern (carry-page-list.ts)
// and reuses its tag/wxrSource helpers. Meta upsert is text-level here — no
// wxr-builder change needed.
//
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tag, wxrSource } from './carry-page-list.js';

const META_KEY = '_wp_page_template';

export interface WxrTemplatePatchInput {
  slug: string;
  content: string;
  /** Assignment value, or null to clear (page reverts to the default template). */
  templateSlug: string | null;
}

export interface WxrTemplatePatchResult {
  items: number;
  contentPatched: number;
  metaSet: number;
  metaCleared: number;
  /** Input slugs not found among page/post items (surfaced, never silent). */
  unmatched: string[];
  /** slug → current _wp_page_template BEFORE patching (feeds the reconcile guard). */
  existingAssignments: Map<string, string>;
  cdataBalanced: boolean;
}

const cdataEscape = (s: string) => s.replace(/]]>/g, ']]]]><![CDATA[>');

/** Replace-or-insert (or remove) the _wp_page_template postmeta in one item string. */
function upsertMeta(itemBlock: string, slugOrNull: string | null): { block: string; set: boolean; cleared: boolean } {
  const metaRe = new RegExp(
    `<wp:postmeta>(?:(?!</wp:postmeta>)[\\s\\S])*?<wp:meta_key>${META_KEY}</wp:meta_key>[\\s\\S]*?</wp:postmeta>`,
  );
  const has = metaRe.test(itemBlock);
  if (slugOrNull === null) {
    if (!has) return { block: itemBlock, set: false, cleared: false };
    return { block: itemBlock.replace(metaRe, () => ''), set: false, cleared: true };
  }
  const metaXml = `<wp:postmeta><wp:meta_key>${META_KEY}</wp:meta_key>`
    + `<wp:meta_value><![CDATA[${slugOrNull}]]></wp:meta_value></wp:postmeta>`;
  if (has) return { block: itemBlock.replace(metaRe, () => metaXml), set: true, cleared: false };
  const closeIdx = itemBlock.lastIndexOf('</item>');
  return { block: itemBlock.slice(0, closeIdx) + metaXml + itemBlock.slice(closeIdx), set: true, cleared: false };
}

/** PURE single-pass patch. */
export function patchWxrTemplates(
  wxrText: string,
  inputs: WxrTemplatePatchInput[],
): { wxr: string; result: WxrTemplatePatchResult } {
  const bySlug = new Map(inputs.map((i) => [i.slug, i]));
  const matched = new Set<string>();
  const existingAssignments = new Map<string, string>();
  let items = 0, contentPatched = 0, metaSet = 0, metaCleared = 0;

  const out = wxrText.split(/(<item>[\s\S]*?<\/item>)/).map((part) => {
    if (!part.startsWith('<item>')) return part;
    items++;
    const postType = tag(part, 'wp:post_type');
    if (postType !== 'page' && postType !== 'post') return part;
    const slug = tag(part, 'wp:post_name');
    const priorMatch = part.match(
      new RegExp(`<wp:meta_key>${META_KEY}</wp:meta_key>\\s*<wp:meta_value>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</wp:meta_value>`),
    );
    if (priorMatch) existingAssignments.set(slug, priorMatch[1].trim());
    const input = bySlug.get(slug);
    if (!input) return part;
    matched.add(slug);
    let block = part.replace(
      /<content:encoded>[\s\S]*?<\/content:encoded>/,
      () => { contentPatched++; return `<content:encoded><![CDATA[${cdataEscape(input.content)}]]></content:encoded>`; },
    );
    const m = upsertMeta(block, input.templateSlug);
    block = m.block;
    if (m.set) metaSet++;
    if (m.cleared) metaCleared++;
    return block;
  }).join('');

  const unmatched = inputs.map((i) => i.slug).filter((s) => !matched.has(s));
  const cdataBalanced = (out.match(/<!\[CDATA\[/g) || []).length === (out.match(/]]>/g) || []).length;
  return { wxr: out, result: { items, contentPatched, metaSet, metaCleared, unmatched, existingAssignments, cdataBalanced } };
}

/** FS wrapper: patch the pristine WXR (output.wxr.full if present, else output.wxr)
 *  IN PLACE and return the result. Targets wxrSource() so it's correct whether or
 *  not liberate_preview later slims output.wxr. */
export function patchWxrTemplatesFile(outputDir: string, inputs: WxrTemplatePatchInput[]): WxrTemplatePatchResult {
  const path = wxrSource(outputDir);
  const { wxr, result } = patchWxrTemplates(readFileSync(path, 'utf8'), inputs);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, wxr);
  renameSync(tmp, path); // atomic replace
  return result;
}
