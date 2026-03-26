export const SYNC_POLL_INTERVAL_MS = 3000;
export const SYNC_MAX_STALLED_ATTEMPTS = 200;
export const SYNC_PUSH_SIZE_LIMIT_GB = 5;
export const SYNC_PUSH_SIZE_LIMIT_BYTES = SYNC_PUSH_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 5GB

export const SYNC_EXCLUSIONS = [
	'database',
	'db.php',
	'debug.log',
	'sqlite-database-integration',
	'.DS_Store',
	'Thumbs.db',
	'.git',
	'node_modules',
	'cache',
];
