import { z } from 'zod';

// Each PHP worker serves one request at a time, so this caps how many requests a site handles at once.
export const DEFAULT_SITE_PHP_WORKERS = 4;

export const sitePhpWorkersSchema = z.number().int().min( 1 ).max( 64 );

export function getSitePhpWorkers( site: { phpWorkers?: number } ): number {
	return site.phpWorkers ?? DEFAULT_SITE_PHP_WORKERS;
}
