import { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Handler } from '../handler-types.js';

export const statusHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string;

  const log = new ExtractionLog(outputDir);
  const running = log.isLockActive();
  const summary = log.getSummary();

  return ctx.textResult({
    running,
    processed: summary.processed.length,
    remaining: 0,
    failed: summary.failed.length,
    currentUrl: null,
    elapsedMs: null,
    estimatedRemainingMs: null,
  });
};
