import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replicateTickHandler } from './replicate-tick.js';
import {
  loadReplicateState,
  saveReplicateState,
  emptyState,
} from '../../lib/streaming/replicate-state.js';
import { computeInputsDigest } from '../../lib/streaming/foundation-drift.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function tmp(): string {
  return mkdtempSync(join(FIXTURE_TMP, 'rth-'));
}

function makeCtx(): HandlerContext {
  return {
    adapters: [],
    findAdapter: () => null,
    textResult: (data: unknown): ToolResult => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    }),
    errorResult: (message: string): ToolResult => ({
      content: [{ type: 'text', text: message }],
      isError: true,
    }),
    server: {} as never,
  };
}

function parseResult(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('replicateTickHandler', () => {
  it('returns an error when outputDir is missing', async () => {
    const result = await replicateTickHandler({}, makeCtx());
    expect(result.isError).toBe(true);
  });

  it('returns judgmentNeeded: [] when no archetypes are observed', async () => {
    const dir = tmp();
    saveReplicateState(dir, emptyState());
    const result = await replicateTickHandler({ outputDir: dir }, makeCtx());
    const body = parseResult(result);
    expect(body.ok).toBe(true);
    expect(body.judgmentNeeded).toEqual([]);
    expect(body.newArchetypes).toEqual([]);
    expect(body.tickReason).toBeNull();
    expect(body.appliedDeltas).toEqual([]);
  });

  it('emits an archetype-template judgment for each untemplated archetype', async () => {
    const dir = tmp();
    saveReplicateState(dir, {
      ...emptyState(),
      urlsSeen: 6,
      archetypesObserved: ['homepage', 'page', 'product'],
      archetypeTemplateMap: { homepage: ['templates/index.html'] },
    });
    const result = await replicateTickHandler({ outputDir: dir }, makeCtx());
    const body = parseResult(result);
    expect(body.tickReason).toBe('new-archetype');
    expect(body.newArchetypes).toEqual(['page', 'product']);
    const judgments = body.judgmentNeeded as Array<Record<string, unknown>>;
    expect(judgments).toHaveLength(2);
    expect(judgments.map((j) => j.archetype).sort()).toEqual(['page', 'product']);
    expect(judgments.every((j) => j.kind === 'archetype-template')).toBe(true);
  });

  it('emits a foundation-rev judgment when foundation inputs have drifted', async () => {
    const dir = tmp();
    const palette = { version: 1, sampledUrls: 3, colors: [{ hex: '#000', count: 1, urls: 3 }] };
    const typography = { version: 1, sampledUrls: 3, bySelector: { body: [{ fontFamily: 'Inter', fontSize: '16px', fontWeight: '400', lineHeight: '24px', urls: 3 }] } };
    const breakpoints = { version: 1, sampledUrls: 3, minWidth: [768], maxWidth: [] };
    writeFileSync(join(dir, 'palette.json'), JSON.stringify(palette));
    writeFileSync(join(dir, 'typography.json'), JSON.stringify(typography));
    writeFileSync(join(dir, 'breakpoints.json'), JSON.stringify(breakpoints));
    // Set a stale prior digest so drift is detected
    saveReplicateState(dir, {
      ...emptyState(),
      urlsSeen: 5,
      archetypesObserved: ['page'],
      archetypeTemplateMap: { page: ['templates/page.html'] },
      lastFoundationInputsDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    });
    const result = await replicateTickHandler({ outputDir: dir }, makeCtx());
    const body = parseResult(result);
    const judgments = body.judgmentNeeded as Array<Record<string, unknown>>;
    expect(judgments).toHaveLength(1);
    expect(judgments[0].kind).toBe('foundation-rev');
    expect(body.tickReason).toBe('foundation-drift');
  });

  it('does not emit a foundation-rev judgment when prevDigest matches current', async () => {
    const dir = tmp();
    const palette = { version: 1, sampledUrls: 3, colors: [{ hex: '#000', count: 1, urls: 3 }] };
    const typography = { version: 1, sampledUrls: 3, bySelector: {} };
    const breakpoints = { version: 1, sampledUrls: 3, minWidth: [], maxWidth: [] };
    writeFileSync(join(dir, 'palette.json'), JSON.stringify(palette));
    writeFileSync(join(dir, 'typography.json'), JSON.stringify(typography));
    writeFileSync(join(dir, 'breakpoints.json'), JSON.stringify(breakpoints));
    const matchingDigest = computeInputsDigest(palette, typography, breakpoints);
    saveReplicateState(dir, {
      ...emptyState(),
      urlsSeen: 5,
      archetypesObserved: ['page'],
      archetypeTemplateMap: { page: ['templates/page.html'] },
      lastFoundationInputsDigest: matchingDigest,
    });
    const result = await replicateTickHandler({ outputDir: dir }, makeCtx());
    const body = parseResult(result);
    expect(body.judgmentNeeded).toEqual([]);
    expect(body.tickReason).toBeNull();
  });

  it('persists lastTickAt + lastTickReason after running', async () => {
    const dir = tmp();
    saveReplicateState(dir, {
      ...emptyState(),
      urlsSeen: 1,
      archetypesObserved: ['homepage'],
    });
    await replicateTickHandler({ outputDir: dir }, makeCtx());
    const updated = loadReplicateState(dir);
    expect(updated.lastTickAt).not.toBeNull();
    expect(updated.lastTickReason).toBe('new-archetype');
  });

  it('treats a missing replicate-state.json as empty state and returns no judgments', async () => {
    const dir = tmp();
    const result = await replicateTickHandler({ outputDir: dir }, makeCtx());
    const body = parseResult(result);
    expect(body.ok).toBe(true);
    expect(body.judgmentNeeded).toEqual([]);
  });

  it('returns appliedDeltas: [] (the handler does not invoke skills directly)', async () => {
    const dir = tmp();
    saveReplicateState(dir, {
      ...emptyState(),
      archetypesObserved: ['product'],
    });
    const result = await replicateTickHandler({ outputDir: dir }, makeCtx());
    const body = parseResult(result);
    expect(body.appliedDeltas).toEqual([]);
  });
});
