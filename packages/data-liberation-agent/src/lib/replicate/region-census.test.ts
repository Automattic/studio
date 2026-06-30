import { describe, expect, it } from 'vitest';
import { extractSourceLandmarksFromHtml } from '@automattic/blocks-engine/theme';

describe('extractSourceLandmarksFromHtml', () => {
  it('includes body-level aside and complementary landmarks but excludes nested-in-content aside', () => {
    const landmarks = extractSourceLandmarksFromHtml(`<!doctype html><html><body>
      <aside id="rail"><a href="/intro">Intro</a><a href="/api">API</a></aside>
      <div role="complementary" id="tools"><a href="/status">Status</a><a href="/logs">Logs</a></div>
      <main><article><aside id="pullquote">A short pull quote inside content.</aside></article></main>
    </body></html>`);

    expect(landmarks.map((l) => [l.role, l.selector, l.linkCount])).toEqual([
      ['aside', 'aside#rail', 2],
      ['complementary', 'div#tools', 2],
      ['main', 'main:nth-of-type(1)', 0],
    ]);
    expect(landmarks.some((l) => l.selector === 'aside#pullquote')).toBe(false);
  });
});
