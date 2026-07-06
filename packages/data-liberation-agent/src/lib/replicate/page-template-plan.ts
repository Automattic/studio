//
// page-template-plan.ts
// =====================
// PURE template-collapse logic for the blocks reconstruct path. A page's TEMPLATE
// is a function of two booleans only — overlayHeader (transparent header over a
// flush cover hero) and fullWidth (a non-chrome full-bleed section) — so N pages
// need at most 4 distinct templates, not N. This module computes the variant,
// plans the deduped named templates + per-page assignments, reconciles stale
// files, and merges theme.json customTemplates. The key is shaped so a future
// chrome-signature axis can extend it without reworking callers.
//
import type { SectionSpec } from './section-extract.js';

export type VariantKey = 'standard' | 'full' | 'overlay' | 'overlay-full';

export interface TemplateVariant {
  overlayHeader: boolean;
  fullWidth: boolean;
  key: VariantKey;
}

const SOURCE_HEADER_ABOVE_PX = 40;

/** Derive the page-template variant. `heroIsCover` comes from the reconstruction
 *  result (NOT the specs), so it must be passed in. Mirrors the original inline
 *  logic at reconstruct-pages.ts:188-206. */
export function computeTemplateVariant(sections: SectionSpec[], heroIsCover: boolean): TemplateVariant {
  const fullWidth = sections.some(
    (s) => s.fullBleed && s.interactionModel !== 'footer' && s.interactionModel !== 'nav',
  );
  const bodyForHeader = sections.filter(
    (s) => s.interactionModel !== 'footer' && s.interactionModel !== 'nav',
  );
  const heroTop = bodyForHeader.length ? bodyForHeader[0].top ?? 0 : 0;
  const overlayHeader = heroIsCover && heroTop < SOURCE_HEADER_ABOVE_PX;
  return { overlayHeader, fullWidth, key: variantKey(overlayHeader, fullWidth) };
}

function variantKey(overlayHeader: boolean, fullWidth: boolean): VariantKey {
  if (overlayHeader && fullWidth) return 'overlay-full';
  if (overlayHeader) return 'overlay';
  if (fullWidth) return 'full';
  return 'standard';
}

/** The WP template slug for a variant. `standard` is the bare `page-replica`. */
export function variantTemplateSlug(key: VariantKey): string {
  return key === 'standard' ? 'page-replica' : `page-replica-${key}`;
}

export interface PlannedPage {
  slug: string;
  isHome: boolean;
  variant: TemplateVariant;
}

export interface TemplatePlan {
  /** Variant template files to write (theme-relative path + content). */
  templates: { relativePath: string; content: string }[];
  /** theme.json customTemplates entries for the variant templates. */
  customTemplates: { name: string; title: string; postTypes: string[] }[];
  /** slug → template slug for every NON-home reconstructed page. */
  assignments: Map<string, string>;
  /** The page-replica* slugs this run wants to exist. */
  desiredTemplateSlugs: Set<string>;
  /** Slugs appearing more than once among reconstructed pages (logged). */
  duplicateSlugs: string[];
}

const VARIANT_TITLE: Record<VariantKey, string> = {
  standard: 'Replica — Standard',
  full: 'Replica — Full width',
  overlay: 'Replica — Overlay header',
  'overlay-full': 'Replica — Overlay + full width',
};
// Stable order so output is deterministic regardless of input page order.
const KEY_ORDER: VariantKey[] = ['standard', 'full', 'overlay', 'overlay-full'];

export function planPageTemplates(
  pages: PlannedPage[],
  renderTemplate: (v: TemplateVariant) => string,
): TemplatePlan {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const p of pages) {
    if (seen.has(p.slug)) dup.add(p.slug);
    seen.add(p.slug);
  }

  const nonHome = pages.filter((p) => !p.isHome);
  const variantByKey = new Map<VariantKey, TemplateVariant>();
  const assignments = new Map<string, string>();
  for (const p of nonHome) {
    variantByKey.set(p.variant.key, p.variant);
    assignments.set(p.slug, variantTemplateSlug(p.variant.key));
  }

  const presentKeys = KEY_ORDER.filter((k) => variantByKey.has(k));
  const templates = presentKeys.map((k) => ({
    relativePath: `templates/${variantTemplateSlug(k)}.html`,
    content: renderTemplate(variantByKey.get(k)!),
  }));
  const customTemplates = presentKeys.map((k) => ({
    name: variantTemplateSlug(k),
    title: VARIANT_TITLE[k],
    postTypes: ['page', 'post'],
  }));
  const desiredTemplateSlugs = new Set(presentKeys.map((k) => variantTemplateSlug(k)));

  return { templates, customTemplates, assignments, desiredTemplateSlugs, duplicateSlugs: [...dup] };
}

/** Decide which page-replica* templates to write vs delete. The `stillReferenced`
 *  set (variant slugs any page — including ones excluded this run — is still
 *  assigned to) is NEVER deleted, so a transient extract failure can't strand a
 *  page on a deleted template (Issue 2 guard). */
export function reconcileReplicaTemplates(
  existingReplicaSlugs: string[],
  desiredSlugs: Set<string>,
  stillReferenced: Set<string>,
): { write: string[]; delete: string[] } {
  const keep = new Set<string>([...desiredSlugs, ...stillReferenced]);
  return {
    write: [...desiredSlugs],
    delete: existingReplicaSlugs.filter((s) => !keep.has(s)),
  };
}

/** Merge variant customTemplates into a theme.json STRING. Prunes any prior
 *  `page-replica*` entries (idempotent), preserves all other keys, and re-serializes.
 *  Throws on malformed input — the caller must fail loud (a broken theme.json
 *  breaks the whole theme). Indentation matches the scaffold (2 spaces). */
export function mergeCustomTemplates(
  themeJsonText: string,
  customTemplates: { name: string; title: string; postTypes: string[] }[],
): string {
  const json = JSON.parse(themeJsonText) as Record<string, unknown>;
  const existing = Array.isArray(json.customTemplates) ? (json.customTemplates as { name?: string }[]) : [];
  const kept = existing.filter((e) => !String(e?.name ?? '').startsWith('page-replica'));
  json.customTemplates = [...kept, ...customTemplates];
  return JSON.stringify(json, null, 2) + '\n';
}
