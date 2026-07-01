import type { Handler } from '../handler-types.js';
import { composeInstantiate, type LayoutSkeleton } from '../../lib/replicate/compose-instantiate.js';

export const composeInstantiateHandler: Handler = async (args, ctx) => {
  const skeleton = args.skeleton as LayoutSkeleton | undefined;
  const pageContent = args.pageContent as Record<string, string | number> | undefined;
  if (!skeleton || !pageContent) return ctx.errorResult('skeleton and pageContent are required');
  return ctx.textResult(composeInstantiate(skeleton, pageContent, (args.mediaMap as Record<string, string>) ?? {}));
};
