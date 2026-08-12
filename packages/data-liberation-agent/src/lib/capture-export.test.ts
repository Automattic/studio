import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MediaStubStore } from './resume-state/index.js';
import { CAPTURE_RECEIPT_SCHEMA, exportWebsiteCapture } from './capture-export.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('exportWebsiteCapture', () => {
  it('exports captured routes and localized media as a website directory', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'dla-capture-export-'));
    dirs.push(outputDir);
    mkdirSync(join(outputDir, 'html'), { recursive: true });
    mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
    mkdirSync(join(outputDir, 'media'), { recursive: true });
    writeFileSync(join(outputDir, 'html', 'homepage.html'), '<img src="https://cdn.example/logo.png"><img src="/hero.png?w=128"><h1>Home</h1>');
    writeFileSync(join(outputDir, 'html', 'about.html'), '<h1>About</h1>');
    writeFileSync(join(outputDir, 'media', 'logo.png'), 'png');
    writeFileSync(join(outputDir, 'media', 'hero.png'), 'base');
    writeFileSync(join(outputDir, 'media', 'hero-2.png'), '128');
    writeFileSync(join(outputDir, 'screenshots', 'manifest.json'), JSON.stringify({
      version: 1,
      entries: {
        'https://example.com/shop/': { html: 'html/homepage.html' },
        'https://example.com/shop/about': { html: 'html/about.html' },
        'https://example.com/': { html: 'html/corporate.html' },
      },
    }));
    const media = MediaStubStore.load(outputDir);
    media.markSuccess('https://cdn.example/logo.png', join(outputDir, 'media', 'logo.png'));
    media.markSuccess('https://example.com/hero.png', join(outputDir, 'media', 'hero.png'));
    media.markSuccess('https://example.com/hero.png?w=128', join(outputDir, 'media', 'hero-2.png'));
    media.flush();

    const receiptPath = exportWebsiteCapture({
      outputDir,
      sourceUrl: 'https://example.com/shop/',
      platform: 'fake',
      title: 'Example',
      summary: { pagesExtracted: 2 },
      failures: [],
    });

    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    expect(receipt).toMatchObject({
      schema: CAPTURE_RECEIPT_SCHEMA,
      websiteRoot: 'website',
      entrypoint: 'website/index.html',
      title: 'Example',
      routes: [
        { url: 'https://example.com/shop/', path: 'website/index.html' },
        { url: 'https://example.com/shop/about', path: 'website/about/index.html' },
      ],
      assets: [
        { sourceUrl: 'https://cdn.example/logo.png', path: 'website/media/logo.png' },
        { sourceUrl: 'https://example.com/hero.png?w=128', path: 'website/media/hero-2.png' },
      ],
      excludedRoutes: [ 'https://example.com/' ],
    });
    expect(readFileSync(join(outputDir, 'website', 'index.html'), 'utf8')).toContain('/media/logo.png');
    expect(readFileSync(join(outputDir, 'website', 'index.html'), 'utf8')).toContain('/media/hero-2.png');
    expect(readFileSync(join(outputDir, 'website', 'index.html'), 'utf8')).not.toContain('/media/hero.png?w=128');
    expect(readFileSync(join(outputDir, 'website', 'about', 'index.html'), 'utf8')).toContain('About');
    expect(readFileSync(join(outputDir, 'website', 'media', 'logo.png'), 'utf8')).toBe('png');
    expect(existsSync(join(outputDir, 'artifact.json'))).toBe(false);
    expect(existsSync(join(outputDir, 'diagnostics.json'))).toBe(true);
  });

  it('rejects decoded route paths that escape the website directory', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'dla-capture-export-'));
    dirs.push(outputDir);
    mkdirSync(join(outputDir, 'html'), { recursive: true });
    mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
    writeFileSync(join(outputDir, 'html', 'homepage.html'), '<h1>Home</h1>');
    writeFileSync(join(outputDir, 'html', 'escape.html'), '<h1>Escape</h1>');
    writeFileSync(join(outputDir, 'screenshots', 'manifest.json'), JSON.stringify({
      version: 1,
      entries: {
        'https://example.com/': { html: 'html/homepage.html' },
        'https://example.com/%2e%2e%2fescape': { html: 'html/escape.html' },
      },
    }));

    expect(() => exportWebsiteCapture({
      outputDir,
      sourceUrl: 'https://example.com/',
      platform: 'fake',
      summary: {},
      failures: [],
    })).toThrow('escapes the website directory');
  });

  it('uses a route whose canonical URL identifies it as the source homepage', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'dla-capture-export-'));
    dirs.push(outputDir);
    mkdirSync(join(outputDir, 'html'), { recursive: true });
    mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
    writeFileSync(join(outputDir, 'html', 'home.html'), '<h1>Canonical home</h1>');
    writeFileSync(join(outputDir, 'html', 'about.html'), '<h1>About</h1>');
    writeFileSync(join(outputDir, 'screenshots', 'manifest.json'), JSON.stringify({
      version: 1,
      entries: {
        'https://example.com/home': {
          html: 'html/home.html',
          metadata: { openGraph: { 'og:url': 'https://example.com' } },
        },
        'https://example.com/about': { html: 'html/about.html' },
      },
    }));

    const receiptPath = exportWebsiteCapture({
      outputDir,
      sourceUrl: 'https://example.com',
      platform: 'fake',
      summary: {},
      failures: [],
    });

    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    expect(receipt.routes).toEqual([
      { url: 'https://example.com/home', path: 'website/index.html' },
      { url: 'https://example.com/about', path: 'website/about/index.html' },
    ]);
    expect(readFileSync(join(outputDir, 'website', 'index.html'), 'utf8')).toContain('Canonical home');
  });
});
