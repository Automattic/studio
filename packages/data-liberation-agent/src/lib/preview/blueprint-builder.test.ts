import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlueprint, persistBlueprint } from './blueprint-builder.js';

let tempDirs: string[] = [];

function mkDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'bp-'));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('buildBlueprint', () => {
  it('generates a Studio blueprint: installPlugin wordpress-importer, no landingPage, no importWxr', () => {
    const dir = mkDir();
    writeFileSync(join(dir, 'output.wxr'), '<rss></rss>');
    mkdirSync(join(dir, 'media'));

    const bp = buildBlueprint({ outputDir: dir });

    // landingPage is absent from the Blueprint type entirely — Studio errors
    // with "WordPress server process exited unexpectedly" when it is present.
    expect(bp.login).toBe(true);
    expect(bp.preferredVersions.wp).toBe('latest');
    expect(bp.preferredVersions.php).toBe('8.2');

    // Studio does not use importWxr — import happens out-of-band via `studio wp`
    const stepNames = bp.steps.map((s) => s.step);
    expect(stepNames).not.toContain('importWxr');

    // Always installs wordpress-importer
    const hasImporter = bp.steps.some(
      (s) => s.step === 'installPlugin' && (s as any).pluginData?.slug === 'wordpress-importer',
    );
    expect(hasImporter).toBe(true);
  });

  it('installs WooCommerce when products.csv exists; no wp-cli steps in the blueprint', () => {
    const dir = mkDir();
    writeFileSync(join(dir, 'output.wxr'), '<rss/>');
    writeFileSync(join(dir, 'products.csv'), 'name\nfoo');

    const bp = buildBlueprint({ outputDir: dir });
    const hasWoo = bp.steps.some(
      (s) => s.step === 'installPlugin' && (s as any).pluginData?.slug === 'woocommerce',
    );
    const hasWpCli = bp.steps.some((s) => s.step === 'wp-cli');
    expect(hasWoo).toBe(true);
    // Studio blueprint does NOT contain wp-cli steps — WXR and product CSV
    // imports both happen out-of-band via `studio wp` in startStudioPreview.
    expect(hasWpCli).toBe(false);
  });

  it('honors DLA_PREVIEW_WP_VERSION env override', () => {
    const prev = process.env.DLA_PREVIEW_WP_VERSION;
    process.env.DLA_PREVIEW_WP_VERSION = '6.7';
    try {
      const dir = mkDir();
      writeFileSync(join(dir, 'output.wxr'), '<rss></rss>');
      mkdirSync(join(dir, 'media'));
      const bp = buildBlueprint({ outputDir: dir });
      expect(bp.preferredVersions.wp).toBe('6.7');
    } finally {
      if (prev === undefined) delete process.env.DLA_PREVIEW_WP_VERSION;
      else process.env.DLA_PREVIEW_WP_VERSION = prev;
    }
  });

  it('persistBlueprint writes blueprint.studio.json to <outputDir>/blueprint/', () => {
    const dir = mkDir();
    writeFileSync(join(dir, 'output.wxr'), '<rss></rss>');
    mkdirSync(join(dir, 'media'));

    const p = persistBlueprint(dir);

    expect(p).toBe(join(dir, 'blueprint', 'blueprint.studio.json'));
    expect(existsSync(p)).toBe(true);
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    const hasImporter = parsed.steps.some(
      (s: { step: string; pluginData?: { slug: string } }) =>
        s.step === 'installPlugin' && s.pluginData?.slug === 'wordpress-importer',
    );
    expect(hasImporter).toBe(true);
  });
});
