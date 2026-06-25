import type { Handler } from '../handler-types.js';

export const replicateInventoryHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string;
  const start = Date.now();
  try {
    const { inventoryReplica } = await import('../../lib/replicate/inventory.js');
    const result = inventoryReplica(outputDir);
    console.error(`[replicate] ${JSON.stringify({
      tool: 'inventory', outputDir, ok: true, durationMs: Date.now() - start,
      archetypes: Object.fromEntries(
        Object.entries(result.archetypes).map(([k, v]) => [k, v.count]),
      ),
    })}`);
    return ctx.textResult(result);
  } catch (e) {
    console.error(`[replicate] ${JSON.stringify({
      tool: 'inventory', outputDir, ok: false, durationMs: Date.now() - start,
    })}`);
    return ctx.errorResult((e as Error).message);
  }
};
