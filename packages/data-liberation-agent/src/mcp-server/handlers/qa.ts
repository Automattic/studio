import type { Handler } from '../handler-types.js';

export const qaHandler: Handler = async (args, ctx) => {
  const { runQa } = await import('../../lib/qa/qa-runner.js');
  const result = await runQa({
    wxrFile: args.wxrFile as string,
    fix: (args.fix as boolean) ?? false,
    onProgress: (current, total, slug) => {
      ctx.server.sendLoggingMessage({
        level: 'info',
        data: `[qa] ${current}/${total} ${slug}`,
      });
    },
  });
  return ctx.textResult(result);
};
