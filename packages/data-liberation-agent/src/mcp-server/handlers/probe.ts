import type { Handler } from '../handler-types.js';

export const probeHandler: Handler = async (args, ctx) => {
  const { probeBrowser } = await import('../../lib/probe/browser-probe.js');
  const results = await probeBrowser(
    args.cdpPort as number,
    args.url as string | undefined,
  );
  return ctx.textResult(results);
};
