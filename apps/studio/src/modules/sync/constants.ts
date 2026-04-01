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
