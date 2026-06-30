import { detect } from '../../lib/detect-platform/index.js';
import type { Handler } from '../handler-types.js';

export const detectHandler: Handler = async (args, ctx) => {
  const result = await detect(args.url as string);
  return ctx.textResult(result);
};
