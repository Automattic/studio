import { describe, it, expect } from 'vitest';
import {
  DesignFoundationSchema,
  PartialDesignFoundationSchema,
  RoleObj,
  type DesignFoundation,
} from './schema.js';

function validFoundation(): DesignFoundation {
  return {
    version: 1,
    generatedAt: '2026-04-19T10:00:00.000Z',
    origin: 'https://example.com',
    inputsDigest: {
      palette: 'sha256:abc',
      typography: 'sha256:def',
      breakpoints: 'sha256:ghi',
      manifest: 'sha256:jkl',
    },
    color: {
      surface: {
        base: { value: '#ffffff', role: 'page background', evidence: ['palette[0]'] },
      },
      text: {
        default: { value: '#111111', role: 'body copy', evidence: ['typography.body'] },
      },
      accent: {
        primary: { value: '#0066cc', role: 'primary CTA', evidence: ['button@homepage'] },
      },
      border: {
        default: { value: '#dddddd', role: 'divider', evidence: ['palette[7]'] },
      },
    },
    gradient: {
      hero: {
        css: 'linear-gradient(to bottom, #000, #333)',
        role: 'hero background',
        evidence: ['homepage.html:1'],
      },
    },
    typography: {
      families: {
        body: { value: 'Inter, sans-serif', role: 'body', evidence: ['typography.body.fontFamily'] },
      },
      scale: { base: '16px', steps: { base: '16px', lg: '24px' }, ratio: 1.25 },
      weights: [400, 700],
    },
    spacing: {
      base: '4px',
      scale: { '1': '4px', '4': '16px' },
      sections: { padY: '80px', padX: '40px', contentMaxWidth: '1200px' },
    },
    breakpoints: {
      sm: '480px',
      md: '768px',
      evidence: ['breakpoints.minWidth'],
    },
    radius: {
      base: '8px',
      evidence: ['button@homepage:8px'],
    },
    components: {
      button: { background: 'color.accent.primary', radius: 'radius.base' },
    },
    openQuestions: [],
    skillTodos: [],
  };
}

describe('DesignFoundationSchema', () => {
  it('accepts a valid full foundation fixture', () => {
    const result = DesignFoundationSchema.safeParse(validFoundation());
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const f = validFoundation() as Partial<DesignFoundation>;
    delete f.inputsDigest;
    expect(DesignFoundationSchema.safeParse(f).success).toBe(false);
  });

  it('rejects wrong-typed evidence arrays', () => {
    const f = validFoundation();
    // @ts-expect-error — intentionally wrong type
    f.color.surface.base.evidence = 'not an array';
    expect(DesignFoundationSchema.safeParse(f).success).toBe(false);
  });

  it('rejects empty evidence arrays', () => {
    const f = validFoundation();
    f.color.surface.base.evidence = [];
    expect(DesignFoundationSchema.safeParse(f).success).toBe(false);
  });

  it('rejects non-url origin', () => {
    const f = validFoundation();
    f.origin = 'not-a-url';
    expect(DesignFoundationSchema.safeParse(f).success).toBe(false);
  });

  it('rejects inputsDigest values without sha256: prefix', () => {
    const f = validFoundation();
    f.inputsDigest.palette = 'abc';
    expect(DesignFoundationSchema.safeParse(f).success).toBe(false);
  });

  it('rejects version != 1', () => {
    const f = validFoundation() as { version: number };
    f.version = 2;
    expect(DesignFoundationSchema.safeParse(f).success).toBe(false);
  });
});

describe('PartialDesignFoundationSchema', () => {
  it('accepts a foundation with null role slots (scaffold output)', () => {
    const f = validFoundation();
    const partial = {
      ...f,
      color: {
        ...f.color,
        accent: { primary: null, warning: null },
      },
      skillTodos: ['color.accent.primary', 'color.accent.warning'],
    };
    const result = PartialDesignFoundationSchema.safeParse(partial);
    expect(result.success).toBe(true);
  });

  it('accepts a foundation with null gradient slots', () => {
    const f = validFoundation();
    const partial = {
      ...f,
      gradient: { hero: null, subscribe: null },
      skillTodos: ['gradient.hero', 'gradient.subscribe'],
    };
    expect(PartialDesignFoundationSchema.safeParse(partial).success).toBe(true);
  });

  it('still rejects structurally-wrong partial foundations', () => {
    const f = validFoundation() as Partial<DesignFoundation>;
    delete f.version;
    expect(PartialDesignFoundationSchema.safeParse(f).success).toBe(false);
  });
});

describe('RoleObj (internal)', () => {
  it('rejects empty value', () => {
    expect(RoleObj.safeParse({ value: '', role: 'x', evidence: ['y'] }).success).toBe(false);
  });

  it('rejects empty role', () => {
    expect(RoleObj.safeParse({ value: 'x', role: '', evidence: ['y'] }).success).toBe(false);
  });
});
