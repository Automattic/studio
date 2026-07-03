import { describe, it, expect } from 'vitest';
import { renderMd } from './md-renderer.js';
import type { DesignFoundation } from './schema.js';

function foundation(overrides: Partial<DesignFoundation> = {}): DesignFoundation {
  const base: DesignFoundation = {
    version: 1,
    generatedAt: '2026-04-19T10:00:00.000Z',
    origin: 'https://example.com',
    inputsDigest: {
      palette: 'sha256:aaaaaaaabbbbbbbb',
      typography: 'sha256:cccccccc',
      breakpoints: 'sha256:dddddddd',
      manifest: 'sha256:eeeeeeee',
    },
    color: {
      surface: {
        base: { value: '#ffffff', role: 'page', evidence: ['palette[0]'] },
      },
      text: {
        default: { value: '#111', role: 'body', evidence: ['typography.body'] },
      },
      accent: {
        primary: { value: '#0066cc', role: 'CTA', evidence: ['button@homepage'] },
      },
      border: {
        default: { value: '#ddd', role: 'divider', evidence: ['palette[7]'] },
      },
    },
    gradient: {
      hero: { css: 'linear-gradient(to bottom, #000, #333)', role: 'hero bg', evidence: ['homepage.html:1'] },
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
    breakpoints: { sm: '480px', md: '768px', evidence: ['breakpoints.minWidth'] },
    radius: { base: '8px', evidence: [] },
    components: {
      button: { background: 'color.accent.primary', radius: 'radius.base' },
    },
    openQuestions: [],
    skillTodos: [],
    ...overrides,
  };
  return base;
}

describe('renderMd', () => {
  it('produces a title with the origin', () => {
    const md = renderMd(foundation());
    expect(md).toContain('# Design Foundation — https://example.com');
  });

  it('produces section headers per role in schema declaration order', () => {
    const md = renderMd(foundation());
    // Surface before text before accent before border
    const iSurface = md.indexOf('color.surface.base');
    const iText = md.indexOf('color.text.default');
    const iAccent = md.indexOf('color.accent.primary');
    const iBorder = md.indexOf('color.border.default');
    expect(iSurface).toBeGreaterThan(-1);
    expect(iText).toBeGreaterThan(iSurface);
    expect(iAccent).toBeGreaterThan(iText);
    expect(iBorder).toBeGreaterThan(iAccent);
  });

  it('emits screenshot path in evidence as image link when .png', () => {
    const f = foundation();
    f.color.accent.primary.evidence = ['screenshots/desktop/homepage.png'];
    const md = renderMd(f);
    expect(md).toContain('![');
    expect(md).toContain('](screenshots/desktop/homepage.png)');
  });

  it('does NOT render image link for non-image evidence', () => {
    const f = foundation();
    f.color.accent.primary.evidence = ['palette[5]:92urls'];
    const md = renderMd(f);
    expect(md).not.toContain('![palette');
  });

  it('rejects/escapes `../` segments in evidence image paths (no traversal link)', () => {
    const f = foundation();
    f.color.accent.primary.evidence = ['../../../etc/passwd.png'];
    const md = renderMd(f);
    // Should not render as a markdown image link
    expect(md).not.toMatch(/!\[.*\]\(\.\.\/\.\.\/\.\.\/etc\/passwd\.png\)/);
  });

  it('rejects absolute-path evidence as image link', () => {
    const f = foundation();
    f.color.accent.primary.evidence = ['/etc/passwd.png'];
    const md = renderMd(f);
    expect(md).not.toMatch(/!\[.*\]\(\/etc\/passwd\.png\)/);
  });

  it('escapes markdown-meaningful chars in values', () => {
    const f = foundation();
    f.color.accent.primary.role = 'CTA *bold* and `code` and [link](x)';
    const md = renderMd(f);
    // The rendered role string should have escaped *, `, [, ]
    expect(md).toContain('\\*bold\\*');
    expect(md).toContain('\\`code\\`');
    expect(md).toContain('\\[link\\]\\(x\\)');
  });

  it('replaces backticks inside inline code spans', () => {
    const f = foundation();
    f.color.accent.primary.value = '#0066cc`evil';
    const md = renderMd(f);
    // Backtick should be replaced with the unicode quote (not break inline code)
    expect(md).not.toMatch(/`[^`]*`[^`]*`evil/);
  });

  it('renders skillTodos section when any are present', () => {
    const f = foundation({
      skillTodos: ['color.accent.warning', 'typography.families.display'],
    });
    const md = renderMd(f);
    expect(md).toContain('Skill TODOs');
    expect(md).toContain('color.accent.warning');
    expect(md).toContain('typography.families.display');
  });

  it('omits skillTodos section when empty', () => {
    const md = renderMd(foundation());
    expect(md).not.toContain('Skill TODOs');
  });

  it('renders openQuestions with blockers marked', () => {
    const f = foundation({
      openQuestions: [
        { id: 'font-license', question: 'Confirm Fraunces substitution', blocksReplica: true },
        { id: 'glide-js', question: 'MIT ok?', blocksReplica: false },
      ],
    });
    const md = renderMd(f);
    expect(md).toContain('Open questions');
    expect(md).toContain('font-license');
    expect(md).toContain('blocks replica');
  });

  it('is stable across calls (deterministic diffs)', () => {
    const f = foundation();
    const a = renderMd(f);
    const b = renderMd(f);
    expect(a).toBe(b);
  });
});
