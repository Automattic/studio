export const SYNC_POLL_INTERVAL_MS = 3000;
export const SYNC_MAX_STALLED_ATTEMPTS = 200;
export const SYNC_PUSH_SIZE_LIMIT_GB = 5;
export const SYNC_PUSH_SIZE_LIMIT_BYTES = SYNC_PUSH_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 5GB

/**
 * Studio-internal exclusions excluded from sync by default,
 * in addition to the base deploy-ignore defaults. These are pre-seeded
 * but can be overridden via negation patterns in .deployignore.
 */
export const SYNC_ADDITIONAL_DEFAULTS = [
	'database',
	'db.php',
	'debug.log',
	'sqlite-database-integration',
	'cache',
];
