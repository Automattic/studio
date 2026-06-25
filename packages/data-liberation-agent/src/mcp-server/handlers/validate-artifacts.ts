import type { Handler } from '../handler-types.js';
import { validateArtifacts, type ArtifactPattern } from '../../lib/replicate/validate-artifacts.js';

export const validateArtifactsHandler: Handler = async (args, ctx) => {
  const patterns = args.patterns as ArtifactPattern[] | undefined;
  if (!Array.isArray(patterns)) return ctx.errorResult('patterns[] is required');
  const report = validateArtifacts({ patterns });
  return ctx.textResult(report);
};
