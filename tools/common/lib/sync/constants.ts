import { DEPLOY_IGNORE_DEFAULTS } from '../deploy-ignore-defaults';

export const SYNC_POLL_INTERVAL_MS = 3000;
export const SYNC_MAX_STALLED_ATTEMPTS = 200;
export const SYNC_PUSH_SIZE_LIMIT_GB = 5;
export const SYNC_PUSH_SIZE_LIMIT_BYTES = SYNC_PUSH_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 5GB

/**
 * Base patterns excluded from sync. These are pre-seeded but can be
 * overridden via negation patterns in .deployignore.
 *
 * Dotfiles (`.*`) are deliberately omitted. The remote import drops
 * some dotfiles on its own, but not all — nested ones (e.g. inside
 * plugin directories) sync successfully. Adding `.*` here would block
 * those too. Users who want stricter dotfile filtering can add their
 * own patterns to .deployignore.
 */
export const SYNC_IGNORE_DEFAULTS = [
	...DEPLOY_IGNORE_DEFAULTS,
	// Studio-internal sync exclusions
	'database',
	'db.php',
	'debug.log',
	'studio-error.log',
	'sqlite-database-integration',
	'cache',
];
