/**
 * Design-fragment sidecar → contentOverride → media-URL rewrite
 * ==============================================================
 * Integration test for Task 10: when `<outputDir>/design/<slug>.fragment.html`
 * exists, its contents become the post's contentOverride, flowing through the
 * existing prepareInstallContentWithMediaUrls so source <img> URLs are
 * swapped to local upload URLs.
 *
 * This test exercises the exact sequence that processOne() in
 * watch-runner.ts executes:
 *   1. designSidecarPath() → resolve sidecar path
 *   2. readFileSync(sidecar) → contentOverride = fragment
 *   3. prepareInstallContentWithMediaUrls({ sourceContent, contentOverride, mediaUrlMap })
 *      → rewrites source CDN URLs to local upload URLs in the fragment
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { designSidecarPath } from '../screenshot/design-capture-runner.js';
import { prepareInstallContentWithMediaUrls } from './post-content-media-rewrite.js';

const TMP_ROOT = join(process.cwd(), '.tmp-test', 'design-fragment-install');
mkdirSync(TMP_ROOT, { recursive: true });

describe('design-fragment sidecar as contentOverride with media-URL rewrite', () => {
  it('loads the design sidecar as contentOverride and rewrites source img URLs to local upload URLs', () => {
    const outDir = mkdtempSync(join(TMP_ROOT, 'out-'));
    try {
      const slug = 'about';
      const sourceImgUrl = 'https://src.test/a.png';
      const localUploadUrl = 'http://localhost:8881/wp-content/uploads/a.png';

      // Write the design fragment sidecar (mirrors what captureDesignForUrl produces)
      const sidecar = designSidecarPath(outDir, slug);
      mkdirSync(join(outDir, 'design'), { recursive: true });
      const fragmentHtml = `<div class="dla-replica-about"><img src="${sourceImgUrl}" alt="hero"><p>About us</p></div>`;
      writeFileSync(sidecar, fragmentHtml, 'utf8');

      // Step 1: processOne reads the sidecar (mirrors the watch-runner.ts logic)
      const fragment = readFileSync(sidecar, 'utf8');
      expect(fragment.trim().length).toBeGreaterThan(0);

      // Step 2: use it as contentOverride exactly as processOne does
      const contentOverride = fragment;

      // Step 3: pass through prepareInstallContentWithMediaUrls (the existing media-rewrite)
      const mediaUrlMap = new Map([[sourceImgUrl, localUploadUrl]]);
      const result = prepareInstallContentWithMediaUrls({
        sourceContent: '<p>raw extracted content</p>',
        contentOverride,
        mediaUrlMap,
      });

      // The design fragment's img src must be rewritten to the local upload URL
      expect(result.contentOverride).toContain(`src="${localUploadUrl}"`);
      // The source CDN URL must NOT appear in the installed content
      expect(result.contentOverride).not.toContain(sourceImgUrl);
      expect(result.rewritten).toBe(true);
      // contentOverride was provided — sourceContent was NOT promoted
      expect(result.usedSourceContent).toBe(false);
      expect(result.missing).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('designSidecarPath returns <outputDir>/design/<slug>.fragment.html', () => {
    expect(designSidecarPath('/tmp/mysite', 'contact')).toBe('/tmp/mysite/design/contact.fragment.html');
  });

  it('falls back to raw source content when no design sidecar exists', () => {
    const outDir = mkdtempSync(join(TMP_ROOT, 'out-nosidecar-'));
    try {
      const slug = 'services';
      const sourceImgUrl = 'https://src.test/banner.jpg';
      const localUploadUrl = 'http://localhost:8881/wp-content/uploads/banner.jpg';

      // No sidecar written — contentOverride stays undefined
      const contentOverride = undefined;

      const mediaUrlMap = new Map([[sourceImgUrl, localUploadUrl]]);
      const result = prepareInstallContentWithMediaUrls({
        sourceContent: `<p><img src="${sourceImgUrl}"></p>`,
        contentOverride,
        mediaUrlMap,
      });

      // Falls back to sourceContent, still rewrites the URL
      expect(result.contentOverride).toContain(`src="${localUploadUrl}"`);
      expect(result.usedSourceContent).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
