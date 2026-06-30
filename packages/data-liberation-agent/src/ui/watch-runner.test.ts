import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  buildComposePagePrompt,
  buildThemePieceBatchPrompt,
  buildJudgmentPrompt,
  buildReplicaBriefMarkdown,
  ensureFinalFoundationJudgment,
  markThemePieceHandled,
  parseThemePieceDoneMarker,
  shouldDeferFoundationJudgment,
  shouldHoldPostFlushForMediaInstall,
  shouldPrioritizeThemeScaffoldDrain,
  themePieceJudgmentsPending,
} from './watch-runner.js';

const TMP_ROOT = join(process.cwd(), '.tmp-test', 'watch-runner');
mkdirSync(TMP_ROOT, { recursive: true });

function makeDirs() {
  const outDir = mkdtempSync(join(TMP_ROOT, 'out-'));
  const studioSitePath = mkdtempSync(join(TMP_ROOT, 'studio-'));
  mkdirSync(join(studioSitePath, 'wordpress', 'wp-content'), { recursive: true });
  return { outDir, studioSitePath };
}

function themeSlugFor(outDir: string): string {
  const base = basename(outDir).toLowerCase();
  const sanitized = base.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized ? `${sanitized}-replica` : 'site-replica';
}

describe('shouldPrioritizeThemeScaffoldDrain', () => {
  it('prioritizes Studio drain once the foundation exists and scaffold is not installed', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      writeFileSync(join(outDir, 'design-foundation.json'), '{}', 'utf8');

      expect(shouldPrioritizeThemeScaffoldDrain(outDir, studioSitePath, true)).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });

  it('does not prioritize Studio drain before the foundation exists', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      expect(shouldPrioritizeThemeScaffoldDrain(outDir, studioSitePath, true)).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });

  it('does not prioritize Studio drain after the scaffold is already installed', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      writeFileSync(join(outDir, 'design-foundation.json'), '{}', 'utf8');
      const themeDir = join(studioSitePath, 'wordpress', 'wp-content', 'themes', themeSlugFor(outDir));
      mkdirSync(themeDir, { recursive: true });
      writeFileSync(join(themeDir, 'style.css'), '/* installed */', 'utf8');

      expect(shouldPrioritizeThemeScaffoldDrain(outDir, studioSitePath, true)).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });
});

describe('shouldHoldPostFlushForMediaInstall', () => {
  it('holds post flushing when media install reports errors', () => {
    expect(shouldHoldPostFlushForMediaInstall({
      installed: [],
      skipped: [],
      errors: [{ sourceUrl: 'https://cdn/a.jpg', error: 'studio failed' }],
      svg: { svgUploaded: 0, svgSubstituted: 0, svgFailed: 0, safeSvgEnsured: false },
    })).toBe(true);
  });

  it('allows post flushing when media install has no errors', () => {
    expect(shouldHoldPostFlushForMediaInstall({
      installed: [{ sourceUrl: 'https://cdn/a.jpg', postId: 1, localUrl: 'http://local/a.jpg', localPath: 'a.jpg' }],
      skipped: [],
      errors: [],
      svg: { svgUploaded: 0, svgSubstituted: 0, svgFailed: 0, safeSvgEnsured: false },
    })).toBe(false);
  });
});

describe('themePieceJudgmentsPending', () => {
  it('queues piecewise theme generation once the foundation exists', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      writeFileSync(join(outDir, 'design-foundation.json'), '{}', 'utf8');

      const pieces = themePieceJudgmentsPending(outDir, true);

      expect(pieces.map((j) => j.inputs.themePiece)).toEqual([
        'foundation',
        'header',
        'footer',
        'homepage',
      ]);
      expect(pieces[0].kind).toBe('theme-piece');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });

  it('resumes at the first unfinished theme piece', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      expect(themePieceJudgmentsPending(outDir, true)).toEqual([]);

      writeFileSync(join(outDir, 'design-foundation.json'), '{}', 'utf8');
      expect(themePieceJudgmentsPending(outDir, false)).toEqual([]);

      markThemePieceHandled(outDir, 'foundation', {
        agent: 'codex',
        durationMs: 123,
      });
      markThemePieceHandled(outDir, 'header', {
        agent: 'codex',
        durationMs: 456,
      });

      expect(themePieceJudgmentsPending(outDir, true).map((j) => j.inputs.themePiece)).toEqual([
        'footer',
        'homepage',
      ]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });
});

describe('buildJudgmentPrompt', () => {
  it('uses replicate for the theme foundation piece', () => {
    const prompt = buildJudgmentPrompt({
      kind: 'theme-piece',
      rationale: 'foundation ready',
      inputs: { outputDir: '/tmp/site', themePiece: 'foundation' },
    }, '/tmp/site', '/tmp/studio-site');

    expect(prompt).toContain('/data-liberation:replicate outputDir=/tmp/site');
    expect(prompt).toContain('theme foundation generation pass');
    expect(prompt).toContain('Non-negotiable parity target');
    expect(prompt).toContain('match the source site');
    expect(prompt).toContain('Do not create a generic theme');
    expect(prompt).toContain('Emit only style.css, theme.json, functions.php');
    expect(prompt).toContain('HTML/CSS-first');
    expect(prompt).toContain('Do not emit Custom HTML');
    expect(prompt).toContain('CSS belongs in style.css');
    expect(prompt).toContain('Use existing WordPress core blocks first');
    expect(prompt).toContain('Do not set settings.spacing.spacingScale.theme to false');
    expect(prompt).toContain('Do not open screenshots during this theme-piece pass unless');
    expect(prompt).toContain('homepage rendered HTML');
    expect(prompt).toContain('liberate_install_theme');
    expect(prompt).not.toContain('/data-liberation:design-foundations');
    expect(prompt).toContain('Do not call liberate_preview');
  });

  it('passes the exact shell theme slug so replicate overwrites the scaffold theme', () => {
    const prompt = buildJudgmentPrompt({
      kind: 'theme-piece',
      rationale: 'foundation ready',
      inputs: { outputDir: '/tmp/www.swiftlumber.com', themePiece: 'header' },
    }, '/tmp/www.swiftlumber.com', '/tmp/studio-site');

    expect(prompt).toContain('themeSlug: "www-swiftlumber-com-replica"');
    expect(prompt).toContain('overwrite the existing shell theme');
    expect(prompt).not.toContain('themeSlug: "<siteSlug>-replica"');
  });

  it('scopes prompts to individual theme pieces', () => {
    const header = buildJudgmentPrompt({
      kind: 'theme-piece',
      rationale: 'header ready',
      inputs: { outputDir: '/tmp/site', themePiece: 'header' },
    }, '/tmp/site', '/tmp/studio-site');
    const footer = buildJudgmentPrompt({
      kind: 'theme-piece',
      rationale: 'footer ready',
      inputs: { outputDir: '/tmp/site', themePiece: 'footer' },
    }, '/tmp/site', '/tmp/studio-site');
    const homepage = buildJudgmentPrompt({
      kind: 'theme-piece',
      rationale: 'homepage ready',
      inputs: { outputDir: '/tmp/site', themePiece: 'homepage' },
    }, '/tmp/site', '/tmp/studio-site');

    expect(header).toContain('Emit only parts/header.html');
    expect(header).toContain('Read base-theme-brief.md before generating this checkpoint');
    expect(footer).toContain('Emit only parts/footer.html');
    expect(footer).toContain('Read base-theme-brief.md before generating this checkpoint');
    expect(homepage).toContain('Emit only templates/index.html');
    expect(homepage).toContain('Read base-theme-brief.md before generating this checkpoint');
    expect(homepage).toContain('homepage patterns');
  });

  it('builds a readable replica brief for parallel workers', () => {
    const markdown = buildReplicaBriefMarkdown({
      outputDir: '/tmp/site',
      studioSitePath: '/tmp/studio-site',
      themeSlug: 'site-replica',
      designFoundation: {
        color: { accent: { primary: '#b00' } },
        typography: { families: { body: 'Inter' } },
      },
      evidenceFiles: {
        homepageHtml: true,
        computedStyles: true,
        palette: true,
        typography: true,
        breakpoints: true,
      },
    });

    expect(markdown).toContain('# Replica Brief');
    expect(markdown).toContain('site-replica');
    expect(markdown).toContain('parts/header.html');
    expect(markdown).toContain('parts/footer.html');
    expect(markdown).toContain('templates/index.html');
    expect(markdown).toContain('design-foundation.json');
    expect(markdown).toContain('computed-styles.json');
    expect(markdown).toContain('Inter');
    expect(markdown).toContain('Do not use Custom HTML');
    expect(markdown).toContain('CSS belongs in style.css');
    expect(markdown).toContain('Do not set `settings.spacing.spacingScale.theme` to `false`');
  });

  it('builds a single long-running prompt for ordered theme pieces', () => {
    const prompt = buildThemePieceBatchPrompt([
      {
        kind: 'theme-piece',
        rationale: 'foundation',
        inputs: { outputDir: '/tmp/site', themePiece: 'foundation' },
      },
      {
        kind: 'theme-piece',
        rationale: 'header',
        inputs: { outputDir: '/tmp/site', themePiece: 'header' },
      },
    ], '/tmp/site', '/tmp/studio-site');

    expect(prompt).toContain('/data-liberation:replicate outputDir=/tmp/site');
    expect(prompt).toContain('one long-running agent process');
    expect(prompt).toContain('DLA_THEME_PIECE_DONE:foundation');
    expect(prompt).toContain('DLA_THEME_PIECE_DONE:header');
    expect(prompt.indexOf('themePiece: "foundation"')).toBeLessThan(prompt.indexOf('themePiece: "header"'));
    expect(prompt).toContain('themeSlug: "site-replica"');
    expect(prompt).toContain('Install each checkpoint immediately');
    expect(prompt).toContain('Do not emit Custom HTML');
    expect(prompt).toContain('CSS belongs in style.css');
  });

  it('parses theme piece done markers from streamed agent output', () => {
    expect(parseThemePieceDoneMarker('DLA_THEME_PIECE_DONE:header')).toBe('header');
    expect(parseThemePieceDoneMarker('  DLA_THEME_PIECE_DONE:footer  ')).toBe('footer');
    expect(parseThemePieceDoneMarker('DLA_THEME_PIECE_DONE:nope')).toBeNull();
    expect(parseThemePieceDoneMarker('ordinary output')).toBeNull();
  });

  it('makes design foundation generation HTML/CSS-first and screenshot-optional', () => {
    const prompt = buildJudgmentPrompt({
      kind: 'foundation-rev',
      rationale: 'final',
      inputs: { outputDir: '/tmp/site' },
    }, '/tmp/site', '/tmp/studio-site');

    expect(prompt).toContain('/data-liberation:design-foundations outputDir=/tmp/site');
    expect(prompt).toContain('HTML/CSS-first');
    expect(prompt).toContain('computed-styles.json');
    expect(prompt).toContain('Do not open screenshots during this step unless');
    expect(prompt).toContain('Use the homepage rendered HTML');
  });

  it('keeps archetype template prompts on semantic blocks and theme CSS', () => {
    const prompt = buildJudgmentPrompt({
      kind: 'archetype-template',
      archetype: 'page',
      rationale: 'first page observed',
      inputs: { outputDir: '/tmp/site' },
    }, '/tmp/site', '/tmp/studio-site');

    expect(prompt).toContain('/data-liberation:replicate outputDir=/tmp/site archetype=page');
    expect(prompt).toContain('Do not emit Custom HTML');
    expect(prompt).toContain('core/html');
    expect(prompt).toContain('CSS belongs in style.css');
    expect(prompt).toContain('Use existing WordPress core blocks first');
  });

  it('keeps page composition prompts from using Custom HTML blocks', () => {
    const prompt = buildComposePagePrompt({
      url: 'https://example.com/about',
      outDir: '/tmp/site',
      archetype: 'page',
      slug: 'about',
      archetypeTemplateExists: true,
    });

    expect(prompt).toContain('/data-liberation:compose-page-blocks');
    expect(prompt).toContain('Do not emit Custom HTML');
    expect(prompt).toContain('core/html');
    expect(prompt).toContain('Use existing WordPress core blocks first');
    expect(prompt).toContain('CSS belongs in style.css');
  });
});

describe('shouldDeferFoundationJudgment', () => {
  it('defers foundation judgments until aggregate inputs exist', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      expect(shouldDeferFoundationJudgment({
        kind: 'foundation-rev',
        rationale: 'periodic',
        inputs: { outputDir: outDir },
      }, outDir)).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });

  it('allows foundation judgments once aggregate inputs exist', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      writeFileSync(join(outDir, 'palette.json'), '{}', 'utf8');
      writeFileSync(join(outDir, 'typography.json'), '{}', 'utf8');
      writeFileSync(join(outDir, 'breakpoints.json'), '{}', 'utf8');

      expect(shouldDeferFoundationJudgment({
        kind: 'foundation-rev',
        rationale: 'periodic',
        inputs: { outputDir: outDir },
      }, outDir)).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });
});

describe('ensureFinalFoundationJudgment', () => {
  it('adds a final foundation judgment for small runs once aggregate inputs exist', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      writeFileSync(join(outDir, 'palette.json'), '{}', 'utf8');
      writeFileSync(join(outDir, 'typography.json'), '{}', 'utf8');
      writeFileSync(join(outDir, 'breakpoints.json'), '{}', 'utf8');

      const judgments = ensureFinalFoundationJudgment([], outDir);

      expect(judgments).toHaveLength(1);
      expect(judgments[0].kind).toBe('foundation-rev');
      expect(judgments[0].inputs.tickReason).toBe('final');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });

  it('does not add a duplicate final foundation judgment', () => {
    const { outDir, studioSitePath } = makeDirs();
    try {
      writeFileSync(join(outDir, 'palette.json'), '{}', 'utf8');
      writeFileSync(join(outDir, 'typography.json'), '{}', 'utf8');
      writeFileSync(join(outDir, 'breakpoints.json'), '{}', 'utf8');

      const existing = {
        kind: 'foundation-rev' as const,
        rationale: 'periodic',
        inputs: { outputDir: outDir, tickReason: 'periodic' },
      };

      expect(ensureFinalFoundationJudgment([existing], outDir)).toEqual([existing]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(studioSitePath, { recursive: true, force: true });
    }
  });
});
