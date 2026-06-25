//
// liberate_compare
// ================
// Thin MCP wrapper over compareScreenshotDirs. Reads an origin screenshot
// dir and a replica screenshot dir, returns the per-pathname desktop/mobile
// parity scores (incl. the pre-crop heightDelta co-gate), and writes
// comparison.json + diff PNGs + repair-tasks.json into the replica dir.
//
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Handler } from '../handler-types.js';
import type { ViewportId } from '../../lib/screenshot/compare.js';

export const compareHandler: Handler = async (args, ctx) => {
  const originDir = args.originDir as string;
  const replicaDir = args.replicaDir as string;
  if (!originDir || !replicaDir) {
    return ctx.errorResult('liberate_compare requires originDir + replicaDir');
  }
  const start = Date.now();
  try {
    const { compareScreenshotDirs, buildRepairTasks, DEFAULT_MAX_HEIGHT_DELTA } = await import(
      '../../lib/screenshot/compare.js'
    );
    const maxHeightDelta = (args.maxHeightDelta as number | undefined) ?? DEFAULT_MAX_HEIGHT_DELTA;
    const floor = (args.floor as number | undefined) ?? 0.99;
    const result = await compareScreenshotDirs({
      originDir,
      replicaDir,
      viewports: args.viewports as ViewportId[] | undefined,
      diffOutputDir: args.diffOutputDir as string | undefined,
      maxHeightDelta,
    });
    // Structured repair tasks — pure derivation from the results; atomic
    // sibling of comparison.json (same tmp+rename convention as the other
    // run artifacts). Empty list is still written: its absence vs emptiness
    // must be distinguishable to consumers.
    const tasks = buildRepairTasks(result.results, { floor });
    const tasksPath = join(replicaDir, 'repair-tasks.json');
    const tasksTmp = `${tasksPath}.tmp.${process.pid}`;
    writeFileSync(tasksTmp, JSON.stringify({ schema: 1, floor, maxHeightDelta, tasks }, null, 2) + '\n');
    renameSync(tasksTmp, tasksPath);
    console.error(`[compare] ${JSON.stringify({ tool: 'compare', originDir, replicaDir, count: result.results.length, repairTasks: tasks.length, durationMs: Date.now() - start })}`);
    return ctx.textResult({
      ...result,
      // Per-page height tally: the score alone is blind to height loss (the
      // min-crop hides it) — surface the gate's measurements alongside.
      heightGate: {
        maxHeightDelta,
        perPage: result.results.map((r) => ({
          pathname: r.pathname,
          desktop: r.desktop.heightDelta ?? null,
          mobile: r.mobile.heightDelta ?? null,
        })),
      },
      repairTasks: { count: tasks.length, path: tasksPath },
    });
  } catch (e) {
    console.error(`[compare] ${JSON.stringify({ tool: 'compare', originDir, replicaDir, ok: false, durationMs: Date.now() - start })}`);
    return ctx.errorResult((e as Error).message);
  }
};
