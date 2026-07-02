import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handler } from '../handler-types.js';
import { validateRefineReports, type RefineSectionReport } from '../../lib/replicate/refine-report.js';

export const refineReportHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string | undefined;
  const slug = args.slug as string | undefined;
  if (!outputDir || !slug) return ctx.errorResult('outputDir and slug are required');
  // The slug becomes a path segment under refine/ — reject separators and
  // dot-traversal so a malformed slug can't walk outside the output dir.
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug) || slug.includes('..')) {
    return ctx.errorResult(`Invalid slug "${slug}" — expected a plain page slug (letters/digits/dot/dash/underscore).`);
  }

  const dir = join(outputDir, 'refine', slug);
  if (!existsSync(dir)) return ctx.errorResult(`No refine reports at ${dir} — match-section must write refine/<slug>/<sectionIndex>.json before validation.`);

  const reports: RefineSectionReport[] = [];
  const bad: string[] = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    try { reports.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as RefineSectionReport); }
    catch { bad.push(f); }
  }
  if (bad.length > 0) return ctx.errorResult(`Unparseable refine report file(s): ${bad.join(', ')}`);
  if (reports.length === 0) return ctx.errorResult(`No section reports found in ${dir}.`);

  const v = validateRefineReports(reports);
  if (!v.ok) return ctx.errorResult(`Refine coverage FAILED for ${slug}:\n- ${v.errors.join('\n- ')}`);
  return ctx.textResult({ ok: true, slug, sections: v.sections, findings: v.findings, applied: v.applied, skipped: v.skipped });
};
