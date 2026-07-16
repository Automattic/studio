/**
 * Driver for deterministic asset-triage candidate selection (replicate-with-blocks
 * Step 3.5). Walks every captured page's SectionSpecs and prints the candidate
 * list as JSON, so the skill stage never has to eval inline TypeScript.
 *
 *   scripts/run.mjs triage-candidates <outputDir>
 *
 * Output (stdout): { "pages": [{ "sourceUrl", "candidates": [...] }], "total": N }
 * Copy `url` and `sectionSelector` VERBATIM into asset-triage.json — the
 * downstream join is exact-string on both fields.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { selectTriageCandidates, type TriageCandidate } from '../src/lib/replicate/triage-candidates.js';
import { SECTION_SPECS_SCHEMA } from '../src/lib/replicate/section-specs-store.js';
import type { SectionSpec } from '../src/lib/replicate/section-extract.js';

interface SpecsFileShape {
  schema?: number;
  sourceUrl?: string;
  sections?: SectionSpec[];
}

function main(): void {
  const outputDir = process.argv[2];
  if (!outputDir) {
    console.error('Usage: scripts/run.mjs triage-candidates <outputDir>');
    process.exit(1);
  }
  const sectionsDir = join(resolve(outputDir), 'sections');
  if (!existsSync(sectionsDir)) {
    console.error(`No sections/ directory at ${sectionsDir} — run capture first.`);
    process.exit(1);
  }

  const pages: Array<{ sourceUrl: string; candidates: TriageCandidate[] }> = [];
  let total = 0;
  for (const name of readdirSync(sectionsDir).sort()) {
    if (!name.endsWith('.json')) continue;
    let file: SpecsFileShape;
    try {
      file = JSON.parse(readFileSync(join(sectionsDir, name), 'utf8')) as SpecsFileShape;
    } catch {
      console.error(`skip ${name}: unreadable/corrupt`);
      continue;
    }
    if (file.schema !== SECTION_SPECS_SCHEMA) {
      console.error(`skip ${name}: schema ${file.schema ?? 'missing'} != ${SECTION_SPECS_SCHEMA}`);
      continue;
    }
    if (!file.sourceUrl || !Array.isArray(file.sections)) continue;
    const candidates = selectTriageCandidates(file.sections);
    if (candidates.length === 0) continue;
    pages.push({ sourceUrl: file.sourceUrl, candidates });
    total += candidates.length;
  }

  process.stdout.write(JSON.stringify({ pages, total }, null, 2) + '\n');
}

main();
