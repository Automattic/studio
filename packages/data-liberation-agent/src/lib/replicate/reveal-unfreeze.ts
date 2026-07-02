/**
 * Generic JS-reveal un-freeze for the carry path. Builder themes gate entrance
 * animations on a hook class whose initial CSS state is hidden (opacity:0 /
 * visibility:hidden / display:none) and whose reveal is fired by runtime JS
 * (IntersectionObserver / hydration). Carry strips scripts, so those elements stay
 * frozen. We detect the gate classes from the SOURCE CSS (no hardcoded theme names)
 * and emit a scoped override forcing the revealed end-state.
 *
 * Leave `nav-reveal-unfreeze.ts` unchanged — its `:has()` ancestor-targeting
 * override for the Wix horizontal-menu case is distinct from this generic path.
 */
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * Match opacity values that represent a visually-hidden initial state:
 *   - exact zero:          opacity:0 / opacity: 0
 *   - zero with decimal:   opacity:0.0  / opacity:0.00
 *   - small fraction:      opacity:.01  / opacity:0.01  / opacity:.05
 *
 * Does NOT match:
 *   - opacity:1  (fully visible)
 *   - opacity:0.5  (partly visible)
 *   - opacity:0.1  (mostly visible for animation purposes)
 *
 * Negative lookahead (?![.0-9]) guards against matching the leading `0` in
 * `0.5` — after consuming `0`, any following `.` or digit aborts the match.
 */
const HIDDEN_OPACITY_RE = /opacity\s*:\s*(?:0?\.0\d*|0(?:\.0+)?)(?![.0-9])/i;

/** A source hide rule that gates a JS-reveal entrance. */
export interface RevealGateRule {
  /** The rule's ORIGINAL (un-scoped) selector part, e.g. `.scroll-trigger.animate--slide-in`. */
  selector: string;
  /** The class tokens in that selector — used as a DOM-presence gate. */
  classes: string[];
}

/**
 * Hide rules that gate a JS-reveal entrance: a hidden initial state (opacity≈0 /
 * visibility:hidden / display:none) AND animation-driven (transition / animation /
 * transform present, or an `--offscreen` / `:not()` reveal pattern). Returns each
 * rule's ORIGINAL selector part + its class tokens, so the un-freeze override can
 * target the exact gated elements (the full compound selector) instead of each
 * class in isolation — forcing the end-state on a bare layout co-class (e.g.
 * `.container` in `.container.scroll-trigger`) would null its transforms site-wide.
 *
 * Hover/focus rules are excluded — they describe an interactive state, not a gate.
 */
export function detectRevealGateRules(css: string): RevealGateRule[] {
  const rules: RevealGateRule[] = [];
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return [];
  }

  root.walkRules((rule) => {
    // Read DECLARATIONS only — never the selector text — so a class literally
    // named `.transition-up` / `.opacity-fade` with `opacity:0` isn't mistaken
    // for an animated reveal gate (the "transition"/"opacity" token would
    // otherwise leak in from the selector via `rule.toString()`).
    const decls = (rule.nodes ?? []).filter(
      (n): n is postcss.Declaration => n.type === 'decl',
    );
    const declText = decls.map((d) => `${d.prop}:${d.value}`).join(';');

    const hidesContent =
      HIDDEN_OPACITY_RE.test(declText) ||
      /visibility\s*:\s*hidden/i.test(declText) ||
      /display\s*:\s*none/i.test(declText);
    if (!hidesContent) return;

    const animated = decls.some((d) => /^(?:transition|animation|transform)/i.test(d.prop));
    // The `--offscreen` / `:not()` reveal heuristic intentionally reads the
    // SELECTOR (that's where the offscreen state lives, e.g. Dawn's
    // `.scroll-trigger--offscreen{visibility:hidden}`).
    const offscreen = /--offscreen|:not\(/i.test(rule.selector);
    if (!animated && !offscreen) return;

    // Skip hover/focus variant rules — they describe an interactive state, not a
    // frozen entrance gate.
    if (/:hover|:focus/i.test(rule.selector)) return;

    // One entry per comma-separated selector part, carrying its class tokens.
    for (const part of rule.selectors) {
      const classes: string[] = [];
      try {
        selectorParser((sels) => {
          sels.walkClasses((c) => {
            classes.push(c.value);
          });
        }).processSync(part);
      } catch {
        continue;
      }
      if (classes.length === 0) continue;
      rules.push({ selector: part.trim(), classes });
    }
  });

  return rules;
}

/** Back-compat: the flat set of gate class names across all detected gate rules. */
export function detectRevealGateClasses(css: string): string[] {
  const gates = new Set<string>();
  for (const r of detectRevealGateRules(css)) for (const c of r.classes) gates.add(c);
  return [...gates];
}

/**
 * Append a scoped end-state override for each JS-reveal gate RULE whose elements
 * exist in `domHtml`. Emits the rule's ORIGINAL (compound) selector so only the
 * gated elements are un-frozen — never a bare co-class. No-ops (returns `css`
 * unchanged) when no detected gate rule matches the DOM.
 *
 * @param css       The already-scoped, treeshaken sheet to augment.
 * @param sourceCss The original source CSS used to detect gate rules.
 * @param domHtml   The carried DOM the sheet styles (chrome or main region).
 * @param scope     The sheet's wrapper selector (e.g. `body.lib-carry-site`).
 */
export function appendRevealUnfreeze(
  css: string,
  sourceCss: string,
  domHtml: string,
  scope: string,
): string {
  // Match on a class-token boundary, not a raw substring, so a short gate class
  // (e.g. `in`) isn't considered present just because the DOM contains
  // `section-inner`. A class token is delimited by start/whitespace/quote on the
  // left and whitespace/quote/`>` on the right.
  const inDom = (g: string) =>
    new RegExp(`(?:^|[\\s"'])${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s"'>])`).test(domHtml);

  const seen = new Set<string>();
  const selectors: string[] = [];
  for (const rule of detectRevealGateRules(sourceCss)) {
    // Only un-freeze when EVERY class in the rule's selector is present in the DOM,
    // so the compound selector actually matches a carried element (and we never
    // emit an override targeting an unrelated layout co-class).
    if (!rule.classes.every(inDom)) continue;
    if (seen.has(rule.selector)) continue;
    seen.add(rule.selector);
    selectors.push(`:where(${scope}) ${rule.selector}`);
  }
  if (selectors.length === 0) return css;

  const override =
    `\n\n/* carry: un-freeze stripped JS-reveal entrance gates (opacity/visibility/transform initial state). */\n` +
    `${selectors.join(',\n')}{opacity:1!important;visibility:visible!important;transform:none!important}\n`;
  return css + override;
}
