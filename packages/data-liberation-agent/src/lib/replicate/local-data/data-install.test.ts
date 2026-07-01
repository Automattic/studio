// src/lib/replicate/local-data/data-install.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDataPayload,
  collectModelImages,
  writeDataMuPlugins,
  installLocalData,
  type ExecFn,
} from './data-install.js';
import { cptMuPluginFilename } from './cpt-plugin.js';
import { dataCardPluginFilename } from './card-render-php.js';
import { DATA_MODEL_SCHEMA, type DataModel } from './types.js';

const MODEL: DataModel = {
  cpt: { slug: 'objet', singular: 'Objet', plural: 'Objets', public: true, supports: ['title', 'editor'] },
  taxonomy: {
    slug: 'objet_cat',
    label: 'Categories',
    hierarchical: true,
    terms: [
      { slug: 'glass', label: 'Glass' },
      { slug: 'textiles', label: 'Textiles' },
    ],
  },
  fields: [{ key: 'price_eur', type: 'integer' }],
  mounts: [],
  items: [
    { id: 'a-1', title: 'Item A', terms: ['glass'], meta: { price_eur: 120 }, gallery: [{ caption: 'front' }], content: 'story a' },
    { id: 'b-2', title: 'Item B', terms: ['textiles'], meta: { price_eur: 80 }, gallery: [] },
  ],
  card: { template: '<article data-dla-text="title"></article>', maps: {} },
  schema: DATA_MODEL_SCHEMA,
};

let root: string;
beforeEach(() => {
  mkdirSync(join(process.cwd(), '.tmp-test'), { recursive: true });
  root = mkdtempSync(join(process.cwd(), '.tmp-test', 'datainstall-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('collectModelImages', () => {
  it('keeps existing image files and rejects html, traversal, and missing paths', () => {
    const sourceDir = join(root, 'source');
    mkdirSync(join(sourceDir, 'assets'), { recursive: true });
    writeFileSync(join(sourceDir, 'assets', 'photo-card.PNG'), Buffer.from('fictional image'));
    writeFileSync(join(sourceDir, 'page.html'), '<main>fictional page</main>');
    writeFileSync(join(root, 'secret.png'), Buffer.from('not in source'));

    const model: DataModel = {
      ...MODEL,
      items: [
        {
          id: 'fictional-item',
          title: 'Fictional Item',
          terms: ['glass'],
          meta: {
            image: './assets/photo-card.PNG',
            link: 'page.html',
            traversal: '../secret.png',
            missing: 'assets/missing.webp',
          },
          gallery: [
            { caption: 'duplicate', url: 'assets/photo-card.PNG' },
            { caption: 'html', url: 'page.html' },
          ],
        },
      ],
    };

    expect(collectModelImages(model, sourceDir)).toEqual([
      { relPath: 'assets/photo-card.PNG', absPath: join(sourceDir, 'assets', 'photo-card.PNG') },
    ]);
  });
});

describe('buildDataPayload', () => {
  it('flattens the model into the eval-file payload shape', () => {
    const p = buildDataPayload(MODEL);
    expect(p.cpt).toBe('objet');
    expect(p.taxonomy).toBe('objet_cat');
    expect(p.fields).toEqual(['price_eur']);
    expect(p.terms).toEqual([
      { slug: 'glass', label: 'Glass' },
      { slug: 'textiles', label: 'Textiles' },
    ]);
    expect(p.items[0]).toMatchObject({ id: 'a-1', title: 'Item A', content: 'story a', terms: ['glass'] });
    expect(p.items[1].content).toBe(''); // content defaulted
  });
});

describe('writeDataMuPlugins', () => {
  it('writes both mu-plugins into wp-content/mu-plugins', () => {
    const written = writeDataMuPlugins(root, MODEL);
    expect(written).toEqual([cptMuPluginFilename(MODEL), dataCardPluginFilename(MODEL)]);
    const dir = join(root, 'wp-content', 'mu-plugins');
    expect(existsSync(join(dir, cptMuPluginFilename(MODEL)))).toBe(true);
    const card = readFileSync(join(dir, dataCardPluginFilename(MODEL)), 'utf8');
    expect(card).toContain("register_block_type( 'dla/data-card'");
  });

  it('skips the card plugin when the model has no card spec', () => {
    const written = writeDataMuPlugins(root, { ...MODEL, card: undefined });
    expect(written).toEqual([cptMuPluginFilename(MODEL)]);
  });
});

describe('installLocalData', () => {
  it('writes plugins, stages payload, runs eval-file, parses counts', async () => {
    const sitePath = join(root, 'site');
    mkdirSync(join(sitePath, 'wordpress'), { recursive: true });
    const calls: { file: string; args: string[] }[] = [];
    const exec: ExecFn = async (file, args) => {
      calls.push({ file, args });
      return { stdout: 'some log noise\n{"inserted":2,"updated":0,"skippedModified":1,"collisions":0,"terms":2}\n', stderr: '' };
    };

    const res = await installLocalData({
      model: MODEL,
      studioSitePath: sitePath,
      wpRoot: join(sitePath, 'wordpress'),
      exec,
      uniqueSuffix: 'fixed',
    });

    expect(res.inserted).toBe(2);
    expect(res.terms).toBe(2);
    expect(res.skippedModified).toBe(1);
    expect(res.collisions).toBe(0);
    expect(res.muPlugins).toHaveLength(2);
    // mu-plugins landed under the WP root
    expect(existsSync(join(sitePath, 'wordpress', 'wp-content', 'mu-plugins', cptMuPluginFilename(MODEL)))).toBe(true);
    // payload + script staged under the mounted site dir
    expect(existsSync(join(sitePath, '.dla-scripts', 'install-data.php'))).toBe(true);
    expect(existsSync(join(sitePath, '.dla-scripts', 'install-data-fixed.json'))).toBe(true);
    // eval-file invoked with VFS paths
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      'wp', '--path', sitePath, 'eval-file',
      '/wordpress/.dla-scripts/install-data.php',
      '/wordpress/.dla-scripts/install-data-fixed.json',
    ]);
  });

  it('throws when the script reports an error', async () => {
    const sitePath = join(root, 'site2');
    mkdirSync(join(sitePath, 'wordpress'), { recursive: true });
    const exec: ExecFn = async () => ({ stdout: '{"error":"post type not registered"}', stderr: '' });
    await expect(
      installLocalData({ model: MODEL, studioSitePath: sitePath, wpRoot: join(sitePath, 'wordpress'), exec }),
    ).rejects.toThrow(/post type not registered/);
  });

  it('installs source-local card images and rewrites payload media URLs', async () => {
    const sourceDir = join(root, 'source');
    mkdirSync(join(sourceDir, 'assets'), { recursive: true });
    writeFileSync(join(sourceDir, 'assets', 'x.png'), Buffer.from('fictional card image'));

    const sitePath = join(root, 'site3');
    const wpRoot = join(sitePath, 'wordpress');
    mkdirSync(wpRoot, { recursive: true });
    const model: DataModel = {
      ...MODEL,
      items: [
        {
          id: 'fictional-card',
          title: 'Fictional Card',
          terms: ['glass'],
          meta: { image: 'assets/x.png', link: 'page.html' },
          gallery: [{ caption: 'front', url: './assets/x.png' }],
          content: 'fictional content',
        },
      ],
    };

    let payload: ReturnType<typeof buildDataPayload> | undefined;
    const exec: ExecFn = async () => {
      payload = JSON.parse(
        readFileSync(join(sitePath, '.dla-scripts', 'install-data-media.json'), 'utf8'),
      ) as ReturnType<typeof buildDataPayload>;
      return { stdout: '{"inserted":1,"updated":0,"skippedModified":0,"collisions":0,"terms":1}', stderr: '' };
    };
    const installMedia = vi.fn().mockResolvedValue({
      installed: [{ sourceUrl: 'assets/x.png', postId: 7, localUrl: '/wp-content/uploads/2026/06/x.png' }],
      errors: [],
    });

    const res = await installLocalData({
      model,
      studioSitePath: sitePath,
      wpRoot,
      sourceDir,
      _installMedia: installMedia,
      exec,
      uniqueSuffix: 'media',
    });

    expect(installMedia).toHaveBeenCalledWith({
      files: [{ absPath: join(sourceDir, 'assets', 'x.png'), sourceUrl: 'assets/x.png' }],
      wpRoot,
    });
    expect(payload?.items[0].meta.image).toBe('/wp-content/uploads/2026/06/x.png');
    expect(payload?.items[0].meta.link).toBe('page.html');
    expect(payload?.items[0].gallery[0].url).toBe('/wp-content/uploads/2026/06/x.png');
    expect(res.mediaInstalled).toBe(1);
    expect(res.mediaErrors).toEqual([]);
  });
});
