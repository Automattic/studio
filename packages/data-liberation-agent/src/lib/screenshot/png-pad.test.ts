import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { padToMatch, padToMatchDecoded, MAGENTA } from './png-pad.js';

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const img = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    img.data[i * 4] = rgba[0]; img.data[i * 4 + 1] = rgba[1];
    img.data[i * 4 + 2] = rgba[2]; img.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(img);
}

function pixelAt(buf: Buffer, x: number, y: number): [number, number, number, number] {
  const img = PNG.sync.read(buf);
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

describe('padToMatch', () => {
  it('returns padded:false and original buffers when dims equal', () => {
    const a = solidPng(10, 10, [0, 0, 0, 255]);
    const b = solidPng(10, 10, [255, 255, 255, 255]);
    const r = padToMatch(a, b);
    expect(r.padded).toBe(false);
    expect(r.canvas).toEqual({ width: 10, height: 10 });
    expect(r.aPng).toBe(a);
    expect(r.bPng).toBe(b);
  });

  it('pads the shorter image with magenta below its content', () => {
    const a = solidPng(10, 20, [0, 0, 0, 255]);   // taller
    const b = solidPng(10, 10, [9, 9, 9, 255]);   // shorter
    const r = padToMatch(a, b);
    expect(r.padded).toBe(true);
    expect(r.canvas).toEqual({ width: 10, height: 20 });
    expect(pixelAt(r.bPng, 5, 5)).toEqual([9, 9, 9, 255]);
    expect(pixelAt(r.bPng, 5, 15)).toEqual([MAGENTA.r, MAGENTA.g, MAGENTA.b, MAGENTA.a]);
    expect(pixelAt(r.aPng, 5, 15)).toEqual([0, 0, 0, 255]);
  });

  it('pads the narrower image with magenta to the right', () => {
    const a = solidPng(10, 10, [0, 0, 0, 255]);
    const b = solidPng(20, 10, [9, 9, 9, 255]);
    const r = padToMatch(a, b);
    expect(r.canvas).toEqual({ width: 20, height: 10 });
    expect(pixelAt(r.aPng, 15, 5)).toEqual([MAGENTA.r, MAGENTA.g, MAGENTA.b, MAGENTA.a]);
  });
});

describe('padToMatchDecoded', () => {
  function solidImg(width: number, height: number, rgba: [number, number, number, number]): PNG {
    return PNG.sync.read(solidPng(width, height, rgba));
  }

  it('pads a mismatched pair without any encode round-trip and fills with magenta', () => {
    const aImg = solidImg(10, 20, [0, 0, 0, 255]);   // taller — already canvas-sized
    const bImg = solidImg(10, 10, [9, 9, 9, 255]);   // shorter — needs padding
    const r = padToMatchDecoded(aImg, bImg);
    expect(r.padded).toBe(true);
    expect(r.canvas).toEqual({ width: 10, height: 20 });
    // Canvas-sized input is returned as the SAME decoded object (no copy, no encode).
    expect(r.aImg).toBe(aImg);
    expect(r.bImg).not.toBe(bImg);
    // Padded region of the shorter image is magenta; its content region is intact.
    const at = (img: PNG, x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
    };
    expect(at(r.bImg, 5, 5)).toEqual([9, 9, 9, 255]);
    expect(at(r.bImg, 5, 15)).toEqual([MAGENTA.r, MAGENTA.g, MAGENTA.b, MAGENTA.a]);
  });
});
