import { RecommendedPHPVersion } from './types/php-versions';

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
export const LOCKFILE_NAME = 'appdata-v1.json.lock';
export const LOCKFILE_STALE_TIME = 5000;
export const LOCKFILE_WAIT_TIME = 5000;

// Playground CLI timeouts (shared between Studio desktop and CLI)
export const PLAYGROUND_CLI_INACTIVITY_TIMEOUT = 2 * 60 * 1000; // 2 minutes of no output = timeout
export const PLAYGROUND_CLI_MAX_TIMEOUT = 10 * 60 * 1000; // 10 minutes absolute maximum
export const PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL = 5 * 1000; // Check for inactivity every 5 seconds

// Custom domains
export const DEFAULT_CUSTOM_DOMAIN_SUFFIX = '.wp.local';

// WordPress constants
export const MINIMUM_WORDPRESS_VERSION = '6.2.1' as const; // https://wordpress.github.io/wordpress-playground/blueprints/examples/#load-an-older-wordpress-version
export const DEFAULT_WORDPRESS_VERSION = 'latest' as const;
export const DEFAULT_PHP_VERSION: typeof RecommendedPHPVersion = RecommendedPHPVersion;
export const SQLITE_FILENAME = 'sqlite-database-integration' as const;

// phpMyAdmin - set to true to enable by default for all new sites
export const DEFAULT_ENABLE_PHPMYADMIN = true;
