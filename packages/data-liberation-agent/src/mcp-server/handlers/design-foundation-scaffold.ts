import type { Handler } from '../handler-types.js';

export const designFoundationScaffoldHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string;
  const origin = args.origin as string;
  const start = Date.now();
  try {
    const { scaffoldDesignFoundation } = await import('../../lib/design-foundation/scaffold.js');
    const foundation = scaffoldDesignFoundation(outputDir, { origin });
    console.error(`[design-foundation] ${JSON.stringify({
      tool: 'scaffold', outputDir, ok: true, durationMs: Date.now() - start,
    })}`);
    return ctx.textResult(foundation);
  } catch (e) {
    console.error(`[design-foundation] ${JSON.stringify({
      tool: 'scaffold', outputDir, ok: false, durationMs: Date.now() - start,
    })}`);
    return ctx.errorResult((e as Error).message);
  }
};
