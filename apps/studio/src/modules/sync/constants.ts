/**
 * Studio-internal exclusions that should always be excluded from sync,
 * in addition to the base deploy-ignore defaults.
 */
export const SYNC_ADDITIONAL_DEFAULTS = [
	'database',
	'db.php',
	'debug.log',
	'sqlite-database-integration',
	'cache',
];
