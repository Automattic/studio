import { DEPLOY_IGNORE_DEFAULTS } from '../deploy-ignore';

export const SYNC_POLL_INTERVAL_MS = 3000;
export const SYNC_MAX_STALLED_ATTEMPTS = 200;
export const SYNC_PUSH_SIZE_LIMIT_GB = 5;
export const SYNC_PUSH_SIZE_LIMIT_BYTES = SYNC_PUSH_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 5GB

/**
 * Base patterns excluded from sync: the shared deploy-ignore defaults
 * plus Studio-internal exclusions. These are pre-seeded but can be
 * overridden via negation patterns in .deployignore.
 */
export const SYNC_IGNORE_DEFAULTS = [
	...DEPLOY_IGNORE_DEFAULTS,
	'database',
	'db.php',
	'debug.log',
	'sqlite-database-integration',
	'cache',
];
