import { resolveOutputBase, siteOutputDir } from '../../lib/paths.js';
import type { Handler } from '../handler-types.js';

export const pathsHandler: Handler = async (args, ctx) => {
  const url = typeof args.url === 'string' ? args.url : undefined;
  const base = resolveOutputBase();
  const siteDir = url ? siteOutputDir(base, url) : null;
  return ctx.textResult({ base, siteDir });
};
