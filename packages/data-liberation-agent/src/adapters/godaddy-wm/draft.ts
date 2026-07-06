import type { DraftBlock, DraftContentState, DraftEntity } from './types.js';
import { escapeHtml, escapeAttr } from './content.js';
import { upgradeIsteamUrl } from './media.js';

// ---------------------------------------------------------------------------
// Draft.js → HTML converter
// ---------------------------------------------------------------------------
//
// W+M blog posts hydrate client-side from a `window._BLOG_DATA` JSON blob.
// The real post body lives at `_BLOG_DATA.post.fullContent` as a Draft.js
// ContentState: { blocks: [...], entityMap: {...} }. Each block has a type
// (unstyled, header-N, list, blockquote, etc.), a text string, inline style
// ranges, and entity ranges that reference entityMap by key.
//
// This converter handles the common subset actually used by W+M blogs.
// ---------------------------------------------------------------------------

export const INLINE_STYLE_TAGS: Record<string, string> = {
  BOLD: 'strong',
  ITALIC: 'em',
  UNDERLINE: 'u',
  STRIKETHROUGH: 's',
  CODE: 'code',
};

/**
 * Render a single Draft.js block's text with its inline styles and entity ranges
 * applied. Walks the string one character at a time, emitting open/close tags
 * when the set of active styles or the active entity changes.
 */
export function renderBlockText(block: DraftBlock, entityMap: Record<string, DraftEntity>): string {
  const text = block.text || '';
  if (!text) return '';

  const styleRanges = block.inlineStyleRanges || [];
  const entityRanges = block.entityRanges || [];

  type Segment = { char: string; styles: Set<string>; entityKey: number | null };
  const segments: Segment[] = [];

  for (let i = 0; i < text.length; i++) {
    const styles = new Set<string>();
    for (const r of styleRanges) {
      if (i >= r.offset && i < r.offset + r.length) styles.add(r.style);
    }
    let entityKey: number | null = null;
    for (const r of entityRanges) {
      if (i >= r.offset && i < r.offset + r.length) {
        entityKey = r.key;
        break;
      }
    }
    segments.push({ char: text[i], styles, entityKey });
  }

  // Walk segments, tracking open tags as a stack. When the active set changes,
  // close tags that are no longer active and open any newly active ones.
  let out = '';
  const openStyles: string[] = []; // stack of style names currently open
  let openEntity: number | null = null;

  const closeAll = () => {
    while (openStyles.length) {
      const s = openStyles.pop()!;
      const tag = INLINE_STYLE_TAGS[s];
      if (tag) out += `</${tag}>`;
    }
    if (openEntity != null) {
      const ent = entityMap[String(openEntity)];
      if (ent && ent.type === 'LINK') out += '</a>';
      openEntity = null;
    }
  };

  const prevActive = { styles: new Set<string>(), entity: null as number | null };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // If active set differs from prev, close everything then reopen
    const stylesEqual =
      seg.styles.size === prevActive.styles.size &&
      [...seg.styles].every((s) => prevActive.styles.has(s));
    const entityEqual = seg.entityKey === prevActive.entity;
    if (!stylesEqual || !entityEqual) {
      closeAll();
      // Open entity first (so style tags nest inside link)
      if (seg.entityKey != null) {
        const ent = entityMap[String(seg.entityKey)];
        if (ent && ent.type === 'LINK') {
          const href = escapeAttr(String(ent.data?.href || '#'));
          const target = ent.data?.target ? ` target="${escapeAttr(String(ent.data.target))}"` : '';
          out += `<a href="${href}"${target}>`;
          openEntity = seg.entityKey;
        }
      }
      for (const s of seg.styles) {
        const tag = INLINE_STYLE_TAGS[s];
        if (tag) {
          out += `<${tag}>`;
          openStyles.push(s);
        }
      }
      prevActive.styles = new Set(seg.styles);
      prevActive.entity = seg.entityKey;
    }
    out += escapeHtml(seg.char);
  }

  closeAll();
  return out;
}

/**
 * Render an `atomic` block — W+M uses these for images. Looks up the entity
 * referenced by the block's single entityRange and emits <figure><img/></figure>.
 */
export function renderAtomicBlock(block: DraftBlock, entityMap: Record<string, DraftEntity>): string {
  const ranges = block.entityRanges || [];
  if (ranges.length === 0) return '';
  const ent = entityMap[String(ranges[0].key)];
  if (!ent || ent.type !== 'IMAGE') return '';
  const src = upgradeIsteamUrl(String(ent.data?.src || ''));
  const alt = escapeAttr(String(ent.data?.alt || ''));
  return `<figure><img src="${escapeAttr(src)}" alt="${alt}" /></figure>`;
}

/**
 * Convert a Draft.js ContentState to HTML. Groups consecutive list items
 * into <ul>/<ol> wrappers.
 */
export function draftToHtml(content: DraftContentState): string {
  const blocks = content.blocks || [];
  const entityMap = content.entityMap || {};
  const out: string[] = [];

  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const block of blocks) {
    const type = block.type || 'unstyled';
    const isUl = type === 'unordered-list-item';
    const isOl = type === 'ordered-list-item';

    if (isUl || isOl) {
      const want = isUl ? 'ul' : 'ol';
      if (listType !== want) {
        closeList();
        out.push(`<${want}>`);
        listType = want;
      }
      out.push(`<li>${renderBlockText(block, entityMap)}</li>`);
      continue;
    }

    closeList();

    if (type === 'atomic') {
      const atomic = renderAtomicBlock(block, entityMap);
      if (atomic) out.push(atomic);
      continue;
    }

    const inner = renderBlockText(block, entityMap);
    if (type === 'unstyled') {
      if (inner.trim()) out.push(`<p>${inner}</p>`);
    } else if (/^header-(one|two|three|four|five|six)$/.test(type)) {
      const levels: Record<string, number> = {
        'header-one': 1,
        'header-two': 2,
        'header-three': 3,
        'header-four': 4,
        'header-five': 5,
        'header-six': 6,
      };
      const n = levels[type];
      out.push(`<h${n}>${inner}</h${n}>`);
    } else if (type === 'blockquote') {
      out.push(`<blockquote>${inner}</blockquote>`);
    } else if (type === 'code-block') {
      out.push(`<pre><code>${inner}</code></pre>`);
    } else {
      // Unknown block type — emit as paragraph as a safe fallback
      if (inner.trim()) out.push(`<p>${inner}</p>`);
    }
  }

  closeList();
  return out.join('\n');
}
