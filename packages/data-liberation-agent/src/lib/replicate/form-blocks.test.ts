import { describe, it, expect } from 'vitest';
import { serializeBlockAttrs } from './form-blocks.js';

describe('serializeBlockAttrs', () => {
  it('escapes characters that can break block comments or smuggle markup', () => {
    const serialized = serializeBlockAttrs({
      label: 'a --> b & <c> "d"',
      nested: { text: 'x < y && z > q' },
    });

    expect(serialized).toContain('\\u002d\\u002d');
    expect(serialized).toContain('\\u003c');
    expect(serialized).toContain('\\u003e');
    expect(serialized).toContain('\\u0026');
    expect(serialized).toContain('\\u0022');
    expect(serialized).not.toContain('--');
    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
    expect(serialized).not.toContain('&');
    expect(JSON.parse(serialized)).toEqual({
      label: 'a --> b & <c> "d"',
      nested: { text: 'x < y && z > q' },
    });
  });

  it('preserves ordinary JSON output for variation-hoist attr rewrites', () => {
    expect(serializeBlockAttrs({ className: 'cta is-style-lib-card-spacing', lock: { remove: true } })).toBe(
      '{"className":"cta is-style-lib-card-spacing","lock":{"remove":true}}',
    );
  });
});
