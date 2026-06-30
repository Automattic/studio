export const CHROME_FIDELITY_SCHEMA = 1;

/** Fixed allowlist of computed-style properties the audit may correct. Bounded on
 *  purpose: corrections only ever copy the source's value for one of these. */
export const CHROME_AUDIT_PROPERTIES = [
  'display', 'opacity', 'visibility',
  'font-size', 'line-height', 'text-decoration-line', 'color', 'font-weight', 'letter-spacing',
  'margin', 'padding',
] as const;
export type ChromeAuditProperty = (typeof CHROME_AUDIT_PROPERTIES)[number];

export type ChromeRegion = 'header' | 'footer' | 'nav';

export interface ChromeFidelityEntry {
  /** Canonical structural key (region + dom-path index + tag + normalized class signature). */
  key: string;
  props: Partial<Record<ChromeAuditProperty, string>>;
  box: { w: number; h: number };
}
export interface ChromeFidelity {
  schema: number;
  sourceUrl: string;
  regions: Partial<Record<ChromeRegion, ChromeFidelityEntry[]>>;
}
export interface ChromeCorrection {
  region: ChromeRegion;
  selector: string;
  property: ChromeAuditProperty;
  from: string;
  to: string;
}
