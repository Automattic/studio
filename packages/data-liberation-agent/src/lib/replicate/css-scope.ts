import postcss, { type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

export interface ScopeOpts {
  /** Wrapper selector to scope everything under, e.g. `body.lib-carry-site`. */
  scope: string;
  /** Stable short id (used later for @keyframes namespacing). */
  scopeId?: string;
  /** Rewrite url(...) targets; return null to leave unchanged. */
  rewriteUrl?: (url: string) => string | null;
}

const ROOTISH = new Set(['html', 'body', ':root']);
const ROOT_ANCHOR = new Set(['html', ':root']);

function scopeSelector(selector: string, scope: string): string {
  // Wrap the scope in :where() so it contributes ZERO specificity. The carried
  // source CSS then keeps its ORIGINAL internal cascade exactly — critical because
  // the same reset/component rules are emitted in both the site sheet (scope
  // `body.lib-carry-site`) and the per-page sheet (scope `body.lib-carry-site.lib-carry-page-<slug>`).
  // A plain prefix makes a page-scoped element reset (`…page-<slug> section`, 2
  // classes + 2 elements) outrank a site-scoped component rule (`…site .comp`, 2
  // classes + 1 element), so the reset wrongly zeroes chrome padding/margins. With
  // :where() the wrapper adds nothing, so component classes beat element resets just
  // like on the source.
  const whereScope = `:where(${scope})`;
  return selectorParser((selectors) => {
    selectors.each((sel) => {
      const first = sel.first;
      if (
        first &&
        (first.type === 'tag' || first.type === 'pseudo') &&
        ROOTISH.has(first.toString())
      ) {
        first.replaceWith(selectorParser.string({ value: whereScope }));
        return;
      }
      // Reverse-order prepends: each prepend pushes ahead of the current first node, so
      // inserting the combinator first then the scope yields `scope <combinator> <original…>`.
      sel.prepend(selectorParser.combinator({ value: ' ' }));
      sel.prepend(selectorParser.string({ value: whereScope }));
    });
  }).processSync(selector);
}

export function scopeCss(css: string, opts: ScopeOpts): string {
  const root = postcss.parse(css);

  // Hoist root font-size to a real :root rule so `rem` resolves correctly. The
  // scoper otherwise rewrites html/:root -> :where(scope) (body), which silently
  // breaks rem (rem is always root-relative). Only font-size needs the root anchor;
  // other html/:root declarations still scope to the wrapper. A combined selector
  // list like `html, .foo{font-size:..}` removes font-size from the whole rule
  // (acceptable — this pattern doesn't occur in rem-base root CSS).
  const rootFontSizes: string[] = [];
  root.walkRules((rule: Rule) => {
    // Only hoist TOP-LEVEL root font-size; leave @media/@supports/@keyframes-nested
    // rules to the normal scoping pass so a responsive root-font-size breakpoint
    // stays conditional instead of applying unconditionally.
    if (rule.parent?.type !== 'root') return;
    const isRootSel = rule.selectors.some((s) => ROOT_ANCHOR.has(s.trim()));
    if (!isRootSel) return;
    rule.walkDecls(/^font-size$/i, (decl) => {
      rootFontSizes.push(decl.value.trim());
      decl.remove();
    });
    if (rule.nodes.length === 0) rule.remove();
  });

  root.walkRules((rule: Rule) => {
    if (
      rule.parent &&
      rule.parent.type === 'atrule' &&
      /keyframes$/i.test((rule.parent as { name?: string }).name ?? '')
    )
      return;
    rule.selector = rule.selectors.map((s) => scopeSelector(s, opts.scope)).join(', ');
  });

  if (opts.scopeId) {
    const renamed = new Map<string, string>();
    root.walkAtRules(/^keyframes$/i, (at) => {
      const from = at.params.trim();
      const to = `${from}__${opts.scopeId}`;
      renamed.set(from, to);
      at.params = to;
    });
    if (renamed.size > 0) {
      root.walkDecls(/^(animation|animation-name)$/i, (decl) => {
        for (const [from, to] of renamed) {
          decl.value = decl.value.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
        }
      });
    }
  }

  if (opts.rewriteUrl) {
    root.walkDecls((decl) => {
      decl.value = decl.value.replace(
        /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
        (m, q, url) => {
          const next = opts.rewriteUrl!(url);
          return next ? `url(${q}${next}${q})` : m;
        },
      );
    });
  }

  const rootCss = rootFontSizes.length
    ? `:root{font-size:${rootFontSizes[rootFontSizes.length - 1]}}\n`
    : '';
  return rootCss + root.toString();
}
