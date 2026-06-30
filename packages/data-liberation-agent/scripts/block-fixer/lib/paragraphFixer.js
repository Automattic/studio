//
// Paragraph fixer — ported verbatim from
// https://github.com/Automattic/telex (server/scripts/block-fixer/lib/paragraphFixer.js).
//
// Fixes nested <p> tags inside WordPress paragraph blocks. The WP serializer
// can wrap mismatched-style paragraphs and produce <p><p>...</p></p>, which
// then fails block-validation in WordPress. Merge attributes (classes
// concatenated, styles combined, others outer-wins) and flatten to one <p>.
//

function parseAttributes(attrString) {
  const attrs = {};
  if (!attrString) return attrs;

  const doubleQuotePattern = /(\S+)="([^"]*)"/g;
  let match;
  while ((match = doubleQuotePattern.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }

  const singleQuotePattern = /(\S+)='([^']*)'/g;
  while ((match = singleQuotePattern.exec(attrString)) !== null) {
    if (!(match[1] in attrs)) {
      attrs[match[1]] = match[2];
    }
  }

  return attrs;
}

function mergeAttributes(outerAttrs, innerAttrs) {
  const outer = parseAttributes(outerAttrs);
  const inner = parseAttributes(innerAttrs);
  const merged = { ...outer };

  for (const [key, value] of Object.entries(inner)) {
    if (key === 'class') {
      const outerClasses = (outer.class || '').split(/\s+/).filter(Boolean);
      const innerClasses = value.split(/\s+/).filter(Boolean);
      const allClasses = [...new Set([...outerClasses, ...innerClasses])];
      merged.class = allClasses.join(' ');
    } else if (key === 'style') {
      const outerStyles = (outer.style || '').split(';').filter(Boolean);
      const innerStyles = value.split(';').filter(Boolean);

      const styleMap = {};
      for (const style of [...outerStyles, ...innerStyles]) {
        const colonIdx = style.indexOf(':');
        if (colonIdx > 0) {
          const prop = style.substring(0, colonIdx).trim();
          const val = style.substring(colonIdx + 1).trim();
          styleMap[prop] = val;
        }
      }

      merged.style = Object.entries(styleMap)
        .map(([prop, val]) => `${prop}:${val}`)
        .join(';');
    } else if (!(key in outer)) {
      merged[key] = value;
    }
  }

  return merged;
}

function serializeAttributes(attrs) {
  const parts = [];
  for (const [key, value] of Object.entries(attrs)) {
    parts.push(`${key}="${value}"`);
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function fixNestedParagraphs(htmlContent) {
  if (!htmlContent.includes('<!-- wp:paragraph')) {
    return htmlContent;
  }

  const wpParagraphBlockPattern = /(<!-- wp:paragraph[^>]*-->)([\s\S]*?)(<!-- \/wp:paragraph -->)/g;
  const nestedPPattern = /<p(\s[^>]*)?>(\s*)<p(\s[^>]*)?>([^]*?)<\/p>(\s*)<\/p>/gi;

  let result = htmlContent;
  let totalFixCount = 0;

  result = result.replace(wpParagraphBlockPattern, (_fullMatch, openComment, blockContent, closeComment) => {
    let fixedContent = blockContent;
    let prevContent;
    let blockFixCount = 0;

    do {
      prevContent = fixedContent;
      fixedContent = fixedContent.replace(nestedPPattern, (_match, outerAttrs, _ws1, innerAttrs, innerContent, _ws2) => {
        blockFixCount++;
        const mergedAttrs = mergeAttributes(outerAttrs, innerAttrs);
        const attrString = serializeAttributes(mergedAttrs);
        return `<p${attrString}>${innerContent}</p>`;
      });
    } while (fixedContent !== prevContent);

    totalFixCount += blockFixCount;
    return `${openComment}${fixedContent}${closeComment}`;
  });

  if (totalFixCount > 0) {
    console.error(`[ParagraphFixer] Fixed ${totalFixCount} nested <p> tag(s) in WordPress paragraph blocks`);
  }

  return result;
}

module.exports = {
  fixNestedParagraphs,
  parseAttributes,
  mergeAttributes,
  serializeAttributes,
};
