import type { Handler } from '../handler-types.js';

export const replicateVerifyHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string;
  const replicaBaseUrl = args.replicaBaseUrl as string;
  const urls = (args.urls as string[]) ?? [];
  const start = Date.now();
  try {
    const { verifyReplica } = await import('../../lib/replicate/verify.js');
    const result = await verifyReplica({
      outputDir,
      replicaBaseUrl,
      urls,
      viewports: args.viewports as ('desktop' | 'mobile')[] | undefined,
      outputSubdir: args.outputSubdir as string | undefined,
      cdpPort: args.cdpPort as number | undefined,
      concurrency: args.concurrency as number | undefined,
    });
    console.error(`[replicate] ${JSON.stringify({
      tool: 'verify', outputDir, replicaBaseUrl, urlCount: urls.length,
      ok: result.ok, durationMs: Date.now() - start,
    })}`);
    return ctx.textResult(result);
  } catch (e) {
    console.error(`[replicate] ${JSON.stringify({
      tool: 'verify', outputDir, replicaBaseUrl, ok: false, durationMs: Date.now() - start,
    })}`);
    return ctx.errorResult((e as Error).message);
  }
};
