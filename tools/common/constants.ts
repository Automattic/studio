import { RecommendedPHPVersion, PressablePHPVersion } from './types/php-versions';

// Time constants
export const HOUR_MS = 1000 * 60 * 60;
export const DAY_MS = HOUR_MS * 24;

// Preview site constants
export const DEMO_SITE_SIZE_LIMIT_GB = 2;
export const DEMO_SITE_SIZE_LIMIT_BYTES = DEMO_SITE_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 2GB
export const DEMO_SITE_EXPIRATION_DAYS = 7;

// OAuth constants
export const CLIENT_ID = '95109';
export const PROTOCOL_PREFIX = 'wp-studio';
export const DEFAULT_TOKEN_LIFETIME_MS = DAY_MS * 14;

// Lockfile constants
export const APP_CONFIG_LOCKFILE_NAME = 'app.json.lock';
export const CLI_CONFIG_LOCKFILE_NAME = 'cli.json.lock';
export const SHARED_CONFIG_LOCKFILE_NAME = 'shared.json.lock';
export const REMOTE_SESSION_STATE_LOCKFILE_NAME = 'remote-session-state.lock';
export const LOCKFILE_STALE_TIME = 5000;
export const LOCKFILE_WAIT_TIME = 5000;

// Playground CLI timeouts (shared between Studio desktop and CLI)
export const PLAYGROUND_CLI_INACTIVITY_TIMEOUT = 2 * 60 * 1000; // 2 minutes of no output = timeout
export const PLAYGROUND_CLI_MAX_TIMEOUT = 10 * 60 * 1000; // 10 minutes absolute maximum
export const PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL = 5 * 1000; // Check for inactivity every 5 seconds

// Certificate validation — we use these instead of human-readable labels
// because Windows localizes certutil output on non-English systems.
export const SERVER_AUTH_OID = '1.3.6.1.5.5.7.3.1'; // RFC 5280 §4.2.1.12 (id-kp-serverAuth)
export const CERT_UNTRUSTED_ROOT = 'CERT_TRUST_IS_UNTRUSTED_ROOT'; // Windows API constant

// Custom domains
export const DEFAULT_CUSTOM_DOMAIN_SUFFIX = '.wp.local';

// WordPress constants
export const EMPTY_SITE_PLAYGROUND_URL = 'https://playground.wordpress.net/';
export const MINIMUM_WORDPRESS_VERSION = '6.2.1' as const; // https://wordpress.github.io/wordpress-playground/blueprints/examples/#load-an-older-wordpress-version
export const DEFAULT_WORDPRESS_VERSION = 'latest' as const;
export const DEFAULT_PHP_VERSION: typeof RecommendedPHPVersion = RecommendedPHPVersion;
export const PRESSABLE_PHP_VERSION: typeof PressablePHPVersion = PressablePHPVersion;
export const SQLITE_FILENAME = 'sqlite-database-integration' as const;

// Import file constants
export const ACCEPTED_IMPORT_FILE_TYPES = [ '.zip', '.gz', '.gzip', '.tar', '.tar.gz', '.wpress' ];

// Archiver options
export const ARCHIVER_OPTIONS = {
	zip: {
		zlib: { level: 9 },
	},
	tar: {
		gzip: true,
		gzipOptions: { level: 9 },
	},
};
