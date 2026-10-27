/**
 * Worker pool sizing for the native PHP site server (`php-server-child.ts`).
 *
 * Each `php -S` worker serves one request at a time, so the pool size caps how
 * many requests a site can handle concurrently.
 */

const DEFAULT_NATIVE_PHP_WORKER_POOL_SIZE = 4;

// Overridable with STUDIO_PHP_WORKER_POOL_SIZE; anything that is not a positive
// integer falls back to the default.
export function getNativePhpWorkerPoolSize( env: NodeJS.ProcessEnv = process.env ): number {
	const raw = env.STUDIO_PHP_WORKER_POOL_SIZE;
	if ( raw === undefined || ! /^\d+$/.test( raw ) ) {
		return DEFAULT_NATIVE_PHP_WORKER_POOL_SIZE;
	}
	const poolSize = Number( raw );
	return poolSize > 0 ? poolSize : DEFAULT_NATIVE_PHP_WORKER_POOL_SIZE;
}
