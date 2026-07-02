import type { Handler } from '../handler-types.js';
import { clusterPages } from '../../lib/replicate/cluster-pages.js';
import type { PageSignature } from '../../lib/replicate/page-signature.js';

export const clusterPagesHandler: Handler = async (args, ctx) => {
  const signatures = args.signatures as PageSignature[] | undefined;
  if (!Array.isArray(signatures)) return ctx.errorResult('signatures[] is required');
  return ctx.textResult(clusterPages(signatures));
};
