import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateSlug,
  safeRelativePath,
  sanitizeReplicaFile,
  validateReplicaInputs,
  writeReplicaFilesToHost,
} from './replica-install.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

describe('validateSlug', () => {
  it('accepts kebab-case slugs', () => {
    expect(() => validateSlug('foo', 'theme')).not.toThrow();
    expect(() => validateSlug('foo-bar', 'theme')).not.toThrow();
    expect(() => validateSlug('foo123', 'theme')).not.toThrow();
    expect(() => validateSlug('a1-b2', 'theme')).not.toThrow();
  });

  it('rejects uppercase, leading dash, dots, spaces', () => {
    expect(() => validateSlug('Foo', 'theme')).toThrow();
    expect(() => validateSlug('-foo', 'theme')).toThrow();
    expect(() => validateSlug('foo.bar', 'theme')).toThrow();
    expect(() => validateSlug('foo bar', 'theme')).toThrow();
    expect(() => validateSlug('', 'theme')).toThrow();
  });

  it('rejects double dashes', () => {
    expect(() => validateSlug('foo--bar', 'theme')).toThrow();
  });
});

describe('safeRelativePath', () => {
  it('accepts simple paths', () => {
    expect(safeRelativePath('style.css')).toBe('style.css');
    expect(safeRelativePath('templates/index.html')).toBe('templates/index.html');
    expect(safeRelativePath('parts/header.html')).toBe('parts/header.html');
  });

  it('rejects empty paths', () => {
    expect(() => safeRelativePath('')).toThrow();
  });

  it('rejects absolute paths', () => {
    expect(() => safeRelativePath('/etc/passwd')).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => safeRelativePath('../../../etc/passwd')).toThrow();
    expect(() => safeRelativePath('templates/../../../escape')).toThrow();
    expect(() => safeRelativePath('..')).toThrow();
    expect(() => safeRelativePath('foo/..')).toThrow();
  });
});

describe('validateReplicaInputs', () => {
  it('passes for empty input', () => {
    expect(() => validateReplicaInputs(undefined, undefined, undefined)).not.toThrow();
    expect(() => validateReplicaInputs([], [], 'foo')).not.toThrow();
  });

  it('requires themeSlug when themeFiles non-empty', () => {
    expect(() =>
      validateReplicaInputs([{ relativePath: 'style.css', content: '' }], undefined, undefined),
    ).toThrow(/themeSlug is required/);
  });

  it('rejects bad slugs and bad paths', () => {
    expect(() =>
      validateReplicaInputs([{ relativePath: 'style.css', content: '' }], undefined, 'Foo'),
    ).toThrow(/Invalid theme slug/);
    expect(() =>
      validateReplicaInputs([{ relativePath: '../escape', content: '' }], undefined, 'foo'),
    ).toThrow(/path traversal/);
  });

  it('rejects hand-authored Custom HTML blocks in generated theme files', () => {
    expect(() =>
      validateReplicaInputs([
        {
          relativePath: 'patterns/contact.php',
          content: '<!-- wp:html --><style>.x{color:red}</style><div>Contact</div><!-- /wp:html -->',
        },
      ], undefined, 'foo'),
    ).toThrow(/Custom HTML/);
  });

  // The pipeline's pattern-file header, as emitted by reconstructPagePattern.
  const PIPELINE_HEADER =
    '<?php\n/**\n * Title: Home\n * Slug: demo-replica/page-home\n * Categories: featured\n * Inserter: false\n */\n?>\n';
  const MARKED_ISLAND =
    '<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->\n<section><p>Verbatim copy</p></section>\n<!-- /wp:html -->';
  const BARE_ISLAND = '<!-- wp:html -->\n<section><p>Verbatim copy</p></section>\n<!-- /wp:html -->';

  it('accepts a pipeline-marked coverage island (theme reinstall)', () => {
    expect(() =>
      validateReplicaInputs(
        [{ relativePath: 'patterns/page-home.php', content: PIPELINE_HEADER + MARKED_ISLAND }],
        undefined,
        'foo',
      ),
    ).not.toThrow();
  });

  it('accepts a LEGACY bare island inside a pipeline-emitted pattern file (pre-marker themes)', () => {
    expect(() =>
      validateReplicaInputs(
        [{ relativePath: 'patterns/page-home.php', content: PIPELINE_HEADER + BARE_ISLAND }],
        undefined,
        'foo',
      ),
    ).not.toThrow();
  });

  it('rejects a bare island in a non-pattern file even when the pipeline header is present', () => {
    expect(() =>
      validateReplicaInputs(
        [{ relativePath: 'templates/page.php', content: PIPELINE_HEADER + BARE_ISLAND }],
        undefined,
        'foo',
      ),
    ).toThrow(/Custom HTML/);
  });

  it('rejects a mixed file: one marked island plus one bare wp:html outside a pipeline pattern', () => {
    expect(() =>
      validateReplicaInputs(
        [{ relativePath: 'parts/footer.html', content: MARKED_ISLAND + '\n' + BARE_ISLAND }],
        undefined,
        'foo',
      ),
    ).toThrow(/Custom HTML/);
  });
});

describe('sanitizeReplicaFile', () => {
  it('removes invalid origin-keyed spacingScale=false from theme.json', () => {
    const file = sanitizeReplicaFile({
      relativePath: 'theme.json',
      content: JSON.stringify({
        version: 3,
        settings: {
          spacing: {
            spacingScale: { theme: false },
            spacingSizes: [{ slug: '1', size: '4px', name: '4' }],
          },
        },
      }),
    });

    const parsed = JSON.parse(file.content);
    expect(parsed.settings.spacing.spacingScale).toBeUndefined();
    expect(parsed.settings.spacing.spacingSizes).toEqual([{ slug: '1', size: '4px', name: '4' }]);
  });

  it('sanitizes theme.json before writing to host', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'rh-themejson-'));
    try {
      const wpRoot = join(dir, 'wordpress');
      writeReplicaFilesToHost({
        wpRoot,
        themeSlug: 'foo',
        themeFiles: [
          {
            relativePath: 'theme.json',
            content: JSON.stringify({
              version: 3,
              settings: { spacing: { spacingScale: { theme: false } } },
            }),
          },
        ],
      });

      const written = JSON.parse(readFileSync(join(wpRoot, 'wp-content', 'themes', 'foo', 'theme.json'), 'utf8'));
      expect(written.settings.spacing.spacingScale).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('writeReplicaFilesToHost', () => {
  it('writes theme files into wp-content/themes/<slug>/...', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'rh-theme-'));
    try {
      const wpRoot = join(dir, 'wordpress');
      const result = writeReplicaFilesToHost({
        wpRoot,
        themeSlug: 'getsnooz-replica',
        themeFiles: [
          { relativePath: 'style.css', content: '/* theme */\n' },
          { relativePath: 'templates/index.html', content: '<!-- index -->\n' },
          { relativePath: 'parts/header.html', content: '<!-- header -->\n' },
        ],
      });
      expect(result.themeWritten).toBe(3);
      const root = join(wpRoot, 'wp-content', 'themes', 'getsnooz-replica');
      expect(readFileSync(join(root, 'style.css'), 'utf8')).toContain('/* theme */');
      expect(readFileSync(join(root, 'templates/index.html'), 'utf8')).toContain('index');
      expect(readFileSync(join(root, 'parts/header.html'), 'utf8')).toContain('header');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copies on-disk binary assets (fonts/logo) from assetSourceDir into the theme', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'rh-assets-'));
    try {
      const wpRoot = join(dir, 'wordpress');
      // On-disk theme assets (as the font/logo pipeline writes them), incl. a
      // nested fonts/ dir — none of these are carried as string themeFiles.
      const src = join(dir, 'theme');
      mkdirSync(join(src, 'assets', 'fonts'), { recursive: true });
      writeFileSync(join(src, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(join(src, 'assets', 'fonts', 'larsseit.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
      const result = writeReplicaFilesToHost({
        wpRoot,
        themeSlug: 'site-replica',
        themeFiles: [{ relativePath: 'style.css', content: '/* t */' }],
        assetSourceDir: src,
      });
      expect(result.assetsCopied).toBe(2);
      const root = join(wpRoot, 'wp-content', 'themes', 'site-replica');
      expect(existsSync(join(root, 'assets', 'logo.png'))).toBe(true);
      expect(existsSync(join(root, 'assets', 'fonts', 'larsseit.woff2'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes plugin files and reports pluginSlugs', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'rh-plugin-'));
    try {
      const wpRoot = join(dir, 'wordpress');
      const result = writeReplicaFilesToHost({
        wpRoot,
        blockPlugins: [
          {
            slug: 'getsnooz-replica-blocks',
            files: [
              { relativePath: 'getsnooz-replica-blocks.php', content: '<?php // plugin ?>' },
              { relativePath: 'src/hero/block.json', content: '{}' },
            ],
          },
        ],
      });
      expect(result.pluginsWritten).toBe(2);
      expect(result.pluginSlugs).toEqual(['getsnooz-replica-blocks']);
      const root = join(wpRoot, 'wp-content', 'plugins', 'getsnooz-replica-blocks');
      expect(existsSync(join(root, 'getsnooz-replica-blocks.php'))).toBe(true);
      expect(existsSync(join(root, 'src/hero/block.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to write files that traverse outside the theme root', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'rh-evil-'));
    try {
      expect(() =>
        writeReplicaFilesToHost({
          wpRoot: join(dir, 'wordpress'),
          themeSlug: 'foo',
          themeFiles: [{ relativePath: '../../../evil.php', content: '<?php // pwned ?>' }],
        }),
      ).toThrow(/path traversal/);
      // Sanity: nothing got written outside the temp dir.
      expect(existsSync(join(dir, 'wordpress', 'wp-content', 'themes', 'foo'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

