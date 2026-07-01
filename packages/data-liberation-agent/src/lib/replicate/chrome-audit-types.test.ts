import { describe, it, expect } from 'vitest';
import { CHROME_AUDIT_PROPERTIES, CHROME_FIDELITY_SCHEMA } from './chrome-audit-types.js';

describe('chrome audit types', () => {
  it('allowlist covers the properties the 2026-06-08 bugs hit', () => {
    for (const p of ['display', 'opacity', 'visibility', 'font-size', 'line-height', 'text-decoration-line', 'color', 'margin', 'padding']) {
      expect(CHROME_AUDIT_PROPERTIES).toContain(p);
    }
  });
  it('schema is a positive integer', () => {
    expect(Number.isInteger(CHROME_FIDELITY_SCHEMA) && CHROME_FIDELITY_SCHEMA > 0).toBe(true);
  });
});
