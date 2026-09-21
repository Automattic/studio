import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..');
const BUNDLE_PATHS = ['dist/mcp-server.bundle.mjs', 'dist/capture-engine.bundle.mjs'];

// Replay concurrent source PRs across a main-owned bundle rebuild, using
// ordinary Git merge behavior (the same constraint as GitHub).
describe('main-owned generated bundles', () => {
  let repoDir: string;

  function git(...args: string[]): string {
    return execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], {
      cwd: repoDir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
  }

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'gitattributes-bundle-'));
    git('init', '-q', '-b', 'main');

    copyFileSync(join(REPO_ROOT, '.gitattributes'), join(repoDir, '.gitattributes'));
    mkdirSync(join(repoDir, 'dist'), { recursive: true });
    for (const path of BUNDLE_PATHS) {
      writeFileSync(join(repoDir, path), 'base bundle output\n');
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('branch', '-q', 'branch-a');
    git('branch', '-q', 'branch-b');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('merges independent source branches after main regenerates bundles without a custom driver', () => {
    git('checkout', '-q', 'branch-a');
    writeFileSync(join(repoDir, 'source-a.ts'), 'export const a = 1;\n');
    git('add', 'source-a.ts');
    git('commit', '-q', '-m', 'source change a');

    git('checkout', '-q', 'branch-b');
    writeFileSync(join(repoDir, 'source-b.ts'), 'export const b = 2;\n');
    git('add', 'source-b.ts');
    git('commit', '-q', '-m', 'source change b');

    git('checkout', '-q', 'main');
    git('merge', '--no-edit', 'branch-a');
    for (const path of BUNDLE_PATHS) {
      writeFileSync(join(repoDir, path), 'main rebuilt with source a\n');
    }
    git('commit', '-q', '-am', 'build: regenerate plugin bundles');

    expect(() => git('merge', '--no-edit', 'branch-b')).not.toThrow();
    for (const path of BUNDLE_PATHS) {
      expect(readFileSync(join(repoDir, path), 'utf8')).toBe('main rebuilt with source a\n');
    }
    expect(readFileSync(join(repoDir, 'source-a.ts'), 'utf8')).toContain('a = 1');
    expect(readFileSync(join(repoDir, 'source-b.ts'), 'utf8')).toContain('b = 2');
    // The post-merge rebuild now includes both source changes.
    for (const path of BUNDLE_PATHS) writeFileSync(join(repoDir, path), 'main rebuilt with source a and b\n');
    git('commit', '-q', '-am', 'build: regenerate plugin bundles');
    expect(git('status', '--porcelain')).toBe('');
  });
});
