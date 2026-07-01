//
// Save — persist a validated DesignFoundation to disk and generate the MD
// companion. Atomic tmp+rename for both files. Skip-if-unchanged via
// inputsDigest match when force=false.
//
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DesignFoundationSchema, type DesignFoundation } from './schema.js';
import { validateOutputDir } from '../screenshot/output-layout.js';
import { renderMd } from './md-renderer.js';

export interface SaveOpts {
  force?: boolean;
}

export type SaveResult =
  | { ok: true; jsonPath: string; mdPath: string; unchanged: boolean }
  | { ok: false; errors: z.ZodIssue[] };

export function saveDesignFoundation(
  outputDir: string,
  foundation: unknown,
  opts: SaveOpts = {},
): SaveResult {
  validateOutputDir(outputDir);

  // Defensive re-validation: the caller (MCP tool or CLI) should have
  // validated already, but we never write a bad JSON to disk.
  const parsed = DesignFoundationSchema.safeParse(foundation);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues };
  }
  const validated: DesignFoundation = parsed.data;

  mkdirSync(outputDir, { recursive: true });

  const jsonPath = join(outputDir, 'design-foundation.json');
  const mdPath = join(outputDir, 'design-foundation.md');

  // Skip-if-unchanged check: compare inputsDigest on existing file.
  if (!opts.force && existsSync(jsonPath)) {
    try {
      const prior = JSON.parse(readFileSync(jsonPath, 'utf8')) as DesignFoundation;
      if (
        prior?.inputsDigest?.palette === validated.inputsDigest.palette &&
        prior?.inputsDigest?.typography === validated.inputsDigest.typography &&
        prior?.inputsDigest?.breakpoints === validated.inputsDigest.breakpoints &&
        prior?.inputsDigest?.manifest === validated.inputsDigest.manifest &&
        prior?.inputsDigest?.cssVariables === validated.inputsDigest.cssVariables
      ) {
        return { ok: true, jsonPath, mdPath, unchanged: true };
      }
    } catch {
      // Corrupt prior file — fall through and overwrite.
    }
  }

  writeAtomic(jsonPath, JSON.stringify(validated, null, 2) + '\n');
  writeAtomic(mdPath, renderMd(validated));

  return { ok: true, jsonPath, mdPath, unchanged: false };
}

function writeAtomic(path: string, content: string): void {
  const tmp = path + '.tmp';
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}
