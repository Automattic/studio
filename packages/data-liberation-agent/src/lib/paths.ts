import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';

/** Studio's sites root: STUDIO_SITES_DIR override, else ~/Studio. Single SoT. */
export function resolveStudioRoot(): string {
  return process.env.STUDIO_SITES_DIR || join(homedir(), 'Studio');
}

/**
 * Default base directory for liberation output. User-owned and Studio-adjacent
 * so artifacts never live inside the (read-only) plugin/package dir.
 *   1. DLA_OUTPUT_DIR (absolutized against home if relative) wins.
 *   2. else <studio root>/_liberations  (a non-site sibling dir; Studio tracks
 *      sites via appdata-v1.json, not a filesystem scan, so it's ignored there).
 */
export function resolveOutputBase(): string {
  const env = process.env.DLA_OUTPUT_DIR?.trim();
  if (env) return isAbsolute(env) ? env : resolve(homedir(), env);
  return join(resolveStudioRoot(), '_liberations');
}

/**
 * Per-site output dir = <baseDir>/<sanitized host+path>. Path-scoped so two
 * captures of the same host under different paths don't collide.
 */
export function siteOutputDir(baseDir: string, url: string): string {
  let host: string;
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`);
    host = parsed.hostname + parsed.pathname;
  } catch {
    host = url;
  }
  const sanitized = host
    .toLowerCase()
    .replace(/\/$/, '')
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return join(baseDir, sanitized);
}
