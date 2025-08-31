export const DEMO_SITE_SIZE_LIMIT_GB = 2;
export const DEMO_SITE_SIZE_LIMIT_BYTES = DEMO_SITE_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 2GB
export const DEMO_SITE_EXPIRATION_DAYS = 7;
export const HOUR_MS = 1000 * 60 * 60;
export const DAY_MS = HOUR_MS * 24;

// OAuth constants
export const CLIENT_ID = '95109';
export const PROTOCOL_PREFIX = 'wpcom-local-dev';

export const LOCKFILE_NAME = 'appdata-v1.json.lock';
export const LOCKFILE_STALE_TIME = 5000;
export const LOCKFILE_WAIT_TIME = 5000;

// SQLite
export const SQLITE_FILENAME = 'sqlite-database-integration';
export const SQLITE_DATABASE_INTEGRATION_VERSION = 'v2.2.6';
export const SQLITE_DATABASE_INTEGRATION_RELEASE_URL = `https://github.com/WordPress/sqlite-database-integration/archive/refs/tags/${ SQLITE_DATABASE_INTEGRATION_VERSION }.zip`;
