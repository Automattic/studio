import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..');
const BUNDLE_PATHS = ['dist/mcp-server.bundle.mjs', 'dist/capture-engine.bundle.mjs'];

// Regenerating dist/*.bundle.mjs produces different bytes on every branch
// that touches src/, even when the source changes don't overlap, because
// the bundles are minified — so two branches that both regenerate them
// conflict on them by construction (#234). This exercises the committed
// .gitattributes against a real `git merge` rather than asserting on its
// text, so it actually proves the declared `merge=ours` strategy resolves
// that conflict instead of just asserting the right string is present.
describe('.gitattributes bundle merge strategy', () => {
  let repoDir: string;

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });
  }

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'gitattributes-bundle-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    // Driver definitions live in git config, never in the repository (that
    // would let a committed .gitattributes run arbitrary commands on every
    // clone), so a contributor sets this once, locally, per AGENTS.md.
    git('config', 'merge.ours.driver', 'true');

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

  it('merges two branches that independently regenerate the bundles without conflict', () => {
    git('checkout', '-q', 'branch-a');
    for (const path of BUNDLE_PATHS) {
      writeFileSync(join(repoDir, path), 'branch-a regenerated output\n');
    }
    git('commit', '-q', '-am', 'branch-a regenerates bundles');

    git('checkout', '-q', 'branch-b');
    for (const path of BUNDLE_PATHS) {
      writeFileSync(join(repoDir, path), 'branch-b regenerated output\n');
    }
    git('commit', '-q', '-am', 'branch-b regenerates bundles');

    git('checkout', '-q', 'branch-a');
    expect(() => git('merge', '--no-edit', 'branch-b')).not.toThrow();

    for (const path of BUNDLE_PATHS) {
      const merged = readFileSync(join(repoDir, path), 'utf8');
      expect(merged).toBe('branch-a regenerated output\n');
      expect(merged).not.toContain('<<<<<<<');
    }
  });
});
