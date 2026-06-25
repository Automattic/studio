// src/lib/replicate/normalize/detect-behaviors.ts
//
// Pure, deterministic detection of catalog source behaviors (spec §4b, Plan A:
// reveal + sticky). Regex heuristics over the CONCATENATED source css/js — the
// same strings collectSourceAssets produces. Narrow on purpose: a behavior is
// tagged only when BOTH its JS driver and its CSS effect are present; anything
// else in the JS is reported as a behavior-gap, never guessed (spec §6).
//
// Residue heuristic: the JS is split into top-level statements (`;` at
// brace/paren depth 0; string-, comment-, and regex-literal-aware) and each
// statement is classified against the DETECTED behaviors' driver regexes.
// Unclaimed statements with meaningful (comment-stripped, above-floor) code
// collapse into ONE `uncatalogued-js` gap with an excerpt — coarse by design;
// no precise JS slicing is attempted.
import * as cheerio from 'cheerio';
import type {
  BehaviorGap,
  DetectedBehaviors,
  ModalBehavior,
  RevealBehavior,
  SectionBehavior,
  SliderBehavior,
  StickyBehavior,
  TabsBehavior,
} from '../local-site/types.js';

/** Minimal structural slice of local-theme SourceAssets — a full SourceAssets
 * satisfies this, but normalize/ must not depend on local-theme/. */
export interface BehaviorSourceAssets {
  /** All source CSS concatenated. */
  css: string;
  /** All source JS concatenated. */
  js: string;
}

// --- reveal (IntersectionObserver scroll-reveal) -----------------------------
const IO_RE = /new\s+IntersectionObserver\s*\(/;
const IO_ADD_CLASS_RE = /classList\.add\(\s*['"][a-zA-Z0-9_-]+['"]\s*\)/;
const IO_THRESHOLD_RE = /threshold\s*:\s*([0-9.]+)/;
/** Wiring statements like `obs.observe(el)` / `obs.unobserve(el)`. NOTE: once
 * reveal is detected this also claims bystander ResizeObserver/MutationObserver
 * `.observe(` wiring — the gap COUNT survives, its content is partial
 * (accepted v1 narrowness). */
const OBSERVE_CALL_RE = /\.(?:un)?observe\s*\(/;
/** CSS gate AND param source: the first `html.js section` rule whose body
 * hides sections (opacity:0). Captures the rule BODY so translateY/duration
 * parse from the gate rule only — earlier unrelated transition/transform
 * rules (nav hover etc.) must not leak into the reveal params. */
const REVEAL_GATE_BODY_RE = /html\.js\s+section[^{]*\{([^}]*opacity\s*:\s*0[^}]*)\}/;
const TRANSLATE_Y_RE = /translateY\(\s*(-?[0-9.]+(?:px|rem|em|%))\s*\)/;
const DURATION_RE = /transition\s*:[^;}]*?([0-9.]+)(ms|s)\b/;

const DEFAULT_THRESHOLD = 0.12;
const DEFAULT_DURATION_MS = 600;

// --- sticky (scroll-reactive class toggle) -----------------------------------
const SCROLL_LISTENER_RE = /addEventListener\s*\(\s*['"]scroll['"]/;
const TOGGLE_CLASS_RE = /classList\.toggle\(\s*['"]([a-zA-Z0-9_-]+)['"]/;
const SCROLL_OFFSET_RE = /scrollY\s*>\s*([0-9]+)/;

const DEFAULT_STICKY_OFFSET = 8;

// --- B1 per-section behaviors (tabs / slider / modal) -------------------------
// DOM-pattern-first (spec §4b) over the SECTION's own markup, confirmed by a
// JS driver in the global source JS (the Plan A both-halves rule: a static
// pattern without its driver renders its authored state — wrapping it with
// behavior would CHANGE appearance).
const CLICK_LISTENER_RE = /addEventListener\s*\(\s*['"]click['"]/;
const TAB_DRIVER_RE = /\[role=["']tab["']\]/;
const SHOW_MODAL_RE = /\.showModal\s*\(/;
const SET_INTERVAL_RE = /setInterval\s*\([^,]*,\s*([0-9]+)\s*\)/;
/** Slider control wiring: '.next'/'.prev' selectors or data attrs. */
const SLIDER_CONTROL_RE = /['"][^'"]*\.(?:next|prev)['"]|\[data-(?:next|prev)\]/;
/** Every classList mutation in the js, in source order — candidates for the
 * source-authored active class; filtered by presence in the section markup. */
const CLASS_MUTATION_RE = /classList\.(?:add|remove|toggle)\(\s*['"]([a-zA-Z0-9_-]+)['"]/g;

const EXCERPT_MAX = 200;
/** Residue below this many comment-stripped chars (total) is noise — license
 * headers, stray semicolons — not a reportable behavior gap. */
const MIN_GAP_CODE_CHARS = 20;

interface TopLevelStatement {
  /** Verbatim source slice — used for the gap excerpt. */
  raw: string;
  /** Comment-stripped text — used for classification + the residue floor. */
  code: string;
}

/** Chars after which a `/` opens a regex literal (standard prev-token
 * heuristic), alongside start-of-statement and the `return` keyword. `{`/`[`
 * are included: a `/` directly after either cannot be division. */
const REGEX_PRECEDERS = new Set(['=', '(', ',', ':', ';', '!', '&', '|', '?', '{', '[']);

/**
 * Split JS into top-level statements: `;` at bracket depth 0, skipping
 * strings, template literals, comments, and regex literals (prev-token
 * heuristic, `[...]` classes honored; a newline inside aborts the regex scan
 * — literals cannot span lines). Known limitations, accepted for a coarse
 * residue pass:
 * - ASI: a semicolon-less statement merges into the following chunk.
 * - Merged chunks classify as a unit: a driver+gap merge is CLAIMED WHOLESALE
 *   once its behavior is detected, so the gap inside it is silently lost.
 */
function splitTopLevelStatements(js: string): TopLevelStatement[] {
  const out: TopLevelStatement[] = [];
  const n = js.length;
  let start = 0;
  let depth = 0;
  let code = '';
  let i = 0;

  const push = (end: number): void => {
    const raw = js.slice(start, end).trim();
    const stripped = code.trim();
    // Comment-only / empty chunks never reach residue.
    if (raw && stripped) out.push({ raw, code: stripped });
    code = '';
  };

  const regexFollows = (): boolean => {
    const sig = code.trimEnd();
    if (!sig) return true; // start of statement
    if (/\breturn$/.test(sig)) return true;
    return REGEX_PRECEDERS.has(sig[sig.length - 1]);
  };

  while (i < n) {
    const ch = js[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const from = i;
      const quote = ch;
      i++;
      while (i < n && js[i] !== quote) {
        if (js[i] === '\\') i++; // skip escaped char
        i++;
      }
      i++; // past closing quote
      code += js.slice(from, i);
      continue;
    }
    if (ch === '/' && js[i + 1] === '/') {
      while (i < n && js[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && js[i + 1] === '*') {
      i += 2;
      while (i < n && !(js[i] === '*' && js[i + 1] === '/')) i++;
      i += 2;
      code += ' '; // token separator where the comment sat
      continue;
    }
    if (ch === '/' && regexFollows()) {
      const from = i;
      i++; // past opening '/'
      let inClass = false;
      while (i < n) {
        const c = js[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '\n') break; // not a regex after all — keep run as plain text
        if (inClass) {
          if (c === ']') inClass = false;
        } else if (c === '[') {
          inClass = true;
        } else if (c === '/') {
          i++; // past closing '/'
          break;
        }
        i++;
      }
      while (i < n && /[a-z]/i.test(js[i])) i++; // flags
      code += js.slice(from, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ';' && depth === 0) {
      push(i);
      start = i + 1;
      i++;
      continue;
    }
    code += ch;
    i++;
  }
  if (start < n) push(n);
  return out;
}

/** One-line, length-capped excerpt for gap reporting. */
function toExcerpt(code: string): string {
  const collapsed = code.replace(/\s+/g, ' ').trim();
  return collapsed.length > EXCERPT_MAX ? `${collapsed.slice(0, EXCERPT_MAX)}...` : collapsed;
}

/** Statement participates in the reveal driver (observer ctor or observe wiring). */
function isRevealDriverStatement(code: string): boolean {
  return IO_RE.test(code) || OBSERVE_CALL_RE.test(code);
}

/** Statement participates in the sticky driver (scroll listener). */
function isStickyDriverStatement(code: string): boolean {
  return SCROLL_LISTENER_RE.test(code);
}

function detectReveal(css: string, revealJs: string): RevealBehavior | undefined {
  if (!IO_RE.test(revealJs) || !IO_ADD_CLASS_RE.test(revealJs)) return undefined;
  const gateBody = REVEAL_GATE_BODY_RE.exec(css)?.[1];
  if (gateBody === undefined) return undefined;
  const threshold = Number(IO_THRESHOLD_RE.exec(revealJs)?.[1] ?? DEFAULT_THRESHOLD);
  // Params come from the GATE RULE BODY only, defaults on absence.
  const translateY = TRANSLATE_Y_RE.exec(gateBody)?.[1] ?? '0px';
  const durationMatch = DURATION_RE.exec(gateBody);
  const durationMs = durationMatch
    ? durationMatch[2] === 'ms'
      ? Number(durationMatch[1])
      : Number(durationMatch[1]) * 1000
    : DEFAULT_DURATION_MS;
  return { kind: 'reveal', threshold, translateY, durationMs };
}

function detectSticky(css: string, stickyJs: string): StickyBehavior | undefined {
  if (!SCROLL_LISTENER_RE.test(stickyJs)) return undefined;
  const toggleClass = TOGGLE_CLASS_RE.exec(stickyJs)?.[1];
  if (!toggleClass) return undefined;
  // toggleClass is capture-constrained to [a-zA-Z0-9_-]+ — every char is
  // regex-literal, so direct interpolation is safe.
  if (!new RegExp(`\\.${toggleClass}[\\s.,{[:>]`).test(css)) return undefined;
  const offset = Number(SCROLL_OFFSET_RE.exec(stickyJs)?.[1] ?? DEFAULT_STICKY_OFFSET);
  return { kind: 'sticky', toggleClass, offset };
}

/** First classList-mutation class that exists as a class IN the section
 * markup, scanning ONLY statements that match the kind's own driver regexes —
 * double tie (driver statement AND section markup). A whole-js scan was
 * defeated by one stray class: a static `is-active` badge in a card section
 * plus an unrelated `setInterval(updateClock, 1000)` produced a false slider
 * that would reshuffle real content every second (review probe E). Scoping
 * the class search to driver statements removes both that and the
 * cross-section wrong-param capture (probe B). */
function activeClassFor(
  $: cheerio.CheerioAPI,
  js: string,
  driverRes: RegExp[],
): string | undefined {
  const driverJs = splitTopLevelStatements(js)
    .filter((s) => driverRes.some((re) => re.test(s.code)))
    .map((s) => s.code)
    .join('\n');
  for (const m of driverJs.matchAll(CLASS_MUTATION_RE)) {
    if ($(`.${m[1]}`).length > 0) return m[1];
  }
  return undefined;
}

/** True when some parent in the section has ≥2 element children sharing a
 * class — the structural carousel signal (a track of same-class slides). */
function hasSlideGroup($: cheerio.CheerioAPI): boolean {
  let found = false;
  $('*').each((_, el) => {
    if (found) return;
    const counts = new Map<string, number>();
    $(el)
      .children('[class]')
      .each((__, child) => {
        for (const c of ($(child).attr('class') ?? '').split(/\s+/).filter(Boolean)) {
          const n = (counts.get(c) ?? 0) + 1;
          counts.set(c, n);
          if (n >= 2) found = true;
        }
      });
  });
  return found;
}

/**
 * Per-section detection (B1): DOM pattern in the section markup AND a js
 * driver in the global source. Dispatch order modal → tabs → slider:
 * most-specific DOM signal first (a tablist also has same-class children;
 * order keeps it from misreading as a slider).
 */
export function detectSectionBehavior(
  sectionHtml: string,
  assets: BehaviorSourceAssets,
): SectionBehavior | undefined {
  const $ = cheerio.load(sectionHtml);
  // modal: dialog (or aria-modal) + a trigger button + a showModal driver.
  // Driverless dialog returns undefined EARLY (no fall-through to tabs/
  // slider): early-return fails toward UNTAGGED — the static markup renders
  // its authored state — whereas falling through could mis-tag the section.
  // Rare loss case (decorative driverless dialog suppressing real tabs in
  // the SAME section) stays honest: the tabs driver js lands in the gap
  // report when tabs fired nowhere else.
  if ($('dialog, [aria-modal="true"]').length > 0 && $('button').length > 0) {
    if (SHOW_MODAL_RE.test(assets.js)) return { kind: 'modal' } satisfies ModalBehavior;
    return undefined;
  }
  // tabs: the full role triad + a click driver that touches [role=tab].
  if (
    $('[role="tablist"]').length > 0 &&
    $('[role="tab"]').length >= 2 &&
    $('[role="tabpanel"]').length >= 2
  ) {
    if (!TAB_DRIVER_RE.test(assets.js) || !CLICK_LISTENER_RE.test(assets.js)) return undefined;
    const activeClass = activeClassFor($, assets.js, [TAB_DRIVER_RE]) ?? 'is-active';
    return { kind: 'tabs', activeClass } satisfies TabsBehavior;
  }
  // slider: a same-class slide group + controls/autoplay driver, with the
  // active class proven against BOTH a slider-driver statement and this
  // section's markup (the double tie — see activeClassFor).
  if (hasSlideGroup($)) {
    const hasControls = SLIDER_CONTROL_RE.test(assets.js);
    const intervalMatch = SET_INTERVAL_RE.exec(assets.js);
    if (!hasControls && !intervalMatch) return undefined;
    const activeClass = activeClassFor($, assets.js, [SLIDER_CONTROL_RE, SET_INTERVAL_RE]);
    if (!activeClass) return undefined;
    const slider: SliderBehavior = { kind: 'slider', activeClass };
    if (intervalMatch) slider.intervalMs = Number(intervalMatch[1]);
    return slider;
  }
  return undefined;
}

/** Claiming predicates for the per-section kinds — used ONLY for residue
 * accounting, gated on the kinds the handler actually detected (never-guess:
 * an undetected kind's driver js stays in the gap report). */
/** NOTE bounded over-claim (mirrors OBSERVE_CALL_RE's accepted narrowness):
 * once slider fires, a bystander `setInterval(updateClock, 1000)` statement
 * is claimed too — the gap COUNT survives, its content is partial. Modal
 * claiming is showModal-only (a bare "dialog" mention proved too broad —
 * review probe F claimed an analytics string). */
const SECTION_DRIVER_RES: Record<'tabs' | 'slider' | 'modal', RegExp[]> = {
  tabs: [TAB_DRIVER_RE],
  slider: [/setInterval\s*\(/, SLIDER_CONTROL_RE],
  modal: [SHOW_MODAL_RE],
};

export interface DetectBehaviorsOpts {
  /** Per-section kinds that fired (from compose reports) — their driver
   * statements are claimed out of the gap residue. */
  sectionKinds?: Set<'tabs' | 'slider' | 'modal'>;
}

/**
 * Detect Plan A catalog behaviors in the concatenated source assets.
 * `reveal`/`sticky` keys are present ONLY when detected; `gaps` always is.
 */
export function detectBehaviors(
  { css, js }: BehaviorSourceAssets,
  opts: DetectBehaviorsOpts = {},
): DetectedBehaviors {
  const statements = splitTopLevelStatements(js);

  // Detect against ONLY the driver statements so params (threshold, toggle
  // class, offset) are read from the behavior's own code, not bystander JS.
  const revealJs = statements
    .filter((s) => isRevealDriverStatement(s.code))
    .map((s) => s.code)
    .join('\n');
  const stickyJs = statements
    .filter((s) => isStickyDriverStatement(s.code))
    .map((s) => s.code)
    .join('\n');
  const reveal = detectReveal(css, revealJs);
  const sticky = detectSticky(css, stickyJs);

  // A statement is claimed only by a DETECTED behavior — driver JS whose CSS
  // half is missing stays residue, so the gap report still surfaces it. The
  // per-section kinds (tabs/slider/modal) are claimed only when the handler
  // says their pattern fired somewhere (opts.sectionKinds).
  const kinds = opts.sectionKinds ?? new Set<never>();
  const isSectionDriverStatement = (code: string): boolean => {
    for (const kind of kinds) {
      if (SECTION_DRIVER_RES[kind].some((re) => re.test(code))) return true;
    }
    return false;
  };
  const residue = statements.filter(
    (s) =>
      !(reveal && isRevealDriverStatement(s.code)) &&
      !(sticky && isStickyDriverStatement(s.code)) &&
      !isSectionDriverStatement(s.code),
  );
  const residueCodeChars = residue.reduce((sum, s) => sum + s.code.length, 0);
  const gaps: BehaviorGap[] =
    residueCodeChars >= MIN_GAP_CODE_CHARS
      ? [
          {
            pattern: 'uncatalogued-js',
            jsExcerpt: toExcerpt(residue.map((s) => s.raw).join(' ')),
          },
        ]
      : [];

  const detected: DetectedBehaviors = { gaps };
  if (reveal) detected.reveal = reveal;
  if (sticky) detected.sticky = sticky;
  return detected;
}
