import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDesignFoundationCli } from './design-foundation-runner.js';
import type { DesignFoundation } from '../lib/design-foundation/schema.js';

const TMP_ROOT = join(process.cwd(), '.tmp-test', 'design-foundation-runner');

function setupDir(name: string): string {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSp1Inputs(dir: string) {
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  writeFileSync(join(dir, 'palette.json'), JSON.stringify({
    version: 1,
    sampledUrls: 100,
    colors: [
      { hex: '#ffffff', count: 500, urls: 100 },
      { hex: '#111111', count: 400, urls: 95 },
    ],
  }));
  writeFileSync(join(dir, 'typography.json'), JSON.stringify({
    version: 1,
    sampledUrls: 100,
    bySelector: {
      body: [
        { fontFamily: 'Inter', fontSize: '16px', fontWeight: '400', lineHeight: '24px', urls: 100 },
      ],
    },
  }));
  writeFileSync(join(dir, 'breakpoints.json'), JSON.stringify({
    version: 1, sampledUrls: 100, minWidth: [768], maxWidth: [],
  }));
  writeFileSync(join(dir, 'screenshots', 'manifest.json'), JSON.stringify({
    version: 1, entries: {},
  }));
}

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
      surface: { base: { value: '#ffffff', role: 'p', evidence: ['e'] } },
      text: { default: { value: '#111', role: 'p', evidence: ['e'] } },
      accent: { primary: { value: '#0066cc', role: 'p', evidence: ['e'] } },
      border: { default: { value: '#ddd', role: 'p', evidence: ['e'] } },
    },
    gradient: {},
    typography: {
      families: { body: { value: 'Inter', role: 'body', evidence: ['e'] } },
      scale: { base: '16px', steps: { base: '16px' } },
      weights: [400],
    },
    spacing: {
      base: '4px',
      scale: { '1': '4px' },
      sections: { padY: '80px', padX: '40px', contentMaxWidth: '1200px' },
    },
    breakpoints: { evidence: [] },
    radius: { evidence: [] },
    components: {},
    openQuestions: [],
    skillTodos: [],
  };
}

describe('runDesignFoundationCli — scaffold mode', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('writes a template with TODO sentinels in empty slots', async () => {
    const dir = setupDir('scaffold-happy');
    writeSp1Inputs(dir);
    const r = await runDesignFoundationCli({ outputDir: dir, origin: 'https://example.com', silent: true });
    expect(r.exitCode).toBe(0);
    const jsonPath = join(dir, 'design-foundation.json');
    expect(existsSync(jsonPath)).toBe(true);
    const content = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(content.color.accent.primary).toEqual({ value: 'TODO', role: 'TODO', evidence: ['TODO'] });
    expect(content.color.text.default).not.toEqual({ value: 'TODO', role: 'TODO', evidence: ['TODO'] });
  });

  it('rejects scaffold when design-foundation.json already exists (without --force)', async () => {
    const dir = setupDir('scaffold-exists');
    writeSp1Inputs(dir);
    writeFileSync(join(dir, 'design-foundation.json'), '{}');
    const r = await runDesignFoundationCli({ outputDir: dir, origin: 'https://example.com', silent: true });
    expect(r.exitCode).toBe(1);
  });

  it('overwrites existing design-foundation.json with --force', async () => {
    const dir = setupDir('scaffold-force');
    writeSp1Inputs(dir);
    writeFileSync(join(dir, 'design-foundation.json'), '{"old": true}');
    const r = await runDesignFoundationCli({ outputDir: dir, origin: 'https://example.com', force: true, silent: true });
    expect(r.exitCode).toBe(0);
    const content = JSON.parse(readFileSync(join(dir, 'design-foundation.json'), 'utf8'));
    expect(content).not.toHaveProperty('old');
  });

  it('errors clearly when SP1 files are missing', async () => {
    const dir = setupDir('scaffold-no-sp1');
    const r = await runDesignFoundationCli({ outputDir: dir, origin: 'https://example.com', silent: true });
    expect(r.exitCode).toBe(1);
  });
});

describe('runDesignFoundationCli — --validate mode', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('errors when design-foundation.json is missing', async () => {
    const dir = setupDir('val-missing');
    const r = await runDesignFoundationCli({ outputDir: dir, validate: true, silent: true });
    expect(r.exitCode).toBe(1);
  });

  it('errors and does not write on malformed JSON', async () => {
    const dir = setupDir('val-malformed');
    writeFileSync(join(dir, 'design-foundation.json'), 'not json');
    const r = await runDesignFoundationCli({ outputDir: dir, validate: true, silent: true });
    expect(r.exitCode).toBe(1);
  });

  it('errors with zod issues on schema violation', async () => {
    const dir = setupDir('val-schema');
    writeFileSync(join(dir, 'design-foundation.json'), JSON.stringify({ origin: 'not-a-url' }));
    const r = await runDesignFoundationCli({ outputDir: dir, validate: true, silent: true });
    expect(r.exitCode).toBe(1);
    expect(r.errors?.length).toBeGreaterThan(0);
  });

  it('passes on a valid filled foundation', async () => {
    const dir = setupDir('val-ok');
    writeFileSync(join(dir, 'design-foundation.json'), JSON.stringify(validFoundation()));
    const r = await runDesignFoundationCli({ outputDir: dir, validate: true, silent: true });
    expect(r.exitCode).toBe(0);
  });

  it('fails when skillTodos path is still TODO', async () => {
    const dir = setupDir('val-todo');
    const f = validFoundation();
    f.skillTodos = ['color.accent.primary'];
    f.color.accent.primary = { value: 'TODO', role: 'TODO', evidence: ['TODO'] };
    writeFileSync(join(dir, 'design-foundation.json'), JSON.stringify(f));
    const r = await runDesignFoundationCli({ outputDir: dir, validate: true, silent: true });
    expect(r.exitCode).toBe(1);
  });
});

describe('runDesignFoundationCli — --render-md mode', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('regenerates design-foundation.md from design-foundation.json without validation errors', async () => {
    const dir = setupDir('rmd-ok');
    writeFileSync(join(dir, 'design-foundation.json'), JSON.stringify(validFoundation()));
    const r = await runDesignFoundationCli({ outputDir: dir, renderMd: true, silent: true });
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(dir, 'design-foundation.md'))).toBe(true);
  });

  it('errors when design-foundation.json is missing', async () => {
    const dir = setupDir('rmd-missing');
    const r = await runDesignFoundationCli({ outputDir: dir, renderMd: true, silent: true });
    expect(r.exitCode).toBe(1);
  });

  it('errors when JSON fails schema', async () => {
    const dir = setupDir('rmd-bad');
    writeFileSync(join(dir, 'design-foundation.json'), JSON.stringify({ bad: true }));
    const r = await runDesignFoundationCli({ outputDir: dir, renderMd: true, silent: true });
    expect(r.exitCode).toBe(1);
  });
});
