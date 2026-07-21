//
// End-to-end: fixture inputs → scaffold → skill-fills-slots (mocked) →
// validate → save → read json+md from disk. No browsers, no AI.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { scaffoldDesignFoundation } from './scaffold.js';
import { DesignFoundationSchema, type DesignFoundation, type PartialDesignFoundation, type Role } from './schema.js';
import { saveDesignFoundation } from './save.js';

const FIXTURE = join(process.cwd(), 'src/lib/design-foundation/__fixtures__/tiny-site');
const TMP_ROOT = join(process.cwd(), '.tmp-test', 'design-foundation-integration');

function mockSkillFill(partial: PartialDesignFoundation): DesignFoundation {
  // Mimics what the `design-foundations` skill would produce: fills every
  // null role slot with a plausible RoleObj. Evidence references fixture
  // screenshot paths.
  const filled = JSON.parse(JSON.stringify(partial)) as DesignFoundation;
  const fill = (v: Role | null | undefined, value: string, role: string): Role =>
    v ?? { value, role, evidence: ['skill-filled'] };

  filled.color.surface.raised = fill(
    (partial.color?.surface?.raised ?? null) as Role | null,
    '#f5f5f5',
    'alternate surface',
  );
  filled.color.surface.inverse = fill(
    (partial.color?.surface?.inverse ?? null) as Role | null,
    '#1d212e',
    'dark hero bg',
  );
  filled.color.text.muted = fill((partial.color?.text?.muted ?? null) as Role | null, '#666', 'muted text');
  filled.color.text.inverse = fill(
    (partial.color?.text?.inverse ?? null) as Role | null,
    '#ffffff',
    'text on dark surfaces',
  );
  filled.color.text.subtle = fill((partial.color?.text?.subtle ?? null) as Role | null, '#999', 'subtle ui');
  filled.color.accent.primary = fill(
    (partial.color?.accent?.primary ?? null) as Role | null,
    '#00a4bd',
    'primary CTA',
  );
  filled.color.accent.primaryAlt = fill(
    (partial.color?.accent?.primaryAlt ?? null) as Role | null,
    '#0693a4',
    'primary CTA hover',
  );
  filled.color.accent.warning = fill(
    (partial.color?.accent?.warning ?? null) as Role | null,
    '#f2545b',
    'urgent CTA',
  );
  filled.color.accent.warm = fill(
    (partial.color?.accent?.warm ?? null) as Role | null,
    '#e45f4d',
    'secondary accent',
  );
  filled.color.accent.highlight = fill(
    (partial.color?.accent?.highlight ?? null) as Role | null,
    '#ffc700',
    'highlight',
  );
  filled.color.border.default = fill(
    (partial.color?.border?.default ?? null) as Role | null,
    '#cccccc',
    'divider',
  );
  filled.color.border.subtle = fill(
    (partial.color?.border?.subtle ?? null) as Role | null,
    '#d3d3d3',
    'subtle divider',
  );

  filled.typography.families.display = fill(
    (partial.typography?.families?.display ?? null) as Role | null,
    'Reckless, serif',
    'display headlines',
  );
  filled.typography.families.mono = fill(
    (partial.typography?.families?.mono ?? null) as Role | null,
    'Space Mono, monospace',
    'small caps labels',
  );

  // Gradient roles: scaffold leaves role: 'TODO'; skill promotes.
  for (const k of Object.keys(filled.gradient)) {
    filled.gradient[k]!.role = 'hero background';
  }

  // Components (minimal fixed set).
  filled.components = {
    button: { background: 'color.accent.primary', radius: 'radius.base' },
    input: { background: 'color.surface.base', border: 'color.border.default' },
    card: { background: 'color.surface.base', padding: 'spacing.4' },
    surface: { background: 'color.surface.base' },
    divider: { background: 'color.border.default' },
  };

  filled.skillTodos = [];
  return filled;
}

describe('design-foundation integration', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('scaffold → skill fill (mocked) → validate → save produces expected files', () => {
    const work = join(TMP_ROOT, 'run1');
    mkdirSync(work, { recursive: true });
    cpSync(FIXTURE, work, { recursive: true });

    // 1. Scaffold deterministically
    const partial = scaffoldDesignFoundation(work, { origin: 'https://example.com' });
    expect(partial.color!.surface!.base).toMatchObject({ value: '#ffffff' });
    expect(partial.color!.text!.default).toMatchObject({ value: '#1d212e' });
    expect(partial.color!.accent!.primary).toBeNull();
    expect(Object.keys(partial.gradient!).length).toBeGreaterThan(0);
    expect(partial.skillTodos!.length).toBeGreaterThan(0);

    // 2. Mock skill fill
    const filled = mockSkillFill(partial);

    // 3. Validate
    const parsed = DesignFoundationSchema.safeParse(filled);
    expect(parsed.success).toBe(true);

    // 4. Save
    const saveResult = saveDesignFoundation(work, filled);
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) throw new Error('save failed');
    expect(saveResult.unchanged).toBe(false);

    // 5. Read back from disk
    const jsonPath = join(work, 'design-foundation.json');
    const mdPath = join(work, 'design-foundation.md');
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    const onDisk = JSON.parse(readFileSync(jsonPath, 'utf8')) as DesignFoundation;
    expect(onDisk.origin).toBe('https://example.com');
    expect(onDisk.color.accent.primary.value).toBe('#00a4bd');
    expect(onDisk.color.surface.base.value).toBe('#ffffff');
    expect(onDisk.skillTodos).toEqual([]);

    const md = readFileSync(mdPath, 'utf8');
    expect(md).toContain('# Design Foundation — https://example.com');
    expect(md).toContain('color.accent.primary');
    expect(md).toContain('#00a4bd');
    expect(md).not.toContain('Skill TODOs');

    // 6. Re-save with same inputs → unchanged
    const second = saveDesignFoundation(work, filled);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.unchanged).toBe(true);
  });
});
