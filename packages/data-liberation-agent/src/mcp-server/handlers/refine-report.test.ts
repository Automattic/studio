import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { refineReportHandler } from './refine-report.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';

function makeCtx(): HandlerContext {
  return {
    adapters: [],
    findAdapter: () => null,
    textResult: (data: unknown): ToolResult => ({
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    }),
    errorResult: (message: string): ToolResult => ({
      content: [{ type: 'text', text: message }],
      isError: true,
    }),
    server: {} as never,
  };
}

const base = join(process.cwd(), '.tmp-test', 'refine-report');

function writeSection(slug: string, index: number, body: object) {
  const dir = join(base, 'refine', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${index}.json`), JSON.stringify(body));
}

describe('refineReportHandler', () => {
  it('errors when the page has no report dir', async () => {
    rmSync(base, { recursive: true, force: true });
    const r = await refineReportHandler({ outputDir: base, slug: 'nope' }, makeCtx());
    expect(r.isError).toBe(true);
  });

  it('passes a fully-accounted report', async () => {
    writeSection('home', 0, {
      schema: 1, slug: 'home', sourceUrl: 'https://example.test/', index: 0,
      findings: [{ id: 'a', region: 'r', severity: 'low', description: 'd', affects_layout: false }],
      applied: [{ id: 'a', summary: 's' }], skipped: [],
    });
    const r = await refineReportHandler({ outputDir: base, slug: 'home' }, makeCtx());
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('"ok": true');
  });

  it('fails loud on unaccounted ids', async () => {
    writeSection('unaccounted-page', 0, {
      schema: 1, slug: 'unaccounted-page', sourceUrl: 'https://example.test/', index: 0,
      findings: [{ id: 'b', region: 'r', severity: 'low', description: 'd', affects_layout: false }],
      applied: [], skipped: [],
    });
    const r = await refineReportHandler({ outputDir: base, slug: 'unaccounted-page' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('"b"');
  });
});
