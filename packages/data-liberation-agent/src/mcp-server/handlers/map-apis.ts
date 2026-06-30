import type { Handler } from '../handler-types.js';

export const mapApisHandler: Handler = async (args, ctx) => {
  const { mapApis } = await import('../../lib/probe/map-apis.js');
  const result = await mapApis({
    cdpPort: args.cdpPort as number,
    url: args.url as string,
    crawlUrls: (args.crawlUrls as string[]) ?? [],
    followLinks: (args.followLinks as boolean) ?? false,
  });
  return ctx.textResult(result);
};
