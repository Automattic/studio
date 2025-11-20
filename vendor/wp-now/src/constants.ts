/**
 * Playground internal shared folder.
 */
export const PLAYGROUND_INTERNAL_SHARED_FOLDER = '/internal/shared';

/**
 * Playground internal mu-plugins folder.
 */
export const PLAYGROUND_INTERNAL_MU_PLUGINS_FOLDER = '/internal/shared/mu-plugins';

/**
 * Playground internal preload path.
 */
export const PLAYGROUND_INTERNAL_PRELOAD_PATH = '/internal/shared/preload';

/**
 * The file name for the SQLite plugin name.
 */
export const SQLITE_FILENAME = 'sqlite-database-integration';

/**
 * The folder for the SQLite plugin.
 */
export const SQLITE_PLUGIN_FOLDER = '/internal/shared/mu-plugins/sqlite-database-integration';

/**
 * The default starting port for running the WP Now server.
 */
export const DEFAULT_PORT = 8881;

/**
 * The default PHP version to use when running the WP Now server.
 */
export const DEFAULT_PHP_VERSION = '8.3';

/**
 * The allowed PHP versions that can be used
 */
export const ALLOWED_PHP_VERSIONS = [ '8.4', '8.3', '8.2', '8.1', '8.0', '7.4' ];

/**
 * The type for the allowed PHP versions.
 */
export type AllowedPHPVersion = ( typeof ALLOWED_PHP_VERSIONS )[ number ];

/**
 * The default WordPress version to use when running the WP Now server.
 */
export const DEFAULT_WORDPRESS_VERSION = 'latest';

/**
 * The URL for downloading the "wp-cli" WordPress cli.
 */
export const WP_CLI_URL =
	'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar';
