// src/lib/replicate/parity/parity-probe.test.ts
import { describe, it, expect } from 'vitest';
import { CLEAR_INTERVALS_SCRIPT, compareSnapshots, FREEZE_MOTION_CSS, PROP_BATTERY, type ElementSnapshot } from './parity-probe.js';

const snap = (over: Partial<ElementSnapshot>): ElementSnapshot => ({
  match: 'section.hero[0]',
  rect: { top: 100, left: 20, width: 350, height: 200 },
  props: {
    display: 'block',
    marginBottom: '88px',
    fontSize: '17px',
    fontFamily: '"Work Sans", sans-serif',
    maxWidth: '655px',
  },
  replicaOnlyClasses: [],
  ...over,
});

describe('compareSnapshots', () => {
  it('reports prop divergences for matched elements', () => {
    const d = compareSnapshots(
      [snap({})],
      [snap({ props: { ...snap({}).props, marginBottom: '0px' }, replicaOnlyClasses: ['is-layout-flow'] })],
      'desktop',
    );
    expect(d).toEqual([
      {
        match: 'section.hero[0]',
        viewport: 'desktop',
        kind: 'prop',
        prop: 'marginBottom',
        source: '88px',
        replica: '0px',
        replicaOnlyClasses: ['is-layout-flow'],
      },
    ]);
  });

  it('reports rect divergences beyond tolerance as structural', () => {
    const d = compareSnapshots(
      [snap({})],
      [snap({ rect: { top: 160, left: 20, width: 350, height: 200 } })],
      'mobile',
    );
    expect(d).toEqual([
      expect.objectContaining({ kind: 'rect', prop: 'top', source: '100', replica: '160' }),
    ]);
  });

  it('tolerates sub-threshold rect noise (2px)', () => {
    const d = compareSnapshots([snap({})], [snap({ rect: { top: 101, left: 21, width: 351, height: 199 } })], 'desktop');
    expect(d).toEqual([]);
  });

  it('reports unmatched elements as structural missing', () => {
    const d = compareSnapshots([snap({})], [], 'desktop');
    expect(d).toEqual([
      expect.objectContaining({ kind: 'missing', match: 'section.hero[0]' }),
    ]);
  });

  it('occurrence indices are document-order global, so asymmetric region windows join correctly', () => {
    // Source side intersected cards 1,2 of three; replica side cards 0,1.
    // Because SNAPSHOT_FN counts EVERY qualifying element in document order
    // (emitting only intersecting ones), the [n] keys are truthful: card[1]
    // pairs with card[1] and the only divergence is the structural missing
    // card[2]. Region-local counting would mis-pair src card[1]<->rep card[0]
    // and src card[2]<->rep card[1], producing spurious prop divergences.
    const base = snap({});
    const src = [snap({ match: 'div.card[1]' }), snap({ match: 'div.card[2]' })];
    const rep = [
      snap({ match: 'div.card[0]', props: { ...base.props, fontSize: '20px' } }),
      snap({ match: 'div.card[1]' }),
    ];
    const d = compareSnapshots(src, rep, 'desktop');
    expect(d).toEqual([
      expect.objectContaining({ kind: 'missing', match: 'div.card[2]' }),
    ]);
  });

  it('is deterministic: output order follows source order', () => {
    const a = snap({ match: 'p.lede[0]' });
    const b = snap({ match: 'section.cards[0]' });
    const reps = [
      snap({ match: 'section.cards[0]', props: { ...b.props, fontSize: '18px' } }),
      snap({ match: 'p.lede[0]', props: { ...a.props, fontSize: '19px' } }),
    ];
    const d = compareSnapshots([a, b], reps, 'desktop');
    expect(d.map((x) => x.match)).toEqual(['p.lede[0]', 'section.cards[0]']);
  });

  it('battery covers the session-proven divergence axes', () => {
    for (const p of ['display', 'marginTop', 'marginBottom', 'maxWidth', 'fontSize', 'fontFamily', 'gap', 'justifyContent', 'flexWrap', 'paddingTop', 'paddingBottom', 'color', 'backgroundColor', 'textTransform', 'lineHeight']) {
      expect(PROP_BATTERY).toContain(p);
    }
  });
});

describe('FREEZE_MOTION_CSS', () => {
  it('force-reveals BOTH reveal gates: source html.js AND the dla/reveal replica gate', () => {
    // Capture-state symmetry: the source hides sections behind html.js, the
    // nativeBehaviors replica behind .dla-reveal-js .wp-block-dla-reveal —
    // both must be forced to the revealed end-state or below-fold sections
    // race the IO at capture time and understate scores asymmetrically.
    expect(FREEZE_MOTION_CSS).toContain('html.js section{opacity:1!important;transform:none!important}');
    expect(FREEZE_MOTION_CSS).toContain('.dla-reveal-js .wp-block-dla-reveal{opacity:1!important;transform:none!important}');
    expect(FREEZE_MOTION_CSS).toContain('transition:none!important;animation:none!important');
  });

  it('neutralizes css smooth-scroll so captures/probes cannot race a scroll glide', () => {
    // Belt to the helpers' explicit-instant scrollTo: even a capture path that
    // skips page-helpers measures under instant scroll (walrus probe: the
    // restore glide left y=4 + is-scrolled at snap time → 32px header ghost).
    expect(FREEZE_MOTION_CSS).toContain('html{scroll-behavior:auto!important}');
  });
});

describe('CLEAR_INTERVALS_SCRIPT', () => {
  it('clears every pending interval (JS autoplay determinism at capture)', () => {
    // FREEZE_MOTION_CSS kills CSS motion but not setInterval class-movers
    // (slider autoplay, tickers): source and replica timers start at their own
    // load instants, so a settle crossing the interval boundary on ONE side
    // flips the active slide — the same race class as the reveal/IO fix.
    // The script allocates a top id and clears every id at or below it.
    expect(CLEAR_INTERVALS_SCRIPT).toContain('setInterval');
    expect(CLEAR_INTERVALS_SCRIPT).toContain('clearInterval');
    // String-form evaluate (tsx __name gotcha): self-contained IIFE.
    expect(CLEAR_INTERVALS_SCRIPT.trim().startsWith('(() => {')).toBe(true);
  });
});
