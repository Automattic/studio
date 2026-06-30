import { describe, it, expect } from 'vitest';
import { JsAggregator, LIBRARY_CDN_ALLOWLIST, isTrackerScript, isAllowlistedCdn } from './js-aggregator.js';

const BASE = 'https://www.swiftlumber.com/';

describe('JsAggregator', () => {
  it('keeps first-party + allowlisted CDN, drops third-party + trackers', async () => {
    const agg = new JsAggregator(BASE);
    await agg.add('p', [
      { src: 'https://www.swiftlumber.com/app.js', content: 'A();' },
      { src: 'https://cdn.jsdelivr.net/lib.js', content: 'LIB();' },
      { src: 'https://www.google-analytics.com/ga.js', content: 'gaSend();' },
      { content: "gtag('config','X')" },
      { content: 'document.querySelector(".x")' },
    ]);
    const js = agg.toString();
    expect(js).toContain('A();');
    expect(js).toContain('LIB();');
    expect(js).not.toContain('gaSend');
    expect(js).not.toContain("gtag('config'");
    expect(js).toContain('document.querySelector');
  });

  it('preserves order and is concurrency-safe', async () => {
    const agg = new JsAggregator(BASE);
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      agg.add(`p${i}`, [{ content: `fn${i}();` }])));
    const js = agg.toString();
    for (let i = 0; i < 10; i++) expect(js).toContain(`fn${i}();`);
  });
});

describe('isTrackerScript', () => {
  it('flags tracker patterns, not design code', () => {
    expect(isTrackerScript('window.dataLayer.push({})')).toBe(true);
    expect(isTrackerScript("fbq('track','PageView')")).toBe(true);
    expect(isTrackerScript('new Slider(".hero")')).toBe(false);
  });

  it('flags common inline tracker snippets', () => {
    expect(isTrackerScript("hj('event','x')")).toBe(true);             // Hotjar
    expect(isTrackerScript("analytics.load('KEY')")).toBe(true);        // Segment
    expect(isTrackerScript("Intercom('boot',{})")).toBe(true);         // Intercom
    expect(isTrackerScript("heap.load('id')")).toBe(true);             // Heap
    expect(isTrackerScript("clarity('set','x','y')")).toBe(true);      // Clarity
    expect(isTrackerScript("ttq.track('ViewContent')")).toBe(true);    // TikTok
    expect(isTrackerScript("lintrk('track',{})")).toBe(true);          // LinkedIn
  });

  it('does not flag benign design code', () => {
    expect(isTrackerScript('new Carousel(".hero",{loop:true})')).toBe(false);
    expect(isTrackerScript('document.querySelectorAll(".nav a")')).toBe(false);
    expect(isTrackerScript('const heading = "x";')).toBe(false);
  });
});

describe('isAllowlistedCdn', () => {
  it('allows library CDNs, denies polyfill.io and trackers', () => {
    expect(isAllowlistedCdn('https://cdn.jsdelivr.net/x.js')).toBe(true);
    expect(isAllowlistedCdn('https://code.jquery.com/jquery.js')).toBe(true);
    expect(isAllowlistedCdn('https://cdn.polyfill.io/v3.js')).toBe(false);
    expect(isAllowlistedCdn('https://www.google-analytics.com/ga.js')).toBe(false);
  });
});
