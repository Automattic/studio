import type { Page } from 'playwright';

export const CLEANUP_SCHEMA = 'data-liberation/source-cleanup/v6';
export interface CleanupRule {
  id: string;
  category: 'advertisement' | 'source-attribution';
  selector: string;
  /** Credit links remove their attribution phrase, retaining owner footer text. */
  credit?: boolean;
  /** Generic acquisition bars require explicit promotion language. */
  promotion?: boolean;
  /** Unnamed builder chrome requires an authoring affordance plus its vendor's assets. */
  builderChrome?: boolean;
  /** Adapter-owned brand spelling for plain-text footer credit removal. */
  creditText?: string;
  /** Custom properties this chrome publishes its own height into, so the space
   *  it reserved is reclaimed with it rather than frozen at the captured value. */
  reclaimVariables?: string[];
  hosts?: string[];
}
export interface CleanupPolicy {
  schema: typeof CLEANUP_SCHEMA;
  rules: CleanupRule[];
  promotion: { text: string; signup: string };
  builderChrome: { affordance: string };
}

const PROMOTION_PATTERNS = {
  text: '\\bpowered by\\b|\\bcreate your own (?:unique )?website\\b',
  signup: '\\b(?:sign[ -]?up|get started|start (?:your|a) (?:site|website))\\b',
};

/** An offer to open this page in the tool that produced it, addressed to whoever
 * is looking at it — the shape every builder badge shares regardless of vendor. */
const BUILDER_CHROME_PATTERNS = {
  affordance: '\\b(?:edit|made|built|created|designed|generated)\\s+(?:with|on|by|using)\\b|\\bcreate\\s+(?:a|your own)\\s+(?:unique\\s+)?site\\b|\\bfree\\s+trial\\b',
};

/** Shared recognition for live cleanup, overlay classification and old exports. */
export function isSourcePromotion(text: string): boolean {
  return new RegExp(PROMOTION_PATTERNS.text, 'i').test(text) && new RegExp(PROMOTION_PATTERNS.signup, 'i').test(text);
}
export interface CleanupRecord {
  rule: string;
  category: CleanupRule['category'];
  selector: string;
  text: string;
  action: 'remove' | 'remove-credit-text';
  reclaimedBodyPadding: boolean;
  /** Custom properties zeroed because this removal took the space they reserved. */
  reclaimedVariables?: string[];
}
export interface CleanupReport {
  url: string;
  viewport: number;
  removed: number;
  records: CleanupRecord[];
  truncated: boolean;
  failures: string[];
  residual: number;
  unknowns?: string[];
  /** Orphaned `#id` style rules removed from inline styles after element removal. */
  strippedCssRules?: number;
}

const AD_RULES: CleanupRule[] = [
  { id: 'ad-slots', category: 'advertisement', selector: '.adsbygoogle,[data-ad-slot],[data-ad-unit],[data-ad-client],[data-google-query-id],[id^="div-gpt-ad"],.ad-slot,.ad-container,.advertisement,.OUTBRAIN,.trc_rbox_container,[aria-label="Advertisement" i],[aria-label="Advertisements" i]' },
  { id: 'ad-frames', category: 'advertisement', selector: 'iframe[id^="google_ads_iframe"],iframe[id^="aswift_"]' },
  { id: 'ad-network', category: 'advertisement', selector: 'iframe[src],script[src]', hosts: ['googlesyndication.com', 'doubleclick.net', 'ads.yahoo.com', 'adnxs.com'] },
  { id: 'provider-acquisition', category: 'source-attribution', selector: 'body > div,body > aside,footer > div', promotion: true },
];

/** Last rule in the policy: a platform that names its own badge keeps the
 * attribution in the evidence, and this catches the platforms nobody named. */
const BUILDER_CHROME_RULE: CleanupRule = {
  id: 'builder-chrome', category: 'source-attribution', builderChrome: true,
  selector: 'body > div,body > aside,body > a,body > span,footer > div',
};

export function cleanupPolicy(rules: CleanupRule[] = []): CleanupPolicy {
  return { schema: CLEANUP_SCHEMA, rules: [...AD_RULES, ...rules, BUILDER_CHROME_RULE],
    promotion: { ...PROMOTION_PATTERNS }, builderChrome: { ...BUILDER_CHROME_PATTERNS } };
}

/** Source adapters supply identity; the matching/removal mechanism is shared. */
export function providerCreditRules(id: string, hosts: string[], brand: string): CleanupRule[] {
  return [
    { id: `${id}-credit`, category: 'source-attribution', selector: 'a[href]', hosts, credit: true },
    { id: `${id}-credit-text`, category: 'source-attribution', selector: 'footer,[role="contentinfo"],body', creditText: brand },
  ];
}

export function validateCleanupPolicy(value: unknown): asserts value is CleanupPolicy {
  const policy = value as CleanupPolicy;
  if (!policy || policy.schema !== CLEANUP_SCHEMA || policy.promotion?.text !== PROMOTION_PATTERNS.text ||
    policy.promotion?.signup !== PROMOTION_PATTERNS.signup ||
    policy.builderChrome?.affordance !== BUILDER_CHROME_PATTERNS.affordance ||
    !Array.isArray(policy.rules) || policy.rules.length > 100 ||
    policy.rules.some((rule) => !rule || typeof rule.id !== 'string' || typeof rule.selector !== 'string' ||
      rule.selector.length > 2000 || !['advertisement', 'source-attribution'].includes(rule.category) ||
      (rule.creditText !== undefined && (typeof rule.creditText !== 'string' || rule.creditText.length > 100)) ||
      (rule.reclaimVariables !== undefined && (!Array.isArray(rule.reclaimVariables) || rule.reclaimVariables.length > 20 ||
        rule.reclaimVariables.some((name) => typeof name !== 'string' || !/^--[\w-]{1,100}$/.test(name)))) ||
      (rule.hosts !== undefined && (!Array.isArray(rule.hosts) || rule.hosts.some((host) => typeof host !== 'string'))))) {
    throw new Error('Unsupported or invalid source cleanup policy; recapture with a supported policy');
  }
}

/** This function is serialized into the page. All policy and mechanics live
 * here so live capture and comparison use identical removal/reflow behavior. */
export function installCleanupInPage(policy: CleanupPolicy): CleanupReport {
  // Polyfill tsx/esbuild's __name helper inside the page (mirrors screenshotter)
  // — page.evaluate closures serialized under tsx carry __name() instrumentation
  // that the built bundle does not emit.
  const globalWithName = globalThis as typeof globalThis & {
    __name?: ( fn: unknown ) => unknown;
  };
  if ( typeof globalWithName.__name === 'undefined' ) {
    globalWithName.__name = ( fn ) => fn;
  }
  type State = { report: CleanupReport; observer: MutationObserver; sweep: () => void };
  const host = window as unknown as { __dlaCleanup?: State };
  host.__dlaCleanup?.observer.disconnect();
  const report: CleanupReport = { url: location.href, viewport: innerWidth, removed: 0, records: [], truncated: false, failures: [], residual: 0 };
  // Removing an element orphans the CSS rules that only existed to style it.
  // Attribution chrome routinely ships a stylesheet beside its markup; if those
  // rules survive they are captured into website/ and re-projected into the
  // destination theme. Track every id that left the DOM (removed nodes and
  // their subtrees) and strip `#id` rules from inline styles.
  const orphanedIds = new Set<string>();
  const dropped = { count: 0 };
  const orphanIdsIn = (node: Element) => {
    if (node.id) orphanedIds.add(node.id);
    for (const owned of node.querySelectorAll('[id]')) orphanedIds.add(owned.id);
  };
  let idPattern: RegExp | null = null;
  let idPatternSize = -1;
  /** Text-level scan so owner rules keep their exact bytes; only preludes
   * naming an orphaned id are dropped. Attribute selectors are masked first so
   * `[href="#id"]` (a rule about a linking element, not the removed one) is kept. */
  const stripOrphanedCss = () => {
    if (!orphanedIds.size) return;
    if (!idPattern || orphanedIds.size !== idPatternSize) {
      idPattern = new RegExp([...orphanedIds].map((id) => `#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).join('|'));
      idPatternSize = orphanedIds.size;
    }
    const grouping = /^@(?:media|supports|layer|container|scope|document)\b/i;
    const scan = (css: string): string => {
      let out = '';
      let index = 0;
      while (index < css.length) {
        let prelude = '';
        while (index < css.length) {
          const ch = css[index];
          if (ch === '"' || ch === "'") { const stop = css.indexOf(ch, index + 1); const end = stop === -1 ? css.length : stop + 1; prelude += css.slice(index, end); index = end; continue; }
          if (ch === '/' && css[index + 1] === '*') { const stop = css.indexOf('*/', index + 2); const end = stop === -1 ? css.length : stop + 2; prelude += css.slice(index, end); index = end; continue; }
          if (ch === '{' || ch === ';' || ch === '}') break;
          prelude += ch;
          index++;
        }
        if (index >= css.length) { out += prelude; break; }
        if (css[index] !== '{') { out += prelude + css[index]; index++; continue; }
        let depth = 0;
        let close = index;
        while (close < css.length) {
          const ch = css[close];
          if (ch === '"' || ch === "'") { const stop = css.indexOf(ch, close + 1); close = stop === -1 ? css.length : stop + 1; continue; }
          if (ch === '/' && css[close + 1] === '*') { const stop = css.indexOf('*/', close + 2); close = stop === -1 ? css.length : stop + 2; continue; }
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (!depth) { close++; break; } }
          close++;
        }
        const selector = prelude.trim();
        const body = depth === 0 ? css.slice(index + 1, close - 1) : css.slice(index + 1, close);
        if (selector.startsWith('@')) {
          if (grouping.test(selector)) {
            const inner = scan(body);
            if (inner.trim()) out += `${prelude}{${inner}}`;
          } else out += prelude + css.slice(index, close);
        } else if (idPattern!.test(selector.replace(/\[[^\]]*\]/g, ''))) dropped.count++;
        else if (body.includes('{')) out += `${prelude}{${scan(body)}}`;
        else out += prelude + css.slice(index, close);
        index = close;
      }
      return out;
    };
    let pass = 0;
    for (const style of document.querySelectorAll('style')) {
      const css = style.textContent ?? '';
      let relevant = false;
      for (const id of orphanedIds) if (css.includes(`#${id}`)) { relevant = true; break; }
      if (!relevant) continue;
      const before = dropped.count;
      const cleaned = scan(css);
      pass += dropped.count - before;
      if (cleaned !== css) style.textContent = cleaned;
    }
    if (pass) report.strippedCssRules = (report.strippedCssRules ?? 0) + pass;
  };
  // Chrome that reserves its own space does not always do it with padding on
  // the body. A provider runtime that measures its bar and publishes the height
  // as a custom property leaves that reservation behind when the bar is removed,
  // frozen at whatever the live session measured, and every rule reading the
  // property keeps holding space for something that is gone. Zero it at the root
  // in a stylesheet, so the reclaimed value travels with the serialized document
  // instead of living only in this session.
  const reclaimedSpace = new Set<string>();
  let reclaimedSheet: HTMLStyleElement | null = null;
  const reclaimReservedSpace = (rule: CleanupRule): string[] | undefined => {
    const reclaimed: string[] = [];
    for (const name of rule.reclaimVariables ?? []) {
      if (reclaimedSpace.has(name)) continue;
      // An undeclared property reserves nothing here, and declaring it would
      // instead override the `var(--name, fallback)` its readers rely on.
      const declared = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (!declared || parseFloat(declared) === 0) continue;
      reclaimedSpace.add(name);
      reclaimed.push(name);
    }
    if (!reclaimed.length) return undefined;
    if (!reclaimedSheet) {
      reclaimedSheet = document.createElement('style');
      reclaimedSheet.setAttribute('data-dla-reclaimed-space', '');
      (document.head ?? document.documentElement).append(reclaimedSheet);
    }
    reclaimedSheet.textContent = `:root{${[...reclaimedSpace].map((name) => `${name}:0px!important`).join(';')}}`;
    return reclaimed;
  };
  // Providers qualify the verb ("Powered and secured by Wix"), so one optional
  // conjoined word is part of the phrase everywhere it is matched.
  const powered = 'powered(?:\\s+and\\s+\\w+)?\\s+by';
  const creditPhrase = new RegExp(`(?:${powered}|built (?:with|on|by)|created (?:with|using)|website (?:by|built with)|proudly created with)\\s*`, 'i');
  const ownerContent = /©|copyright|all rights reserved/i;
  const promotionText = new RegExp(policy.promotion.text, 'i');
  const promotionSignup = new RegExp(policy.promotion.signup, 'i');
  const builderAffordance = new RegExp(policy.builderChrome.affordance, 'i');
  // Words that describe the offer rather than name who is making it. A token
  // left after this is a candidate brand, and a brand is what owns a domain.
  const genericWords = new Set(['edit', 'made', 'built', 'created', 'designed', 'generated', 'with', 'using',
    'the', 'this', 'your', 'our', 'site', 'sites', 'website', 'page', 'badge', 'close', 'open', 'love',
    'app', 'apps', 'www', 'cdn', 'static', 'media', 'assets', 'images', 'files', 'com', 'net', 'org', 'dev']);
  /**
   * Host-platform builder chrome: a viewport-anchored badge offering to open
   * this page in the tool that produced it. Recognised structurally rather than
   * by brand, so an unknown builder is handled the same as a named one:
   *
   *  - fixed to the viewport, so it is chrome layered over the document rather
   *    than a part of it that the owner placed in the flow;
   *  - its accessible text is short enough to be a badge and makes an authoring
   *    offer naming an entity (wordmarks ship as images, so alt/aria count);
   *  - and that same entity serves an asset or link inside the badge from its
   *    own domain.
   *
   * The last condition is what keeps authored content safe. "Made with love in
   * Brooklyn" names nobody who owns a domain, and an owner's own floating CTA
   * does not load a stranger's wordmark to make its point.
   */
  const builderChrome = (node: Element): boolean => {
    const style = getComputedStyle(node);
    if (style.position !== 'fixed' || style.visibility === 'hidden') return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const label = [node.textContent ?? '', node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? '',
      ...[...node.querySelectorAll('img,[aria-label],[title]')].flatMap((child) =>
        ['alt', 'aria-label', 'title'].map((name) => child.getAttribute(name) ?? ''))]
      .join(' ').replace(/\s+/g, ' ').trim();
    if (label.length > 200 || !builderAffordance.test(label)) return false;
    const brands = [...new Set(label.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [])].filter((word) => !genericWords.has(word));
    if (!brands.length) return false;
    const origin = location.hostname.toLowerCase();
    for (const source of [node, ...node.querySelectorAll('[href],[src]')]) {
      let host: string;
      try { host = new URL(source.getAttribute('href') ?? source.getAttribute('src') ?? '', location.href).hostname.toLowerCase(); }
      catch { continue; }
      // The owner's own infrastructure is not a third party advertising itself.
      if (!host || host === origin || host.endsWith(`.${origin}`) || origin.endsWith(`.${host}`)) continue;
      if (host.split(/[.-]/).some((part) => brands.includes(part))) return true;
    }
    return false;
  };
  const selectorFor = (node: Element) => {
    const parts: string[] = [];
    let current: Element | null = node;
    while (current && parts.length < 6) {
      if (current.id) { parts.unshift(`#${CSS.escape(current.id.slice(0, 120))}`); break; }
      const siblings: Element[] = current.parentElement ? [...current.parentElement.children] : [];
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${siblings.indexOf(current) + 1})`);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const eligible = (node: Element, rule: CleanupRule) => {
    if (rule.hosts) {
      let host: string;
      try { host = new URL(node.getAttribute('href') ?? node.getAttribute('src') ?? '', location.href).hostname; }
      catch { return false; }
      if (!rule.hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
    }
    if (rule.promotion) {
      const text = node.textContent ?? '';
      return getComputedStyle(node).position === 'fixed' && text.length < 600 &&
        promotionText.test(text) && promotionSignup.test(text);
    }
    if (rule.builderChrome) return builderChrome(node);
    if (rule.credit) {
      const text = node.parentElement?.textContent ?? node.textContent ?? '';
      if (node.closest('article,main') && !node.closest('footer,[role="contentinfo"]')) return false;
      return creditPhrase.test(text) && text.length < 1000;
    }
    return true;
  };
  const removeMatching = () => {
    for (const rule of policy.rules) {
      let matches: NodeListOf<Element>;
      try { matches = document.querySelectorAll(rule.selector); }
      catch { if (!report.failures.includes(rule.id)) report.failures.push(rule.id); continue; }
      for (const match of matches) {
        if (!match.isConnected || !eligible(match, rule)) continue;
        if (report.removed >= 1000) { report.truncated = true; report.residual++; return; }
        if (rule.creditText) {
          const brand = rule.creditText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const expression = new RegExp(`(?:proudly\\s+)?(?:${powered}|made\\s+with|built (?:with|on|by)|created (?:with|using)|website by)\\s+${brand}(?:\\.com)?\\b[.!]?`, 'gi');
          const walker = document.createTreeWalker(match, NodeFilter.SHOW_TEXT);
          const nodes: Array<{ node: Node; start: number; text: string }> = [];
          let content = '';
          let text: Node | null;
          while ((text = walker.nextNode())) {
            if (text.parentElement?.closest('script,style,noscript')) continue;
            const value = text.textContent ?? '';
            nodes.push({ node: text, start: content.length, text: value });
            content += value;
          }
          // Credit phrases often span styled spans and an anchor. Remove only
          // their text ranges, preserving surrounding copyright and markup.
          for (const found of [...content.matchAll(expression)].reverse()) {
            if (report.removed >= 1000) { report.truncated = true; report.residual++; return; }
            const start = found.index;
            const end = start + found[0].length;
            for (const item of nodes) {
              const from = Math.max(0, start - item.start);
              const to = Math.min(item.text.length, end - item.start);
              if (from >= to) continue;
              const value = item.node.textContent ?? '';
              item.node.textContent = value.slice(0, from) + value.slice(to);
              const anchor = item.node.parentElement?.closest('a');
              if (anchor && !anchor.textContent?.trim() && !anchor.querySelector('img,svg')) { orphanIdsIn(anchor); anchor.remove(); }
            }
            report.removed++;
            if (report.records.length < 200) report.records.push({ rule: rule.id, category: rule.category, selector: selectorFor(match), text: found[0].slice(0, 160), action: 'remove-credit-text', reclaimedBodyPadding: false });
            else report.truncated = true;
          }
          continue;
        }
        let node = match;
        if (rule.credit) {
          // Remove a dedicated credit line, but never the owner's whole footer.
          const parent = node.parentElement;
          if (parent && /^(P|SPAN|DIV)$/.test(parent.tagName) &&
            (parent.textContent?.length ?? 0) < 240 && creditPhrase.test(parent.textContent ?? '') &&
            !ownerContent.test(parent.textContent ?? '') && parent.querySelectorAll('a').length === 1 &&
            !parent.querySelector('img,video,form,input,button')) node = parent;
          else {
            const previous = node.previousSibling;
            if (previous?.nodeType === Node.TEXT_NODE) previous.textContent = (previous.textContent ?? '').replace(new RegExp(`(?:${powered}|built (?:with|on|by)|created (?:with|using)|proudly created with)\\s*$`, 'i'), '');
          }
        }
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        let reclaimedBodyPadding = false;
        if (style.position === 'fixed') {
          for (const side of ['top', 'bottom'] as const) {
            const property = side === 'top' ? 'padding-top' : 'padding-bottom';
            if (parseFloat(style[side]) === 0 && rect.height > 0 &&
              Math.abs(parseFloat(getComputedStyle(document.body).getPropertyValue(property)) - rect.height) < 1) {
              document.body.style.setProperty(property, '0px', 'important');
              reclaimedBodyPadding = true;
            }
          }
        }
        const reclaimedVariables = reclaimReservedSpace(rule);
        if (report.records.length < 200) report.records.push({ rule: rule.id, category: rule.category,
          selector: selectorFor(node), text: (node.textContent ?? '').trim().slice(0, 160), action: 'remove', reclaimedBodyPadding, ...(reclaimedVariables ? { reclaimedVariables } : {}) });
        else report.truncated = true;
        let parent = node.parentElement;
        orphanIdsIn(node);
        node.remove();
        report.removed++;
        // Reclaim an ad-only wrapper, never a content landmark or mixed container.
        if (rule.category === 'advertisement') for (let depth = 0; depth < 4 && parent; depth++) {
          if (!/^(DIV|SPAN|ASIDE)$/.test(parent.tagName) || parent.children.length ||
            !/^(?:advertisement|advertising|sponsored)?$/i.test((parent.textContent ?? '').trim())) break;
          const ancestor = parent.parentElement;
          orphanIdsIn(parent);
          parent.remove();
          parent = ancestor;
        }
      }
    }
  };
  const sweep = () => { removeMatching(); stripOrphanedCss(); };
  sweep();
  let scheduled = false;
  let rounds = 0;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    // Exhausting the observation budget on an animating page (sliders, lazy
    // images, entrance transitions) says nothing about cleanliness: it only
    // means the observer stopped watching. `readSourceCleanup()` still runs
    // an authoritative final sweep, so this stays a diagnostic in `truncated`
    // rather than a `failures` entry that would fail an otherwise-clean copy.
    if (++rounds > 100) { report.truncated = true; observer.disconnect(); return; }
    scheduled = true;
    queueMicrotask(() => { scheduled = false; sweep(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'id', 'src', 'href', 'data-ad-slot'] });
  host.__dlaCleanup = { report, observer, sweep };
  return report;
}

export async function applySourceCleanup(page: Page, policy: CleanupPolicy): Promise<CleanupReport> {
  validateCleanupPolicy(policy);
  return page.evaluate(installCleanupInPage, policy);
}

export async function readSourceCleanup(page: Page): Promise<CleanupReport> {
  return page.evaluate(() => {
    const state = (window as unknown as { __dlaCleanup?: { report: CleanupReport; sweep: () => void } }).__dlaCleanup;
    if (!state) throw new Error('Source cleanup evidence is missing');
    state.sweep();
    state.report.unknowns = [];
    const frames = document.querySelectorAll('iframe,object,embed').length;
    if (frames) state.report.unknowns.push(`${frames} retained embedded surface(s) were not inspected internally for advertising`);
    const shadows = [...document.querySelectorAll('*')].filter((node) => node.shadowRoot).length;
    if (shadows) state.report.unknowns.push(`${shadows} shadow root(s) were not inspected internally`);
    return state.report;
  });
}
