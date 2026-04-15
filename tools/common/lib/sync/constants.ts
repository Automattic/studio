export const SYNC_POLL_INTERVAL_MS = 3000;
export const SYNC_MAX_STALLED_ATTEMPTS = 200;
export const SYNC_PUSH_SIZE_LIMIT_GB = 5;
export const SYNC_PUSH_SIZE_LIMIT_BYTES = SYNC_PUSH_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 5GB

/**
 * Base patterns excluded from sync. These are pre-seeded but can be
 * overridden via negation patterns in .deployignore.
 */
export const SYNC_IGNORE_DEFAULTS = [
	// Duplicated from DEPLOY_IGNORE_DEFAULTS in tools/common/lib/deploy-ignore.ts
	// so this file stays free of Node imports and can be used in the renderer.
	// A unit test enforces that this list is a superset.
	'.git',
	'node_modules',
	'.DS_Store',
	'Thumbs.db',
	// Studio-internal sync exclusions
	'database',
	'db.php',
	'debug.log',
	'sqlite-database-integration',
	'cache',
];
