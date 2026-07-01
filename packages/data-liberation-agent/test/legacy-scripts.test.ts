import { describe, it, expect } from 'vitest';
import { existsSync, accessSync, constants } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');

const LEGACY_SCRIPTS = [
  'scripts/wix/discover.js',
  'scripts/wix/extract.js',
  'scripts/wix/probe.js',
  'scripts/wix/map-apis.js',
  'scripts/squarespace/discover.js',
  'scripts/squarespace/extract.js',
  'scripts/squarespace/import.js',
  'scripts/import.js',
  'cli.js',
];

describe('legacy scripts exist', () => {
  for (const script of LEGACY_SCRIPTS) {
    it(`${script} exists`, () => {
      expect(existsSync(join(ROOT, script))).toBe(true);
    });
  }

  it('start.sh exists and is executable', () => {
    const path = join(ROOT, 'start.sh');
    expect(existsSync(path)).toBe(true);
    accessSync(path, constants.X_OK); // throws if not executable
  });
});

describe('legacy scripts have valid syntax', () => {
  for (const script of LEGACY_SCRIPTS) {
    it(`${script} parses without syntax errors`, () => {
      // --check does a syntax parse without executing
      const result = execSync(`node --check ${join(ROOT, script)} 2>&1`, {
        encoding: 'utf8',
        timeout: 5000,
      });
      // node --check prints nothing on success
    });
  }
});

describe('legacy prompts exist', () => {
  it('prompts/wix.md exists', () => {
    expect(existsSync(join(ROOT, 'prompts/wix.md'))).toBe(true);
  });

  it('prompts/squarespace.md exists', () => {
    expect(existsSync(join(ROOT, 'prompts/squarespace.md'))).toBe(true);
  });
});
