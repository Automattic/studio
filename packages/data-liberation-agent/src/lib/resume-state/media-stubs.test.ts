import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { MediaStubStore, toRootRelativeUploadUrl } from './media-stubs.js';

// cwd-local tmp dir per CLAUDE.md guidance (no os.tmpdir, no output/ reads).
const TMP_ROOT = join(process.cwd(), '.tmp-test', 'media-stubs');

function setup(name: string): string {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('toRootRelativeUploadUrl', () => {
  it('strips scheme+host+port from a WP uploads URL', () => {
    expect(
      toRootRelativeUploadUrl('http://localhost:8884/wp-content/uploads/2026/06/x.png'),
    ).toBe('/wp-content/uploads/2026/06/x.png');
  });

  it('strips a real https origin too', () => {
    expect(
      toRootRelativeUploadUrl('https://example.com/wp-content/uploads/a.jpg'),
    ).toBe('/wp-content/uploads/a.jpg');
  });

  it('leaves an already root-relative uploads path unchanged', () => {
    expect(toRootRelativeUploadUrl('/wp-content/uploads/a.jpg')).toBe(
      '/wp-content/uploads/a.jpg',
    );
  });

  it('leaves a non-uploads URL untouched', () => {
    expect(toRootRelativeUploadUrl('https://cdn.example.com/assets/logo.svg')).toBe(
      'https://cdn.example.com/assets/logo.svg',
    );
  });

  it('is a no-op on empty input', () => {
    expect(toRootRelativeUploadUrl('')).toBe('');
  });
});

describe('MediaStubStore — port-independent localUrl', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('recordLocalUrl stores a root-relative path, not an absolute localhost:PORT URL', () => {
    const dir = setup('record');
    const store = MediaStubStore.load(dir);
    store.markSuccess('https://cdn.example/x.png', 'media/x.png');
    store.recordLocalUrl(
      'https://cdn.example/x.png',
      'http://localhost:8886/wp-content/uploads/2026/06/x.png',
    );
    expect(store.get('https://cdn.example/x.png')?.localUrl).toBe(
      '/wp-content/uploads/2026/06/x.png',
    );
  });

  it('parses a pre-SVG-raster stub file without the new optional fields (back-compat)', () => {
    const dir = setup('backcompat');
    // Exact shape an older run persisted — no rasterPath/svgRisky/rasterError.
    writeFileSync(
      join(dir, 'media-stubs.json'),
      JSON.stringify({
        version: 1,
        stubs: {
          'https://cdn.example/old-logo.svg': {
            status: 'success',
            attempts: 1,
            localPath: 'media/old-logo.svg',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    const store = MediaStubStore.load(dir);
    const stub = store.get('https://cdn.example/old-logo.svg');
    expect(stub?.status).toBe('success');
    expect(stub?.localPath).toBe('media/old-logo.svg');
    expect(stub?.rasterPath).toBeUndefined();
    expect(stub?.svgRisky).toBeUndefined();
    expect(stub?.rasterError).toBeUndefined();
    expect(store.shouldAttempt('https://cdn.example/old-logo.svg')).toBe(false);
  });

  it('round-trips the SVG raster fields through save/load', () => {
    const dir = setup('raster-roundtrip');
    const store = MediaStubStore.load(dir);
    store.markSuccess('https://cdn.example/logo.svg', 'media/logo.svg', {
      rasterPath: 'media/logo.png',
      svgRisky: true,
    });
    store.markSuccess('https://cdn.example/plain.svg', 'media/plain.svg', {
      svgRisky: false,
      rasterError: 'chromium decode failed',
    });
    store.flush();

    const reloaded = MediaStubStore.load(dir);
    expect(reloaded.get('https://cdn.example/logo.svg')).toMatchObject({
      status: 'success',
      localPath: 'media/logo.svg',
      rasterPath: 'media/logo.png',
      svgRisky: true,
    });
    expect(reloaded.get('https://cdn.example/plain.svg')).toMatchObject({
      svgRisky: false,
      rasterError: 'chromium decode failed',
    });
    expect(reloaded.get('https://cdn.example/plain.svg')?.rasterPath).toBeUndefined();
  });

  it('load heals a pre-existing absolute localUrl from an older Studio site/port', () => {
    const dir = setup('heal');
    // Simulate media-stubs.json written by a prior run on a DIFFERENT port (8884).
    writeFileSync(
      join(dir, 'media-stubs.json'),
      JSON.stringify({
        version: 1,
        stubs: {
          'https://cdn.example/y.png': {
            status: 'success',
            attempts: 1,
            wpPostId: 5,
            localUrl: 'http://localhost:8884/wp-content/uploads/2026/06/y.png',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    const store = MediaStubStore.load(dir);
    // Reused on a new site/port (e.g. 8886), the root-relative path resolves;
    // the stale absolute :8884 URL would 404.
    expect(store.get('https://cdn.example/y.png')?.localUrl).toBe(
      '/wp-content/uploads/2026/06/y.png',
    );
  });
});
