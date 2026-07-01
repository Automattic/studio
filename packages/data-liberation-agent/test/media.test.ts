import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { safeFilename, resolveMediaPath } from '../src/lib/media-fetch/index.js';

describe('safeFilename', () => {
  it('returns filename for first occurrence', () => {
    const seen = new Map<string, number>();
    expect(safeFilename('photo.jpg', seen)).toBe('photo.jpg');
  });

  it('appends sequential suffix on collision', () => {
    const seen = new Map<string, number>();
    expect(safeFilename('photo.jpg', seen)).toBe('photo.jpg');
    expect(safeFilename('photo.jpg', seen)).toBe('photo-2.jpg');
    expect(safeFilename('photo.jpg', seen)).toBe('photo-3.jpg');
  });

  it('handles filenames without extensions', () => {
    const seen = new Map<string, number>();
    expect(safeFilename('readme', seen)).toBe('readme');
    expect(safeFilename('readme', seen)).toBe('readme-2');
  });

  it('handles empty filename', () => {
    const seen = new Map<string, number>();
    const result = safeFilename('', seen);
    expect(result).toMatch(/^image-\d+$/);
  });

  it('avoids collision with existing filename matching generated pattern', () => {
    const seen = new Map<string, number>();
    // Register photo-2.jpg as an original file first
    expect(safeFilename('photo-2.jpg', seen)).toBe('photo-2.jpg');
    // Now photo.jpg collisions should skip photo-2.jpg
    expect(safeFilename('photo.jpg', seen)).toBe('photo.jpg');
    expect(safeFilename('photo.jpg', seen)).not.toBe('photo-2.jpg');
  });
});

describe('resolveMediaPath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'media-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves a safe path within outputDir', () => {
    const result = resolveMediaPath('photo.jpg', tempDir);
    expect(result).toBe(join(tempDir, 'photo.jpg'));
  });

  it('rejects path traversal attempts', () => {
    expect(() => resolveMediaPath('../../etc/passwd', tempDir)).toThrow('Path traversal');
  });

  it('rejects absolute paths', () => {
    expect(() => resolveMediaPath('/etc/passwd', tempDir)).toThrow('Path traversal');
  });
});
