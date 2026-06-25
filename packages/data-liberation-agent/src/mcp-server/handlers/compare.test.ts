import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { compareHandler } from './compare.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';

function fakeCtx(): HandlerContext {
  return {
    adapters: [],
    findAdapter: () => null,
    textResult: (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
    errorResult: (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true }),
    server: {} as never,
  };
}

const TMP = join(process.cwd(), '.tmp-test', 'compare-handler');

function writeSolidPng(path: string, w: number, h: number, rgba: [number, number, number, number]) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    png.data[o] = rgba[0]; png.data[o + 1] = rgba[1]; png.data[o + 2] = rgba[2]; png.data[o + 3] = rgba[3];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

function buildDir(dir: string, url: string, slug: string, png: { w: number; h: number; color: [number, number, number, number] }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 1, entries: { [url]: { slug, capturedAt: '2026-05-20T00:00:00Z' } } }, null, 2));
  for (const vp of ['desktop', 'mobile']) writeSolidPng(join(dir, vp, `${slug}.png`), png.w, png.h, png.color);
}

describe('compareHandler', () => {
  it('errors when originDir/replicaDir are missing', async () => {
    const res = await compareHandler({}, fakeCtx());
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/originDir.*replicaDir/);
  });
});

describe('compareHandler repair tasks + height tally', () => {
  beforeEach(() => rmSync(TMP, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('writes repair-tasks.json (atomic sibling of comparison.json) and tallies heightDelta per page', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    // 40px height loss, identical cropped content: score 1, height gate fails.
    buildDir(origin, 'https://origin.test/p', 'p', { w: 1440, h: 940, color: [7, 7, 7, 255] });
    buildDir(replica, 'http://localhost:8881/p', 'p', { w: 1440, h: 900, color: [7, 7, 7, 255] });
    const res = await compareHandler({ originDir: origin, replicaDir: replica }, fakeCtx());
    expect(res.isError).toBeFalsy();
    const summary = JSON.parse(res.content[0].text) as {
      results: unknown[];
      heightGate: { maxHeightDelta: number; perPage: Array<{ pathname: string; desktop: number | null; mobile: number | null }> };
      repairTasks: { count: number; path: string };
    };
    expect(summary.heightGate.maxHeightDelta).toBe(8);
    expect(summary.heightGate.perPage).toEqual([{ pathname: '/p', desktop: 40, mobile: 40 }]);
    expect(summary.repairTasks.count).toBe(2); // desktop + mobile height tasks
    const tasksPath = join(replica, 'repair-tasks.json');
    expect(summary.repairTasks.path).toBe(tasksPath);
    expect(existsSync(tasksPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(tasksPath, 'utf8')) as {
      schema: number; floor: number; maxHeightDelta: number;
      tasks: Array<{ surface: string; kind: string; pathname: string; viewport: string; heightDelta: number | null }>;
    };
    expect(onDisk.schema).toBe(1);
    expect(onDisk.tasks).toHaveLength(2);
    expect(onDisk.tasks.every((t) => t.surface === 'frontend' && t.kind === 'height' && t.pathname === '/p')).toBe(true);
  });

  it('passing comparison writes an empty task list', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/ok', 'ok', { w: 1440, h: 900, color: [7, 7, 7, 255] });
    buildDir(replica, 'http://localhost:8881/ok', 'ok', { w: 1440, h: 900, color: [7, 7, 7, 255] });
    const res = await compareHandler({ originDir: origin, replicaDir: replica }, fakeCtx());
    const summary = JSON.parse(res.content[0].text) as { repairTasks: { count: number } };
    expect(summary.repairTasks.count).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(replica, 'repair-tasks.json'), 'utf8')) as { tasks: unknown[] };
    expect(onDisk.tasks).toEqual([]);
  });
});
