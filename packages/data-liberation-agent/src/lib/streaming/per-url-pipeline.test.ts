import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { processOneUrl } from './per-url-pipeline.js';
import { ExtractionLog } from '../resume-state/index.js';
import { WxrBuilder } from '../wxr/index.js';
import type { ExtractedPage } from '../../adapters/shared.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function makeWxr() {
  return new WxrBuilder({
    title: 'Test',
    url: 'https://example.com',
    description: '',
    language: 'en-US',
  });
}

function makePage(overrides: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    title: 'About',
    slug: 'about',
    content: '<p>About us</p>',
    excerpt: '',
    date: '2026-04-29 12:00:00',
    seoTitle: '',
    seoDescription: '',
    mediaUrls: [],
    qualityScore: 'high',
    ...overrides,
  };
}

describe('processOneUrl', () => {
  it('extracts a single URL through the runExtractionLoop wrapper', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'pp-'));
    try {
      const log = new ExtractionLog(dir);
      const wxr = makeWxr();
      const extractPage = vi.fn().mockResolvedValue(makePage());

      const result = await processOneUrl({
        url: 'https://example.com/about',
        outputDir: dir,
        wxr,
        log,
        extractPage,
      });

      expect(result.url).toBe('https://example.com/about');
      expect(result.classifyUrl).toBe('page');
      expect(result.extracted).toBe(true);
      expect(result.pagesExtracted).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
      expect(extractPage).toHaveBeenCalledTimes(1);
      expect(extractPage).toHaveBeenCalledWith('https://example.com/about');
      expect(wxr.items).toHaveLength(1);
      expect(wxr.items[0].type).toBe('page');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records errors when adapter throws and reports failed=1', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'pp-err-'));
    try {
      const log = new ExtractionLog(dir);
      const wxr = makeWxr();
      const extractPage = vi.fn().mockRejectedValue(new Error('boom'));

      const result = await processOneUrl({
        url: 'https://example.com/broken',
        outputDir: dir,
        wxr,
        log,
        extractPage,
      });

      expect(result.extracted).toBe(false);
      expect(result.failed).toBe(1);
      expect(result.pagesExtracted).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('classifies URL types correctly', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'pp-class-'));
    try {
      const log = new ExtractionLog(dir);
      const wxr = makeWxr();
      const extractPage = vi.fn().mockResolvedValue(makePage());

      const post = await processOneUrl({
        url: 'https://example.com/blog/hello',
        outputDir: dir,
        wxr,
        log,
        extractPage,
      });
      expect(post.classifyUrl).toBe('post');

      const product = await processOneUrl({
        url: 'https://example.com/products/foo',
        outputDir: dir,
        wxr,
        log,
        extractPage,
      });
      expect(product.classifyUrl).toBe('product');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
