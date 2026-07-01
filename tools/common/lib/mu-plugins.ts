/**
 * MU-Plugins for WordPress
 *
 * This module provides the standard set of mu-plugins that need to be
 * available to WordPress instances. Shared between desktop app and CLI.
 */

import { copyFile, mkdir, mkdtemp, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

export interface MuPlugin {
	filename: string;
	content: string;
}

export const STUDIO_ERROR_LOG_FILENAME = 'studio-error.log';

export type MuPluginRuntime = 'playground' | 'native-php';

export interface MuPluginOptions {
	isWpAutoUpdating?: boolean;
	runtime?: MuPluginRuntime;
	errorLogPath?: string;
	errorLogStopAfterBoot?: boolean;
}

/**
 * MU-plugin filenames that should not be written for native PHP sites.
 * These exist to work around behaviors specific to the Playground/PHP WASM
 * runtime and have no equivalent purpose under native PHP.
 */
const NATIVE_PHP_EXCLUDED_MU_PLUGINS = new Set( [
	'0-allowed-redirect-hosts.php',
	'0-suppress-dns-get-record-warnings.php',
	'0-http-request-timeout.php',
] );

export function escapePhpSingleQuotedString( value: string ): string {
	return value.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
}

function unescapePhpSingleQuotedString( value: string ): string {
	return value.replace( /\\'/g, "'" ).replace( /\\\\/g, '\\' );
}

function getLoaderMuPluginContent( muPluginsDir: string ): string {
	const escapedMuPluginsDir = escapePhpSingleQuotedString( muPluginsDir );

	return `<?php
		/**
		 * Studio MU-Plugins Loader
		 * Loads Studio-specific mu-plugins from a Studio-managed directory.
		 */

		// Define database constants if not already defined. It fixes the error
		// for imported sites that don't have those defined e.g. WP Cloud and
		// include plugins which try to access those directly e.g. Mailpoet
		if ( ! defined( 'DB_NAME' ) ) define( 'DB_NAME', 'database_name_here' );
		if ( ! defined( 'DB_USER' ) ) define( 'DB_USER', 'username_here' );
		if ( ! defined( 'DB_PASSWORD' ) ) define( 'DB_PASSWORD', 'password_here' );
		if ( ! defined( 'DB_HOST' ) ) define( 'DB_HOST', 'localhost' );
		if ( ! defined( 'DB_CHARSET' ) ) define( 'DB_CHARSET', 'utf8' );
		if ( ! defined( 'DB_COLLATE' ) ) define( 'DB_COLLATE', '' );

		// Set environment type to local if not already defined
		if ( ! defined( 'WP_ENVIRONMENT_TYPE' ) ) define( 'WP_ENVIRONMENT_TYPE', 'local' );

		$studio_mu_plugins_dir = '${ escapedMuPluginsDir }';

		if ( is_dir( $studio_mu_plugins_dir ) ) {
			$files = glob( $studio_mu_plugins_dir . '/*.php' );
			if ( $files ) {
				// Sort files to ensure consistent loading order
				sort( $files );
				foreach ( $files as $file ) {
					if ( is_file( $file ) ) {
						require_once $file;
					}
				}
			}
		}
		`;
}

async function getExistingNativePhpMuPluginsDir(
	loaderPath: string,
	options: MuPluginOptions
): Promise< string | null > {
	let loaderContent: string;
	try {
		loaderContent = await readFile( loaderPath, 'utf8' );
	} catch {
		return null;
	}

	const match = loaderContent.match( /\$studio_mu_plugins_dir = '((?:\\\\|\\'|[^'])*)';/ );
	if ( ! match ) {
		return null;
	}

	const muPluginsDir = unescapePhpSingleQuotedString( match[ 1 ] );
	if ( loaderContent !== getLoaderMuPluginContent( muPluginsDir ) ) {
		return null;
	}

	let existingFiles: string[];
	try {
		existingFiles = await readdir( muPluginsDir );
	} catch {
		return null;
	}

	const expectedFiles = getStandardMuPlugins( options )
		.map( ( plugin ) => plugin.filename )
		.sort();
	const actualFiles = existingFiles.filter( ( file ) => file.endsWith( '.php' ) ).sort();

	if (
		expectedFiles.length !== actualFiles.length ||
		expectedFiles.some( ( filename, index ) => filename !== actualFiles[ index ] )
	) {
		return null;
	}

	return muPluginsDir;
}

/**
 * Create a loader mu-plugin that loads the Studio mu-plugins.
 *
 * The loader is wired to the directory the rest of the mu-plugins live in.
 * For the Playground runtime that's the fixed virtual-filesystem path the
 * Studio mu-plugins are mounted at; for the native PHP runtime it's the
 * on-disk directory created by `createMuPluginsDirectory()`. Routing
 * through this loader keeps the user's `wp-content/mu-plugins/` empty (or
 * close to it) regardless of runtime.
 *
 * @returns The path to the loader mu-plugin
 */
async function createLoaderMuPlugin( muPluginsDir: string ): Promise< string > {
	try {
		// Create a temporary file for the loader mu-plugin
		const tempDir = await mkdtemp( path.join( tmpdir(), 'studio-loader-' ) );
		const loaderPath = path.join( tempDir, '99-studio-loader.php' );

		await writeFile( loaderPath, getLoaderMuPluginContent( muPluginsDir ) );
		return loaderPath;
	} catch ( error ) {
		throw new Error( `Failed to create loader mu-plugin: ${ error }` );
	}
}

/**
 * Get all standard mu-plugins for WordPress local development
 * @param options Configuration options for mu-plugins
 * @returns Array of mu-plugin definitions
 */
function getStandardMuPlugins( options: MuPluginOptions ): MuPlugin[] {
	const muPlugins: MuPlugin[] = [];

	muPlugins.push( {
		filename: '0-tmp-fix-qm-plugin-sapi.php',
		content: `<?php
		// This is a temporary fix for a Query Manager plugin, which isn't rendered in wp-admin if sapi is "cli" (it's the case for wordpress-playground).
		// See https://github.com/WordPress/wordpress-playground/pull/2424#issuecomment-3686951491
		// It's not the best fix, but it's simple and for consistency it's the same as used in wordpress-playground (https://github.com/WordPress/wordpress-playground/pull/2415)
		define('QM_TESTS', true);
		`,
	} );

	// Capture PHP errors so a failed site start can show why (STU-1757).
	if ( options.errorLogPath ) {
		const stopAfterBoot = options.errorLogStopAfterBoot
			? `if ( function_exists( 'add_action' ) ) {
				add_action( 'wp_loaded', function () { ini_set( 'log_errors', '0' ); }, PHP_INT_MAX );
			}`
			: '';
		muPlugins.push( {
			filename: '0-error-capture.php',
			content: `<?php
		if ( ! ini_get( 'log_errors' ) || ! ini_get( 'error_log' ) ) {
			ini_set( 'log_errors', '1' );
			ini_set( 'error_log', '${ escapePhpSingleQuotedString( options.errorLogPath ) }' );
			${ stopAfterBoot }
		}
		`,
		} );
	}

	// HTTPS detection for reverse proxy
	muPlugins.push( {
		filename: '0-https-for-reverse-proxy.php',
		content: `<?php
		// See https://developer.wordpress.org/advanced-administration/security/https/#using-a-reverse-proxy
		if( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && strpos( $_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false ){
			$_SERVER['HTTPS'] = 'on';
		}
		`,
	} );

	// Redirect to SITEURL constant
	muPlugins.push( {
		filename: '0-redirect-to-siteurl-constant.php',
		content: `<?php
		// See https://core.trac.wordpress.org/ticket/33821#comment:10
		add_action( 'init', function() {
			if ( ! defined( 'WP_SITEURL' ) ) {
				return;
			}

			$current_host = $_SERVER['HTTP_HOST'] ?? '';

			if ( preg_match( '/^localhost:\\d+$/', $current_host ) ) {
				$wp_siteurl_host = parse_url( WP_SITEURL, PHP_URL_HOST );
				$wp_siteurl_port = parse_url( WP_SITEURL, PHP_URL_PORT );
				$wp_siteurl_host_with_port = $wp_siteurl_host;
				if ( $wp_siteurl_port ) {
					$wp_siteurl_host_with_port .= ':' . $wp_siteurl_port;
				}

				if ( $current_host === $wp_siteurl_host_with_port ) {
					return;
				}

				$requested_uri = $_SERVER['REQUEST_URI'] ?? '/';
				wp_redirect( rtrim( WP_SITEURL, '/' ) . $requested_uri, 302 );
				exit;
			}
		});
		`,
	} );

	// Allowed redirect hosts
	muPlugins.push( {
		filename: '0-allowed-redirect-hosts.php',
		content: `<?php
	// Needed because gethostbyname( <host> ) returns
	// a private network IP address for some reason.
	add_filter( 'allowed_redirect_hosts', function( $hosts ) {
		$redirect_hosts = array(
			'wordpress.org',
			'api.wordpress.org',
			'downloads.wordpress.org',
			'themes.svn.wordpress.org',
			'fonts.gstatic.com',
		);
		return array_merge( $hosts, $redirect_hosts );
	} );
	add_filter('http_request_host_is_external', '__return_true', 20, 3 );
	`,
	} );

	// Studio-specific: Hide admin bar for screenshots and health check
	muPlugins.push( {
		filename: '0-thumbnails.php',
		content: `<?php
		// Facilitates the taking of screenshots to be used as thumbnails.
		if ( isset( $_GET['studio-hide-adminbar'] ) ) {
			add_filter( 'show_admin_bar', '__return_false' );
		}
		`,
	} );

	// Check theme availability
	muPlugins.push( {
		filename: '0-check-theme-availability.php',
		content: `<?php
	function check_current_theme_availability() {
			// Get the current theme's directory
			$current_theme = wp_get_theme();
			$theme_dir = get_theme_root() . '/' . $current_theme->stylesheet;

			if ( !is_dir( $theme_dir ) ) {
					$all_themes = wp_get_themes();
					$available_themes = [];

					foreach ($all_themes as $theme_slug => $theme_obj) {
							if ($theme_slug != $current_theme->get_stylesheet()) {
									$available_themes[$theme_slug] = $theme_obj;
							}
					}

					if (!empty($available_themes)) {
							$new_theme_slug = array_keys($available_themes)[0];
							switch_theme($new_theme_slug);
					}
			}
	}
	add_action('after_setup_theme', 'check_current_theme_availability');
	`,
	} );

	// Enable permalinks
	muPlugins.push( {
		filename: '0-permalinks.php',
		content: `<?php
			// Support permalinks without "index.php"
			add_filter( 'got_url_rewrite', '__return_true' );
	`,
	} );

	// Trailing slash handling for wp-admin
	muPlugins.push( {
		filename: '0-wp-admin-trailing-slash.php',
		content: `<?php
		/**
		 * Add trailing slash to wp-admin URLs
		 * This ensures /wp-admin redirects to /wp-admin/
		 */
		add_action( 'init', function() {
			$request_uri = $_SERVER['REQUEST_URI'] ?? '';

			// Check if this is a wp-admin request without trailing slash
			if ( $request_uri === '/wp-admin' || preg_match( '#^/wp-admin$#', $request_uri ) ) {
				$redirect_url = '/wp-admin/';

				// Preserve query string if present
				if ( ! empty( $_SERVER['QUERY_STRING'] ) ) {
					$redirect_url .= '?' . $_SERVER['QUERY_STRING'];
				}

				wp_redirect( $redirect_url, 301 );
				exit;
			}
		}, 1 );
		`,
	} );

	// Deactivate Jetpack modules
	muPlugins.push( {
		filename: '0-deactivate-jetpack-modules.php',
		content: `<?php
			// Disable Jetpack modules that conflict with local development.
			add_filter( 'jetpack_active_modules', 'studio_deactivate_jetpack_modules' );
			function studio_deactivate_jetpack_modules( $active ) {
				$disabled_modules = array( 'protect', 'stats' );
				return array_values( array_diff( $active, $disabled_modules ) );
			}
	`,
	} );

	// Suppress DNS warnings
	muPlugins.push( {
		filename: '0-suppress-dns-get-record-warnings.php',
		content: `<?php
		set_error_handler(function($severity, $message, $file, $line) {
			if ($severity === E_WARNING && strpos($message, "dns_get_record(): dns_get_record() always returns an empty array in PHP.wasm.") === 0) {
				return true;
			}
			return false;
		});
		`,
	} );

	// Configure auto-updates based on Studio settings
	if ( ! options.isWpAutoUpdating ) {
		muPlugins.push( {
			filename: '0-disable-auto-updates.php',
			content: `<?php
			// Disable auto-updates
			add_filter( 'allow_dev_auto_core_updates', '__return_false' );
			add_filter( 'allow_minor_auto_core_updates', '__return_false' );
			add_filter( 'allow_major_auto_core_updates', '__return_false' );
			`,
		} );
	} else {
		muPlugins.push( {
			filename: '0-enable-auto-updates.php',
			content: `<?php
			// Enable auto-updates
			add_filter( 'allow_dev_auto_core_updates', '__return_true' );
			add_filter( 'allow_minor_auto_core_updates', '__return_true' );
			add_filter( 'allow_major_auto_core_updates', '__return_true' );
			`,
		} );
	}

	// HTTP request timeout
	muPlugins.push( {
		filename: '0-http-request-timeout.php',
		content: `<?php
		// Use low-speed timeout instead of hard timeout to handle both large downloads and stalled connections
		// - Allows large plugin downloads (e.g., Jetpack 33MB) to complete with reasonable internet speeds
		// - Fails fast if connection stalls (speed drops below 1KB/s for 30 seconds)
		// - Provides quick feedback for genuinely broken/unresponsive servers
		// Match WordPress core's timeout for plugin downloads (300s)
		add_filter( 'http_request_timeout', function() {
			return 300; // 5 minutes - matches WordPress core, low-speed timeout catches stalls
		} );

		add_action('http_api_curl', function($curl, $url, $options) {
			// Abort if connection can't be established within 30 seconds
			curl_setopt( $curl, CURLOPT_CONNECTTIMEOUT, 30 );

			// Abort if speed drops below 1KB/s for 30 consecutive seconds
			// This allows slow but steady downloads while catching truly stalled connections
			curl_setopt( $curl, CURLOPT_LOW_SPEED_LIMIT, 1024 ); // 1KB/s minimum
			curl_setopt( $curl, CURLOPT_LOW_SPEED_TIME, 30 );    // Must stay above limit for 30s
			return $curl;
		}, 1, 3);
		`,
	} );

	// Studio-specific: Fix plugin spinner display
	muPlugins.push( {
		filename: '0-tmp-fix-hide-plugins-spinner.php',
		content: `<?php
			// This is a temporary fix for a page-optimize bug that causes spinner icons to show all the time in the plugins list auto-update column

			add_action( 'admin_enqueue_scripts', 'studio_patch_auto_update_spinner_style', 999 );
			function studio_patch_auto_update_spinner_style() {
				$current_screen = get_current_screen();
				if ( isset( $current_screen->id ) && 'plugins' === $current_screen->id ) {
					wp_add_inline_style(
						'dashicons',
						'.toggle-auto-update .dashicons.hidden { display: none; }'
					);
				}
			}
	`,
	} );

	// WP-CLI specific: SQLite command support
	muPlugins.push( {
		filename: '0-sqlite-command.php',
		content: `<?php
		// Ensure SQLite command can find the plugin
		add_filter( 'sqlite_command_sqlite_plugin_directories', function( $directories ) {
			$directories[] = '/wordpress/wp-content/mu-plugins/sqlite-database-integration';
			return $directories;
		} );
		`,
	} );

	// WP-CLI specific: Studio commands
	muPlugins.push( {
		filename: '0-studio-cli-commands.php',
		content: `<?php
		/**
		 * Studio WP-CLI Commands
		 *
		 * Provides custom WP-CLI commands for Studio functionality.
		 */
		if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
			return;
		}

		/**
		 * Gets theme details for the current site.
		 *
		 * ## EXAMPLES
		 *
		 *     wp studio get-theme-details
		 *
		 * @when after_wp_load
		 */
		WP_CLI::add_command( 'studio get-theme-details', function() {
			$theme = wp_get_theme();
			$result = [
				'name' => $theme->get( 'Name' ),
				'path' => $theme->get_stylesheet_directory(),
				'slug' => $theme->get_stylesheet(),
				'isBlockTheme' => $theme->is_block_theme(),
				'supportsWidgets' => current_theme_supports( 'widgets' ),
				'supportsMenus' => (bool) ( get_registered_nav_menus() || current_theme_supports( 'menus' ) ),
			];
			echo json_encode( $result );
		} );

		/**
		 * Gets the path of the configured Site Icon relative to the
		 * WordPress install root, or null when no Site Icon is set.
		 *
		 * The host (Studio) translates the WordPress-runtime path
		 * (rooted at the /wordpress mount) into a real filesystem path
		 * by joining the site folder with the returned relative path.
		 *
		 * ## EXAMPLES
		 *
		 *     wp studio get-site-icon
		 *
		 * @when after_wp_load
		 */
		WP_CLI::add_command( 'studio get-site-icon', function() {
			$icon_id = (int) get_option( 'site_icon' );
			if ( ! $icon_id ) {
				echo json_encode( null );
				return;
			}

			$path = get_attached_file( $icon_id );
			if ( ! $path || ! file_exists( $path ) ) {
				echo json_encode( null );
				return;
			}

			// get_attached_file() returns an absolute path. Strip ABSPATH
			// to get a relative path rooted at the site folder.
			$normalized_path = wp_normalize_path( $path );
			$normalized_abspath = wp_normalize_path( ABSPATH );
			$relative = str_starts_with( $normalized_path, $normalized_abspath )
				? substr( $normalized_path, strlen( $normalized_abspath ) )
				: $path;

			echo json_encode( [
				'relativePath' => ltrim( $relative, '/' ),
			] );
		} );
		`,
	} );

	// Studio Admin API: Persistent endpoint for admin operations
	muPlugins.push( {
		filename: '0-studio-admin-api.php',
		content: `<?php
		/**
		 * Studio Admin API
		 *
		 * Provides a persistent endpoint for admin operations that can reuse
		 * the already-loaded WordPress instance, avoiding the overhead of
		 * loading wp-load.php multiple times.
		 *
		 * This endpoint should only be accessible locally.
		 */

		// Check if this is an API request before WordPress routing
		$is_api_request = isset( $_GET['studio-admin-api'] ) ||
		                  strpos( $_SERVER['REQUEST_URI'] ?? '', 'studio-admin-api' ) !== false;

		if ( ! $is_api_request ) {
			return;
		}

		add_action( 'plugins_loaded', function() {

			// Security: Only allow POST requests with the correct action
			if ( $_SERVER['REQUEST_METHOD'] !== 'POST' || empty( $_POST['action'] ) ) {
				status_header( 400 );
				header( 'Content-Type: application/json' );
				echo json_encode( [ 'error' => 'Invalid request' ] );
				exit;
			}

			$action = $_POST['action'];
			$result = null;

			switch ( $action ) {
				case 'set_admin_password':
					$has_password = ! empty( $_POST['password'] );
					$username = ! empty( $_POST['username'] ) ? sanitize_user( $_POST['username'] ) : 'admin';
					// Fallback to 'admin' if sanitize_user() strips all characters (e.g., !@#$%)
					if ( empty( $username ) ) {
						$username = 'admin';
					}

					$user = get_user_by( 'login', $username );
					$provided_email = ! empty( $_POST['email'] ) ? sanitize_email( $_POST['email'] ) : '';

					if ( $user ) {
						if ( $has_password ) {
							wp_set_password( $_POST['password'], $user->ID );
						}
						if ( $provided_email ) {
							wp_update_user( array( 'ID' => $user->ID, 'user_email' => $provided_email ) );
						}
					} else {
						// Creating a new user requires a password
						if ( ! $has_password ) {
							status_header( 400 );
							header( 'Content-Type: application/json' );
							echo json_encode( [ 'error' => 'Password is required to create a new admin user' ] );
							exit;
						}
						// WordPress doesn't support renaming user_login, so we create a new admin user.
						// The old user is left intact — this is intentional.
						// Generate a unique email to avoid conflicts with existing users
						$email = $provided_email ? $provided_email : 'admin@localhost.com';
						if ( ! $provided_email ) {
							$counter = 1;
							while ( email_exists( $email ) && $counter < 100 ) {
								$email = 'admin' . $counter . '@localhost.com';
								$counter++;
							}
						}

						$user_data = array(
							'user_login' => $username,
							'user_pass' => $_POST['password'],
							'user_email' => $email,
							'role' => 'administrator',
						);
						$insert_result = wp_insert_user( $user_data );
						if ( is_wp_error( $insert_result ) ) {
							status_header( 400 );
							header( 'Content-Type: application/json' );
							echo json_encode( [ 'error' => $insert_result->get_error_message() ] );
							exit;
						}
					}
					// Store the admin username in options for auto-login to use
					update_option( 'studio_admin_username', $username );
					$result = [ 'success' => true ];
					break;

				default:
					status_header( 400 );
					header( 'Content-Type: application/json' );
					echo json_encode( [ 'error' => 'Unknown action' ] );
					exit;
			}

			status_header( 200 );
			header( 'Content-Type: application/json' );
			echo json_encode( $result );
			exit;
		}, 1 );
		`,
	} );

	// Auto-login functionality via dedicated endpoint
	muPlugins.push( {
		filename: '0-auto-login.php',
		content: `<?php
		/**
		 * Auto-Login Endpoint
		 *
		 * Provides /studio-auto-login endpoint for automatic authentication
		 * Usage: /studio-auto-login?redirect_to=/wp-admin/
		 */

		// Intercept requests to /studio-auto-login
		add_action( 'init', function() {
			$request_uri = $_SERVER['REQUEST_URI'] ?? '';
			if ( strpos( $request_uri, '/studio-auto-login' ) === false ) {
				return;
			}

			if ( is_user_logged_in() ) {
				$redirect_url = isset( $_GET['redirect_to'] ) ? $_GET['redirect_to'] : home_url();
				wp_safe_redirect( $redirect_url );
				exit;
			}

			$username = get_option( 'studio_admin_username', 'admin' );
			$user = get_user_by( 'login', $username );
			if ( ! $user ) {
				wp_die( 'Auto-login failed: admin user not found' );
			}

			wp_set_current_user( $user->ID, $user->user_login );
			wp_set_auth_cookie( $user->ID, true, is_ssl() );
			do_action( 'wp_login', $user->user_login, $user );
			$redirect_url = isset( $_GET['redirect_to'] ) ? $_GET['redirect_to'] : home_url();
			wp_safe_redirect( $redirect_url );
			exit;

		}, 1 );
		`,
	} );

	if ( options.runtime === 'native-php' ) {
		return muPlugins.filter(
			( plugin ) => ! NATIVE_PHP_EXCLUDED_MU_PLUGINS.has( plugin.filename )
		);
	}

	return muPlugins;
}

async function createMuPluginsDirectory( options: MuPluginOptions ): Promise< string > {
	try {
		// Create a temporary directory for mu-plugins
		const tempDir = await mkdtemp( path.join( tmpdir(), 'studio-mu-plugins-' ) );

		// Get the standard mu-plugins
		const muPlugins = getStandardMuPlugins( options );

		// Write each mu-plugin file to the temporary directory
		for ( const plugin of muPlugins ) {
			const pluginPath = path.join( tempDir, plugin.filename );
			await writeFile( pluginPath, plugin.content );
		}
		return tempDir;
	} catch ( error ) {
		throw new Error( `Failed to create mu-plugins directory: ${ error }` );
	}
}

/**
 * Get mu-plugins for a WordPress instance.
 *
 * Returns `[studioMuPluginsHostPath, loaderMuPluginHostPath]` for both
 * runtimes — only the loader's contents differ. For the `playground`
 * runtime the loader requires plugins from the virtual-filesystem path
 * the mu-plugins are mounted at. For the `native-php` runtime the loader
 * requires plugins from the on-disk temp directory directly, so the
 * caller only needs to drop the loader file into the site's
 * `wp-content/mu-plugins/` for WordPress to pick it up.
 */
export async function getMuPlugins( options: MuPluginOptions = {} ): Promise< [ string, string ] > {
	const studioMuPluginsHostPath = await createMuPluginsDirectory( options );
	const loaderMuPluginHostPath = await createLoaderMuPlugin(
		options.runtime === 'native-php' ? studioMuPluginsHostPath : '/internal/studio/mu-plugins'
	);

	return [ studioMuPluginsHostPath, loaderMuPluginHostPath ];
}

export async function writeStudioMuPluginsForNativePhpRuntime(
	siteFolder: string,
	isWpAutoUpdating: MuPluginOptions[ 'isWpAutoUpdating' ]
): Promise< string > {
	const muPluginsDir = path.join( siteFolder, 'wp-content', 'mu-plugins' );
	await mkdir( muPluginsDir, { recursive: true } );
	const loaderPath = path.join( muPluginsDir, STUDIO_LOADER_MU_PLUGIN_FILENAME );

	const options: MuPluginOptions = {
		isWpAutoUpdating,
		runtime: 'native-php',
	};
	const existingMuPluginsDir = await getExistingNativePhpMuPluginsDir( loaderPath, options );
	if ( existingMuPluginsDir ) {
		return existingMuPluginsDir;
	}

	// `getMuPlugins` writes the plugin files to a temp directory and produces
	// a loader file that requires them. For the native PHP runtime we only
	// copy the loader into wp-content/mu-plugins/ — WordPress auto-loads it
	// at runtime and it pulls the rest in from the temp directory, keeping
	// the user's mu-plugins/ nearly empty.
	const [ tmpMuPluginsDir, loaderHostPath ] = await getMuPlugins( options );
	await copyFile( loaderHostPath, loaderPath );
	return tmpMuPluginsDir;
}

/**
 * Filename of the loader mu-plugin that the native PHP runtime drops into
 * the site's `wp-content/mu-plugins/`. It's the only Studio-managed file
 * that ever lands on disk during normal operation, so archive and export
 * filters use this name to skip it.
 */
export const STUDIO_LOADER_MU_PLUGIN_FILENAME = '99-studio-loader.php';

/**
 * Mu-plugin filenames that older Studio versions wrote directly into
 * `wp-content/mu-plugins/`. Newer versions keep these files in a temp
 * directory and load them through `STUDIO_LOADER_MU_PLUGIN_FILENAME`, so
 * any on-disk copies are leftovers we should clean up at startup. The
 * list includes both currently-shipped and retired filenames so it can
 * scrub anything previously installed by Studio.
 */
export const LEGACY_MU_PLUGIN_FILENAMES = [
	// Current mu-plugins (from getStandardMuPlugins)
	'0-allowed-redirect-hosts.php',
	'0-auto-login.php',
	'0-check-theme-availability.php',
	'0-deactivate-jetpack-modules.php',
	'0-disable-auto-updates.php',
	'0-enable-auto-updates.php',
	'0-http-request-timeout.php',
	'0-https-for-reverse-proxy.php',
	'0-permalinks.php',
	'0-redirect-to-siteurl-constant.php',
	'0-sqlite-command.php',
	'0-studio-admin-api.php',
	'0-studio-cli-commands.php',
	'0-suppress-dns-get-record-warnings.php',
	'0-thumbnails.php',
	'0-tmp-fix-hide-plugins-spinner.php',
	'0-tmp-fix-qm-plugin-sapi.php',
	'0-wp-admin-trailing-slash.php',
	// Retired mu-plugins from older Studio versions
	'0-32bit-integer-warnings.php',
	'0-dns-functions.php',
	'0-sqlite.php',
	'0-wp-config-constants-polyfill.php',
];

/**
 * Remove legacy Studio mu-plugin files from a site's wp-content/mu-plugins/ directory.
 *
 * Older Studio versions wrote mu-plugin PHP files directly into the site directory.
 * Newer versions inject them at runtime via the PHP WASM virtual filesystem.
 * Having both copies causes PHP fatal errors like "Cannot redeclare" because
 * the same functions are defined in both the on-disk file and the runtime-injected file.
 *
 * @param sitePath - Absolute path to the WordPress site directory
 */
export async function cleanupLegacyMuPlugins( sitePath: string ): Promise< void > {
	const muPluginsDir = path.join( sitePath, 'wp-content', 'mu-plugins' );

	let entries: string[];
	try {
		entries = await readdir( muPluginsDir );
	} catch {
		// Directory doesn't exist or can't be read – nothing to clean up
		return;
	}

	const legacySet = new Set( LEGACY_MU_PLUGIN_FILENAMES );
	const filesToRemove = entries.filter( ( name ) => legacySet.has( name ) );

	await Promise.all(
		filesToRemove.map( async ( name ) => {
			try {
				await unlink( path.join( muPluginsDir, name ) );
			} catch {
				// Best-effort: file may already be gone or locked
			}
		} )
	);
}
