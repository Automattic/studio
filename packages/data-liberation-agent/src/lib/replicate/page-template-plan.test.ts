import { describe, it, expect } from 'vitest';
import { computeTemplateVariant, variantTemplateSlug } from './page-template-plan.js';
import type { SectionSpec } from './section-extract.js';

// Minimal fictional section. Only the fields the variant calc reads matter.
function section(p: Partial<SectionSpec>): SectionSpec {
  return { selector: '#s', interactionModel: 'static', top: 200, fullBleed: false, ...(p as object) } as SectionSpec;
}

describe('computeTemplateVariant', () => {
  it('standard: boxed content, no cover hero', () => {
    const v = computeTemplateVariant([section({ top: 200 })], /* heroIsCover */ false);
    expect(v).toEqual({ overlayHeader: false, fullWidth: false, key: 'standard' });
  });

  it('full: a non-chrome full-bleed section drives full width', () => {
    const v = computeTemplateVariant([section({ fullBleed: true, interactionModel: 'static' })], false);
    expect(v.fullWidth).toBe(true);
    expect(v.key).toBe('full');
  });

  it('full-bleed footer/nav does NOT trigger full width', () => {
    const v = computeTemplateVariant([section({ fullBleed: true, interactionModel: 'footer' })], false);
    expect(v.fullWidth).toBe(false);
  });

  it('overlay: cover hero flush at the page top', () => {
    const v = computeTemplateVariant([section({ top: 0, fullBleed: true })], true);
    expect(v).toEqual({ overlayHeader: true, fullWidth: true, key: 'overlay-full' });
  });

  it('NO overlay when the source hero sits below a header (heroTop >= 40)', () => {
    const v = computeTemplateVariant([section({ top: 93, fullBleed: false })], true);
    expect(v.overlayHeader).toBe(false);
  });

  it('overlay (not full): cover hero at top with boxed body', () => {
    const v = computeTemplateVariant([section({ top: 0, fullBleed: false })], true);
    expect(v).toEqual({ overlayHeader: true, fullWidth: false, key: 'overlay' });
  });
});

describe('variantTemplateSlug', () => {
  it('standard maps to the bare page-replica slug', () => {
    expect(variantTemplateSlug('standard')).toBe('page-replica');
  });
  it('non-standard keys are suffixed', () => {
    expect(variantTemplateSlug('full')).toBe('page-replica-full');
    expect(variantTemplateSlug('overlay-full')).toBe('page-replica-overlay-full');
  });
});

import { planPageTemplates, reconcileReplicaTemplates } from './page-template-plan.js';
import type { TemplateVariant } from './page-template-plan.js';

const V = (key: TemplateVariant['key']): TemplateVariant => ({
  overlayHeader: key.includes('overlay'),
  fullWidth: key.includes('full'),
  key,
});
// Fictional renderer: encodes the variant so identical variants produce identical content.
const render = (v: TemplateVariant) => `TPL:${v.key}`;

describe('planPageTemplates', () => {
  it('one variant across N pages → one template, N assignments, no home assignment', () => {
    const plan = planPageTemplates([
      { slug: 'home', isHome: true, variant: V('overlay-full') },
      { slug: 'about', isHome: false, variant: V('standard') },
      { slug: 'team', isHome: false, variant: V('standard') },
    ], render);
    expect(plan.templates.map((t) => t.relativePath)).toEqual(['templates/page-replica.html']);
    expect(plan.assignments.get('about')).toBe('page-replica');
    expect(plan.assignments.get('team')).toBe('page-replica');
    expect(plan.assignments.has('home')).toBe(false); // home → front-page.html
    expect(plan.customTemplates).toEqual([
      { name: 'page-replica', title: 'Replica — Standard', postTypes: ['page', 'post'] },
    ]);
  });

  it('CORE REGRESSION: two same-variant pages share one template file + content', () => {
    const plan = planPageTemplates([
      { slug: 'shop', isHome: false, variant: V('full') },
      { slug: 'faq', isHome: false, variant: V('full') },
    ], render);
    expect(plan.templates).toHaveLength(1);
    expect(plan.templates[0]).toEqual({ relativePath: 'templates/page-replica-full.html', content: 'TPL:full' });
    expect(plan.assignments.get('shop')).toBe('page-replica-full');
    expect(plan.assignments.get('faq')).toBe('page-replica-full');
  });

  it('mixed variants → one template per distinct non-home variant', () => {
    const plan = planPageTemplates([
      { slug: 'a', isHome: false, variant: V('standard') },
      { slug: 'b', isHome: false, variant: V('full') },
    ], render);
    expect(plan.desiredTemplateSlugs).toEqual(new Set(['page-replica', 'page-replica-full']));
  });

  it('is deterministic regardless of input order', () => {
    const a = planPageTemplates([
      { slug: 'b', isHome: false, variant: V('full') },
      { slug: 'a', isHome: false, variant: V('standard') },
    ], render);
    const b = planPageTemplates([
      { slug: 'a', isHome: false, variant: V('standard') },
      { slug: 'b', isHome: false, variant: V('full') },
    ], render);
    expect(a.templates).toEqual(b.templates);
    expect(a.customTemplates).toEqual(b.customTemplates);
  });

  it('flags duplicate slugs', () => {
    const plan = planPageTemplates([
      { slug: 'dup', isHome: false, variant: V('standard') },
      { slug: 'dup', isHome: false, variant: V('full') },
    ], render);
    expect(plan.duplicateSlugs).toEqual(['dup']);
  });
});

describe('reconcileReplicaTemplates', () => {
  it('deletes replica templates that are neither planned nor still-referenced', () => {
    const r = reconcileReplicaTemplates(
      ['page-replica', 'page-replica-full', 'page-replica-overlay'],
      new Set(['page-replica']),         // desired this run
      new Set(['page-replica-full']),    // still referenced by an excluded page (Issue 2 guard)
    );
    expect(r.write).toEqual(['page-replica']);
    expect(r.delete).toEqual(['page-replica-overlay']); // kept: replica + full
  });

  it('toggle-off (desired empty, nothing referenced) deletes all replica templates', () => {
    const r = reconcileReplicaTemplates(['page-replica', 'page-replica-full'], new Set(), new Set());
    expect(r.delete.sort()).toEqual(['page-replica', 'page-replica-full']);
  });
});

import { mergeCustomTemplates } from './page-template-plan.js';

describe('mergeCustomTemplates', () => {
  const base = JSON.stringify({ version: 3, customTemplates: [{ name: 'keep-me', title: 'Keep', postTypes: ['page'] }] }, null, 2);

  it('adds replica entries without clobbering non-replica ones', () => {
    const out = JSON.parse(mergeCustomTemplates(base, [{ name: 'page-replica', title: 'Replica — Standard', postTypes: ['page', 'post'] }]));
    expect(out.customTemplates).toContainEqual({ name: 'keep-me', title: 'Keep', postTypes: ['page'] });
    expect(out.customTemplates).toContainEqual({ name: 'page-replica', title: 'Replica — Standard', postTypes: ['page', 'post'] });
  });

  it('prunes stale replica entries (idempotent across runs)', () => {
    const withStale = JSON.stringify({ version: 3, customTemplates: [{ name: 'page-replica-overlay', title: 'old', postTypes: ['page'] }] });
    const out = JSON.parse(mergeCustomTemplates(withStale, [{ name: 'page-replica', title: 'Replica — Standard', postTypes: ['page', 'post'] }]));
    expect(out.customTemplates.map((e: { name: string }) => e.name)).toEqual(['page-replica']);
  });

  it('handles a theme.json with no customTemplates key', () => {
    const out = JSON.parse(mergeCustomTemplates('{"version":3}', [{ name: 'page-replica', title: 'Replica — Standard', postTypes: ['page', 'post'] }]));
    expect(out.customTemplates).toHaveLength(1);
  });

  it('throws on malformed JSON (fail loud, not silent)', () => {
    expect(() => mergeCustomTemplates('{not json', [])).toThrow();
  });
});

describe('convergence', () => {
  it('apply-twice = no-op: same pages → identical plan', () => {
    const pages = [
      { slug: 'home', isHome: true, variant: V('overlay-full') },
      { slug: 'a', isHome: false, variant: V('standard') },
      { slug: 'b', isHome: false, variant: V('full') },
    ];
    const p1 = planPageTemplates(pages, render);
    const p2 = planPageTemplates(pages, render);
    expect(p2.templates).toEqual(p1.templates);
    expect([...p2.assignments]).toEqual([...p1.assignments]);
    expect(p2.customTemplates).toEqual(p1.customTemplates);
  });

  it('chaos: an excluded page still referencing a variant guards it from deletion', () => {
    // 'c' was 'full' last run, is EXCLUDED this run but still references page-replica-full.
    const plan = planPageTemplates([
      { slug: 'a', isHome: false, variant: V('standard') },
      { slug: 'b', isHome: false, variant: V('standard') },
    ], render);
    const rec = reconcileReplicaTemplates(
      ['page-replica', 'page-replica-full'],
      plan.desiredTemplateSlugs,                  // {page-replica}
      new Set(['page-replica-full']),             // c still references it
    );
    expect(rec.delete).toEqual([]);               // full kept (guarded), not stranded
  });
});
