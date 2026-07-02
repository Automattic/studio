import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTickScheduler } from './tick-scheduler.js';
import { loadReplicateState } from './replicate-state.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function tmp(): string {
  return mkdtempSync(join(FIXTURE_TMP, 'ts-'));
}

/**
 * Seed a stub design-foundation.json so the scheduler treats the foundation
 * as ready. Tests that don't seed this file exercise the deferred-archetype
 * path.
 */
function seedFoundation(dir: string): void {
  writeFileSync(join(dir, 'design-foundation.json'), '{}', 'utf8');
}

describe('createTickScheduler', () => {
  it('emits a new-archetype judgment the first time an archetype is observed', async () => {
    const dir = tmp();
    seedFoundation(dir);
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/p/foo', 'product');
    const judgments = await scheduler.drain();
    expect(judgments).toHaveLength(1);
    expect(judgments[0].kind).toBe('archetype-template');
    expect(judgments[0].archetype).toBe('product');
  });

  it('does not enqueue duplicate new-archetype ticks for the same archetype', async () => {
    const dir = tmp();
    seedFoundation(dir);
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/p/a', 'product');
    scheduler.observe('https://example.com/p/b', 'product');
    scheduler.observe('https://example.com/p/c', 'product');
    const judgments = await scheduler.drain();
    expect(judgments.filter((j) => j.kind === 'archetype-template')).toHaveLength(1);
  });

  it('enqueues a periodic tick every Nth URL', async () => {
    const dir = tmp();
    seedFoundation(dir);
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 5 });
    for (let i = 0; i < 5; i++) {
      scheduler.observe(`https://example.com/p/${i}`, 'page');
    }
    const judgments = await scheduler.drain();
    // 1 new-archetype + 1 periodic at the 5th observe()
    expect(judgments.filter((j) => j.kind === 'archetype-template')).toHaveLength(1);
    expect(
      judgments.filter((j) => j.kind === 'foundation-rev' && j.inputs.tickReason === 'periodic'),
    ).toHaveLength(1);
  });

  it('enqueues a periodic tick every urlsPerTick URLs (default 5)', async () => {
    const dir = tmp();
    seedFoundation(dir);
    const scheduler = createTickScheduler({ outputDir: dir });
    for (let i = 0; i < 10; i++) {
      scheduler.observe(`https://example.com/p/${i}`, 'page');
    }
    const judgments = await scheduler.drain();
    expect(
      judgments.filter((j) => j.kind === 'foundation-rev' && j.inputs.tickReason === 'periodic'),
    ).toHaveLength(2);
  });

  it('persists urlsSeen and archetypesObserved through observe()', async () => {
    const dir = tmp();
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/a', 'page');
    scheduler.observe('https://example.com/b', 'product');
    scheduler.observe('https://example.com/c', 'page');
    const state = loadReplicateState(dir);
    expect(state.urlsSeen).toBe(3);
    expect(state.archetypesObserved.sort()).toEqual(['page', 'product']);
  });

  it('defers archetype-template ticks until design-foundation.json exists', async () => {
    const dir = tmp();
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/', 'homepage');
    scheduler.observe('https://example.com/about', 'page');

    // No foundation yet → no archetype-template judgments emerge.
    const before = await scheduler.drain();
    expect(before.filter((j) => j.kind === 'archetype-template')).toHaveLength(0);

    // Foundation appears (the consumer would have run design-foundations).
    seedFoundation(dir);

    // Next observe() releases the deferred ticks in observation order.
    scheduler.observe('https://example.com/contact', 'page');
    const after = await scheduler.drain();
    const archetypes = after
      .filter((j) => j.kind === 'archetype-template')
      .map((j) => j.archetype);
    expect(archetypes).toEqual(['homepage', 'page']);
  });

  it('drain() releases deferred archetype ticks once foundation exists, even without another observe', async () => {
    const dir = tmp();
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/', 'homepage');
    seedFoundation(dir);

    const judgments = await scheduler.drain();
    const archetypes = judgments
      .filter((j) => j.kind === 'archetype-template')
      .map((j) => j.archetype);
    expect(archetypes).toEqual(['homepage']);
  });

  it('emits foundation-rev periodic ticks even before foundation exists', async () => {
    const dir = tmp();
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 5 });
    for (let i = 0; i < 5; i++) {
      scheduler.observe(`https://example.com/p/${i}`, 'page');
    }
    const judgments = await scheduler.drain();
    // archetype-template is held back…
    expect(judgments.filter((j) => j.kind === 'archetype-template')).toHaveLength(0);
    // …but the periodic foundation-rev that triggers foundation generation
    // must fire — that's what unblocks templating in the first place.
    expect(
      judgments.filter((j) => j.kind === 'foundation-rev' && j.inputs.tickReason === 'periodic'),
    ).toHaveLength(1);
  });

  it('archetype-template stays deferred for a still-new archetype observed after foundation appears', async () => {
    const dir = tmp();
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/', 'homepage');
    seedFoundation(dir);
    // New archetype seen with foundation present → enqueued directly.
    scheduler.observe('https://example.com/p/x', 'product');
    const judgments = await scheduler.drain();
    const archetypes = judgments
      .filter((j) => j.kind === 'archetype-template')
      .map((j) => j.archetype);
    // Released-deferred (homepage) comes before fresh-direct (product)
    // because deferred ticks observed first preserve observation order.
    expect(archetypes).toEqual(['homepage', 'product']);
  });

  it('enqueues a manual tick on trigger()', async () => {
    const dir = tmp();
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.trigger('manual');
    const judgments = await scheduler.drain();
    expect(judgments).toHaveLength(1);
    expect(judgments[0].kind).toBe('foundation-rev');
    expect(judgments[0].inputs.tickReason).toBe('manual');
  });

  it('enqueues a foundation-drift tick on trigger()', async () => {
    const dir = tmp();
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.trigger('foundation-drift');
    const judgments = await scheduler.drain();
    expect(judgments).toHaveLength(1);
    expect(judgments[0].kind).toBe('foundation-rev');
    expect(judgments[0].inputs.tickReason).toBe('foundation-drift');
  });

  it('drain() empties the queue (single-shot)', async () => {
    const dir = tmp();
    seedFoundation(dir);
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 5 });
    for (let i = 0; i < 5; i++) {
      scheduler.observe(`https://example.com/${i}`, 'page');
    }
    const first = await scheduler.drain();
    const second = await scheduler.drain();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toHaveLength(0);
  });

  it('updates lastTickAt + lastTickReason on a non-empty drain()', async () => {
    const dir = tmp();
    seedFoundation(dir);
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/p', 'product');
    await scheduler.drain();
    const state = loadReplicateState(dir);
    expect(state.lastTickAt).not.toBeNull();
    expect(state.lastTickReason).toBe('new-archetype');
  });

  it('records foundation input digest without being overwritten by later observe calls', async () => {
    const dir = tmp();
    seedFoundation(dir);
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/a', 'page');
    scheduler.recordFoundationInputsDigest('sha256:abc');
    scheduler.observe('https://example.com/b', 'page');

    const state = loadReplicateState(dir);
    expect(state.lastFoundationInputsDigest).toBe('sha256:abc');
  });

  it('preserves judgment for each archetype in observation order', async () => {
    const dir = tmp();
    seedFoundation(dir);
    const scheduler = createTickScheduler({ outputDir: dir, urlsPerTick: 100 });
    scheduler.observe('https://example.com/h', 'homepage');
    scheduler.observe('https://example.com/p', 'product');
    scheduler.observe('https://example.com/blog/x', 'post');
    const judgments = await scheduler.drain();
    const archetypes = judgments
      .filter((j) => j.kind === 'archetype-template')
      .map((j) => j.archetype);
    expect(archetypes).toEqual(['homepage', 'product', 'post']);
  });

  it('rejects a non-positive urlsPerTick', () => {
    expect(() => createTickScheduler({ outputDir: tmp(), urlsPerTick: 0 })).toThrow();
    expect(() => createTickScheduler({ outputDir: tmp(), urlsPerTick: 1.5 })).toThrow();
  });
});
