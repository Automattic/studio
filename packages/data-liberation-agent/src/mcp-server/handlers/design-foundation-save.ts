import type { Handler } from '../handler-types.js';

export const designFoundationSaveHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string;
  const foundation = args.foundation;
  const force = Boolean(args.force);
  const start = Date.now();
  const { saveDesignFoundation } = await import('../../lib/design-foundation/save.js');
  try {
    const result = saveDesignFoundation(outputDir, foundation, { force });
    console.error(`[design-foundation] ${JSON.stringify({
      tool: 'save', outputDir, ok: result.ok, durationMs: Date.now() - start,
      ...(result.ok ? { unchanged: result.unchanged } : { errorCount: result.errors.length }),
    })}`);
    return ctx.textResult(result);
  } catch (e) {
    console.error(`[design-foundation] ${JSON.stringify({
      tool: 'save', outputDir, ok: false, durationMs: Date.now() - start,
    })}`);
    return ctx.errorResult((e as Error).message);
  }
};
