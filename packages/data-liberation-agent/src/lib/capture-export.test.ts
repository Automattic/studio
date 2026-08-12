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
    writeFileSync(join(outputDir, 'html', 'homepage.html'), '<img src="https://cdn.example/logo.png"><h1>Home</h1>');
    writeFileSync(join(outputDir, 'html', 'about.html'), '<h1>About</h1>');
    writeFileSync(join(outputDir, 'media', 'logo.png'), 'png');
    writeFileSync(join(outputDir, 'screenshots', 'manifest.json'), JSON.stringify({
      version: 1,
      entries: {
        'https://example.com/shop/': { html: 'html/homepage.html' },
        'https://example.com/shop/about': { html: 'html/about.html' },
      },
    }));
    const media = MediaStubStore.load(outputDir);
    media.markSuccess('https://cdn.example/logo.png', join(outputDir, 'media', 'logo.png'));
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
      ],
    });
    expect(readFileSync(join(outputDir, 'website', 'index.html'), 'utf8')).toContain('/media/logo.png');
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
});
