import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { dominantBandColor, nearestToken, parseHex, brightness } from './footer-color.js';

/** Build a PNG whose top half is `top` and bottom band is `bottom` (both #rrggbb). */
function twoBandPng(top: string, bottom: string, w = 40, h = 100): { width: number; height: number; data: Buffer } {
  const png = new PNG({ width: w, height: h });
  const t = parseHex(top)!;
  const b = parseHex(bottom)!;
  for (let y = 0; y < h; y++) {
    const c = y < h * 0.85 ? t : b;
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) * 4;
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data: png.data };
}

describe('footer-color', () => {
  it('parseHex handles #rgb and #rrggbb', () => {
    expect(parseHex('#666558')).toEqual([0x66, 0x65, 0x58]);
    expect(parseHex('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseHex('nope')).toBeNull();
  });

  it('dominantBandColor reads the footer band, not the page body', () => {
    const png = twoBandPng('#ffffff', '#666558');
    const c = dominantBandColor(png, 0.9, 0.995);
    // quantized to 5-bit per channel: 0x66->0x60, 0x65->0x60, 0x58->0x58
    expect(c).toBe('#606058');
    // sampling the top band gets white instead
    expect(dominantBandColor(png, 0.0, 0.3)).toBe('#f8f8f8');
  });

  it('nearestToken maps a sampled footer color to the closest palette token', () => {
    const tokens = [
      { slug: 'surface-base', hex: '#ffffff' },
      { slug: 'surface-raised', hex: '#666558' }, // taupe
      { slug: 'surface-inverse', hex: '#175236' }, // green
    ];
    // A taupe footer maps to surface-raised, NOT the brand green.
    expect(nearestToken('#606058', tokens)).toBe('surface-raised');
    // A navy/green footer maps to surface-inverse.
    expect(nearestToken('#185030', tokens)).toBe('surface-inverse');
  });

  it('brightness distinguishes dark bands (need light text) from light', () => {
    expect(brightness('#666558')).toBeLessThan(140); // taupe -> light text
    expect(brightness('#ffffff')).toBeGreaterThan(200);
  });
});
