export type SectionRole = 'body' | 'header' | 'nav' | 'footer';

export interface LocalPage {
  /** Path relative to the site root, e.g. "index.html" or "blog/post.html". */
  relPath: string;
  /** Stable slug derived from relPath ("index.html" → "home"). */
  slug: string;
  /** Raw HTML as read from disk. */
  html: string;
  /** <title> text, trimmed; "" when absent. */
  title: string;
  /** body data-* attributes (keys WITHOUT the data- prefix) — JS-rendered
   * sites key runtime behavior off them; replayed by the theme's
   * wp_body_open shim. Absent when the body carries none. */
  bodyData?: Record<string, string>;
}

export interface LocalSite {
  root: string;
  pages: LocalPage[];
}

export interface NavLink {
  fromSlug: string;
  toSlug: string;
  label: string;
  /** True when the anchor sits inside a <nav> element — preferred for menus. */
  inNav?: boolean;
}

export interface Section {
  /** Stable, deterministic id (existing id/class, heading slug, or content hash). */
  id: string;
  role: SectionRole;
  /** Chrome inferred structurally rather than from a body-direct landmark. */
  chromeSource?: 'layout-rail';
  /** outerHTML of the section element. */
  html: string;
  /** The source element's class list, in order — preserved onto the emitted
   * block wrapper so carried source CSS keeps matching (stage 1d). */
  classes?: string[];
  /** nativeBehaviors: when set, the emitter swaps the core/group wrapper for
   * the matching custom Interactivity block (dla/<kind>). Section-level only;
   * chrome behaviors (sticky) ride HeaderPartOpts instead. reveal is uniform
   * (every body section); tabs/slider/modal are DOM-pattern-detected per
   * section and take precedence over reveal (one behavior per section). */
  behavior?: SectionBehavior;
}

export interface NormalizeReportEntry {
  sectionId: string;
  blockType: string;
  /** 1 = clean deterministic mapping; <1 = a fallback was used. */
  confidence: number;
}

/** Detected source behavior mapped to a custom Interactivity block (Plan A catalog). */
export interface RevealBehavior {
  kind: 'reveal';
  /** IntersectionObserver threshold parsed from source JS; default 0.12. */
  threshold: number;
  /** Source animation params mirrored into the block's scoped CSS. */
  translateY: string;
  durationMs: number;
}

export interface StickyBehavior {
  kind: 'sticky';
  /** Class the source scroll listener toggles (e.g. "is-scrolled"). */
  toggleClass: string;
  /** scrollY threshold (px) parsed from source JS; default 8. */
  offset: number;
}

export interface TabsBehavior {
  kind: 'tabs';
  /** Source-authored class the JS toggles on the active tab. */
  activeClass: string;
}

export interface SliderBehavior {
  kind: 'slider';
  /** Source-authored class marking the active slide. */
  activeClass: string;
  /** Autoplay interval parsed from setInterval(..., N); absent = no autoplay. */
  intervalMs?: number;
}

export interface ModalBehavior {
  kind: 'modal';
}

/** Per-section behavior tag — the emitter swaps the wrapper block by kind. */
export type SectionBehavior = RevealBehavior | TabsBehavior | SliderBehavior | ModalBehavior;

/** Non-catalog source JS behavior — reported, never guessed (spec §6 fallback). */
export interface BehaviorGap {
  pattern: string;
  jsExcerpt: string;
}

export interface DetectedBehaviors {
  reveal?: RevealBehavior;
  sticky?: StickyBehavior;
  gaps: BehaviorGap[];
}
