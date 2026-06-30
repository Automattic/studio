import { describe, expect, it } from 'vitest';
import { detectBehaviors } from './detect-behaviors.js';

// Fictional source assets (no real-site data).
const REVEAL_CSS = `
html.js section { opacity: 0; transform: translateY(18px); transition: opacity 600ms ease, transform 600ms ease; }
html.js section.is-visible { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { section { opacity: 1; transform: none; transition: none; } }
`;
const REVEAL_JS = `
const obs = new IntersectionObserver((entries) => {
  entries.forEach((e) => e.isIntersecting && e.target.classList.add('is-visible'));
}, { threshold: 0.12 });
document.querySelectorAll('section').forEach((s) => obs.observe(s));
`;
const STICKY_JS = `
window.addEventListener('scroll', () => {
  document.querySelector('header').classList.toggle('is-scrolled', window.scrollY > 24);
});
`;
const STICKY_CSS = `header.is-scrolled { padding: 0.4rem 1.5rem; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }`;
const GAP_JS = `
document.querySelectorAll('nav a').forEach((a) => {
  if (a.getAttribute('href') === location.pathname) a.style.color = 'red';
});
`;

describe('detectBehaviors', () => {
  it('detects reveal with parsed params', () => {
    const d = detectBehaviors({ css: REVEAL_CSS, js: REVEAL_JS });
    expect(d.reveal).toEqual({ kind: 'reveal', threshold: 0.12, translateY: '18px', durationMs: 600 });
    expect(d.gaps).toEqual([]);
  });

  it('detects sticky scroll-toggle with class + offset', () => {
    const d = detectBehaviors({ css: STICKY_CSS, js: STICKY_JS });
    expect(d.sticky).toEqual({ kind: 'sticky', toggleClass: 'is-scrolled', offset: 24 });
  });

  it('defaults reveal params when JS omits them', () => {
    const js = `new IntersectionObserver((es)=>es.forEach((e)=>e.isIntersecting&&e.target.classList.add('is-visible')));document.querySelectorAll('section').forEach((s)=>{});`;
    const d = detectBehaviors({ css: 'html.js section{opacity:0}', js });
    expect(d.reveal).toEqual({ kind: 'reveal', threshold: 0.12, translateY: '0px', durationMs: 600 });
  });

  it('requires BOTH the css gate and the observer js for reveal', () => {
    expect(detectBehaviors({ css: REVEAL_CSS, js: '' }).reveal).toBeUndefined();
    expect(detectBehaviors({ css: '', js: REVEAL_JS }).reveal).toBeUndefined();
  });

  it('requires BOTH the scroll listener and a matching css rule for sticky', () => {
    expect(detectBehaviors({ css: '', js: STICKY_JS }).sticky).toBeUndefined();
    expect(detectBehaviors({ css: STICKY_CSS, js: '' }).sticky).toBeUndefined();
  });

  it('reports unrecognized js as a single gap with an excerpt', () => {
    const d = detectBehaviors({ css: '', js: GAP_JS });
    expect(d.reveal).toBeUndefined();
    expect(d.sticky).toBeUndefined();
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].pattern).toBe('uncatalogued-js');
    expect(d.gaps[0].jsExcerpt).toContain('location.pathname');
  });

  it('mixed source: catalog behaviors detected AND leftover js gapped', () => {
    const d = detectBehaviors({ css: REVEAL_CSS + STICKY_CSS, js: REVEAL_JS + STICKY_JS + GAP_JS });
    expect(d.reveal?.kind).toBe('reveal');
    expect(d.sticky?.kind).toBe('sticky');
    expect(d.gaps).toHaveLength(1);
  });

  it('empty source: nothing detected, no gaps', () => {
    expect(detectBehaviors({ css: '', js: '' })).toEqual({ gaps: [] });
  });

  it('reads reveal params from the gate rule, not earlier decoy rules', () => {
    const decoyCss =
      `nav a { transition: color 160ms ease; transform: translateY(4px); }` + REVEAL_CSS;
    const d = detectBehaviors({ css: decoyCss, js: REVEAL_JS });
    expect(d.reveal).toEqual({ kind: 'reveal', threshold: 0.12, translateY: '18px', durationMs: 600 });
  });

  it('regex literals containing quotes do not swallow gap statements', () => {
    const js = `const re = /['"]/;\n` + REVEAL_JS + `rogueTicker.start({ speedMs: 80 });`;
    const d = detectBehaviors({ css: REVEAL_CSS, js });
    expect(d.reveal?.kind).toBe('reveal');
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].jsExcerpt).toContain('rogueTicker.start');
  });

  it('comment-only js is noise, not a gap', () => {
    expect(detectBehaviors({ css: '', js: '// license header only' })).toEqual({ gaps: [] });
  });
});

// --- B1: per-section DOM-pattern detection -----------------------------------

import { detectSectionBehavior } from './detect-behaviors.js';

const TABS_HTML = `<section id="plans"><div role="tablist">
  <button role="tab" aria-selected="true" aria-controls="p-a" class="tab is-active">A</button>
  <button role="tab" aria-selected="false" aria-controls="p-b" class="tab">B</button></div>
  <div role="tabpanel" id="p-a"><p>Alpha</p></div>
  <div role="tabpanel" id="p-b" hidden><p>Beta</p></div></section>`;
const TABS_JS = `document.querySelectorAll('[role="tab"]').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('[role="tab"]').forEach((o) => o.classList.remove('is-active'));
  t.classList.add('is-active');
}));`;
const SLIDER_HTML = `<section id="quotes"><div class="track">
  <figure class="slide is-current"><blockquote>One</blockquote></figure>
  <figure class="slide"><blockquote>Two</blockquote></figure></div>
  <button class="prev">Prev</button><button class="next">Next</button></section>`;
const SLIDER_JS = `setInterval(() => { advance(); }, 6000);
document.querySelector('.next').addEventListener('click', () => {
  document.querySelector('.slide.is-current').classList.remove('is-current');
});`;
const MODAL_HTML = `<section id="book"><button class="open-details">Details</button>
  <dialog aria-modal="true"><p>Info</p><button class="close">Close</button></dialog></section>`;
const MODAL_JS = `document.querySelector('.open-details').addEventListener('click', () => {
  document.querySelector('dialog').showModal();
});`;

describe('detectSectionBehavior', () => {
  it('detects tabs from role pattern + click driver', () => {
    const b = detectSectionBehavior(TABS_HTML, { css: '', js: TABS_JS });
    expect(b).toEqual({ kind: 'tabs', activeClass: 'is-active' });
  });

  it('tabs requires the JS driver (static tablist alone stays untagged)', () => {
    expect(detectSectionBehavior(TABS_HTML, { css: '', js: '' })).toBeUndefined();
  });

  it('detects slider with interval + active class', () => {
    const b = detectSectionBehavior(SLIDER_HTML, { css: '', js: SLIDER_JS });
    expect(b).toEqual({ kind: 'slider', activeClass: 'is-current', intervalMs: 6000 });
  });

  it('slider without autoplay omits intervalMs', () => {
    const js = `document.querySelector('.next').addEventListener('click', () => {
      document.querySelector('.slide.is-current').classList.remove('is-current'); });`;
    expect(detectSectionBehavior(SLIDER_HTML, { css: '', js })).toEqual({
      kind: 'slider',
      activeClass: 'is-current',
    });
  });

  it('detects modal from dialog + showModal driver', () => {
    expect(detectSectionBehavior(MODAL_HTML, { css: '', js: MODAL_JS })).toEqual({ kind: 'modal' });
  });

  it('modal requires showModal/open driver', () => {
    expect(detectSectionBehavior(MODAL_HTML, { css: '', js: '' })).toBeUndefined();
  });

  it('plain section detects nothing', () => {
    expect(
      detectSectionBehavior('<section id="s"><p>hi</p></section>', { css: '', js: TABS_JS }),
    ).toBeUndefined();
  });
});

describe('detectBehaviors sectionKinds claiming', () => {
  it('claims tabs/slider/modal driver js only when their kind fired', () => {
    const js = TABS_JS + '\n' + SLIDER_JS + '\n' + MODAL_JS + '\n' + GAP_JS;
    // Without sectionKinds: all three drivers are residue alongside the gap.
    const without = detectBehaviors({ css: '', js });
    expect(without.gaps).toHaveLength(1);
    expect(without.gaps[0].jsExcerpt).toContain('[role="tab"]');
    // With all three kinds detected: only the nav-highlight gap remains.
    const withKinds = detectBehaviors(
      { css: '', js },
      { sectionKinds: new Set(['tabs', 'slider', 'modal']) },
    );
    expect(withKinds.gaps).toHaveLength(1);
    expect(withKinds.gaps[0].jsExcerpt).toContain('location.pathname');
    expect(withKinds.gaps[0].jsExcerpt).not.toContain('showModal');
  });

  it('a kind absent from sectionKinds leaves its driver in the gap report', () => {
    const js = MODAL_JS + '\n' + GAP_JS;
    const d = detectBehaviors({ css: '', js }, { sectionKinds: new Set(['tabs']) });
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].jsExcerpt).toContain('showModal');
  });
});

describe('driver-scoped activeClass tie (review probes B + E)', () => {
  it('stray static class + unrelated interval do not produce a false slider', () => {
    const cardHtml = `<section id="cards"><div class="grid">
      <div class="card">A <span class="is-active">badge</span></div>
      <div class="card">B</div></div></section>`;
    const js = TABS_JS + `\nsetInterval(updateClock, 1000);`;
    expect(detectSectionBehavior(cardHtml, { css: '', js })).toBeUndefined();
  });

  it('tabs section with a stray slider class still reads its own driver class', () => {
    const tabsWithStray = TABS_HTML.replace('<p>Alpha</p>', '<p class="is-current">Alpha</p>');
    const js = SLIDER_JS + '\n' + TABS_JS; // slider mutations FIRST in source order
    expect(detectSectionBehavior(tabsWithStray, { css: '', js })).toEqual({
      kind: 'tabs',
      activeClass: 'is-active',
    });
  });
});
