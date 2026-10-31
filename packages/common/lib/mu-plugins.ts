/**
 * MU-Plugins for WordPress
 *
 * This module provides the standard set of mu-plugins that need to be
 * available to WordPress instances. Shared between desktop app and CLI.
 */

import { createHash, randomUUID } from 'crypto';
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises';
import path from 'path';
import {
	getFrontendUrl,
	HEADLESS_ROUTES,
	REVALIDATE_SECRET_HEADER,
	type SiteFrontend,
} from './site-frontend.ts';
import { getMuPluginsPath } from './well-known-paths.ts';

export interface MuPlugin {
	filename: string;
	content: string;
}

export const STUDIO_ERROR_LOG_FILENAME = 'studio-error.log';

export interface HeadlessMuPluginOptions {
	url: string;
	previewSecret?: string;
	revalidateSecret?: string;
	headlessMode?: boolean;
	api?: 'rest' | 'graphql';
}

export interface MuPluginOptions {
	isWpAutoUpdating?: boolean;
	errorLogPath?: string;
	errorLogStopAfterBoot?: boolean;
	// Set for a headless site: links, previews and revalidation go to its frontend.
	frontend?: HeadlessMuPluginOptions;
}

export function getHeadlessMuPluginOptions(
	frontend: SiteFrontend | undefined
): HeadlessMuPluginOptions | undefined {
	if ( ! frontend ) {
		return undefined;
	}
	return {
		url: getFrontendUrl( frontend ),
		previewSecret: frontend.previewSecret,
		revalidateSecret: frontend.revalidateSecret,
		headlessMode: frontend.headlessMode,
		api: frontend.api,
	};
}

export function escapePhpSingleQuotedString( value: string ): string {
	return value.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
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

function getHeadlessMuPluginContent( frontend: HeadlessMuPluginOptions ): string {
	const constant = ( name: string, value: string ) =>
		`if ( ! defined( '${ name }' ) ) {
	define( '${ name }', '${ escapePhpSingleQuotedString( value ) }' );
}`;

	return `<?php
/**
 * Studio headless backend: sends view links, previews and revalidation to the
 * site's frontend project, and lets it call WPGraphQL with credentials.
 */
${ constant( 'STUDIO_FRONTEND_URL', frontend.url.replace( /\/$/, '' ) ) }
${ constant( 'STUDIO_PREVIEW_SECRET', frontend.previewSecret ?? '' ) }
${ constant( 'STUDIO_REVALIDATE_SECRET', frontend.revalidateSecret ?? '' ) }
${ constant( 'STUDIO_FRONTEND_API', frontend.api ?? 'rest' ) }
if ( ! defined( 'STUDIO_HEADLESS_MODE' ) ) {
	define( 'STUDIO_HEADLESS_MODE', ${ frontend.headlessMode ? 'true' : 'false' } );
}

if ( ! function_exists( 'add_filter' ) || defined( 'STUDIO_HEADLESS_LOADED' ) ) {
	return;
}
define( 'STUDIO_HEADLESS_LOADED', true );

function studio_headless_frontend_url( $path = '/' ) {
	return rtrim( STUDIO_FRONTEND_URL, '/' ) . '/' . ltrim( $path, '/' );
}

function studio_headless_frontend_origin() {
	$parts = wp_parse_url( STUDIO_FRONTEND_URL );
	if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return STUDIO_FRONTEND_URL;
	}
	$origin = $parts['scheme'] . '://' . $parts['host'];
	if ( ! empty( $parts['port'] ) ) {
		$origin .= ':' . $parts['port'];
	}
	return $origin;
}

// APIs keep returning WordPress's own URLs.
function studio_headless_is_api_request() {
	return ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || defined( 'GRAPHQL_REQUEST' );
}

// The frontend route for a post: pages at /<path>, posts at /posts/<slug>,
// other public types at /<type>/<slug>. Null when the post has no public URL.
function studio_headless_post_path( $post ) {
	$post = get_post( $post );
	if ( ! $post || 'publish' !== $post->post_status || '' === $post->post_name ) {
		return null;
	}
	if ( 'page' === $post->post_type ) {
		if ( (int) get_option( 'page_on_front' ) === $post->ID ) {
			return '/';
		}
		return '/' . get_page_uri( $post );
	}
	if ( 'post' === $post->post_type ) {
		return '/posts/' . $post->post_name;
	}
	return '/' . $post->post_type . '/' . $post->post_name;
}

function studio_headless_filter_post_link( $link, $post ) {
	if ( studio_headless_is_api_request() ) {
		return $link;
	}
	$path = studio_headless_post_path( $post );
	return null === $path ? $link : studio_headless_frontend_url( $path );
}

add_filter( 'post_link', 'studio_headless_filter_post_link', 20, 2 );
add_filter( 'page_link', 'studio_headless_filter_post_link', 20, 2 );
add_filter( 'post_type_link', 'studio_headless_filter_post_link', 20, 2 );

add_filter(
	'preview_post_link',
	function ( $link, $post ) {
		if ( ! $post || '' === STUDIO_PREVIEW_SECRET || ! current_user_can( 'edit_post', $post->ID ) ) {
			return $link;
		}
		return add_query_arg(
			array(
				'secret' => rawurlencode( STUDIO_PREVIEW_SECRET ),
				'id'     => $post->ID,
				'type'   => rawurlencode( $post->post_type ),
				'status' => rawurlencode( $post->post_status ),
			),
			studio_headless_frontend_url( '${ HEADLESS_ROUTES.draft }' )
		);
	},
	20,
	2
);

add_filter(
	'graphql_response_headers_to_send',
	function ( $headers ) {
		$headers['Access-Control-Allow-Origin']      = studio_headless_frontend_origin();
		$headers['Access-Control-Allow-Credentials'] = 'true';
		$headers['Vary']                             = 'Origin';
		return $headers;
	}
);

add_filter(
	'graphql_access_control_allow_headers',
	function ( $headers ) {
		$headers[] = 'X-WP-Nonce';
		return array_values( array_unique( $headers ) );
	}
);

// Collected over the request and sent once at shutdown, so a save that fires
// both hooks below revalidates once.
function studio_headless_queue_revalidation( $post ) {
	global $studio_headless_revalidate;
	$post = get_post( $post );
	if ( ! $post || '' === STUDIO_REVALIDATE_SECRET || wp_is_post_revision( $post ) || wp_is_post_autosave( $post ) ) {
		return;
	}
	$type = get_post_type_object( $post->post_type );
	if ( ! $type || ! $type->public ) {
		return;
	}
	if ( ! is_array( $studio_headless_revalidate ) ) {
		$studio_headless_revalidate = array(
			'paths' => array( '/' ),
			'tags'  => array(),
		);
		add_action( 'shutdown', 'studio_headless_send_revalidation' );
	}
	$path = studio_headless_post_path( $post );
	if ( null !== $path ) {
		$studio_headless_revalidate['paths'][] = $path;
	}
	$studio_headless_revalidate['tags'][] = $post->post_type;
	$studio_headless_revalidate['tags'][] = $post->post_type . ':' . $post->ID;
	if ( '' !== $post->post_name ) {
		$studio_headless_revalidate['tags'][] = $post->post_type . ':' . $post->post_name;
	}
}

function studio_headless_send_revalidation() {
	global $studio_headless_revalidate;
	if ( ! is_array( $studio_headless_revalidate ) ) {
		return;
	}
	$body = array(
		'paths' => array_values( array_unique( $studio_headless_revalidate['paths'] ) ),
		'tags'  => array_values( array_unique( $studio_headless_revalidate['tags'] ) ),
	);
	$studio_headless_revalidate = null;
	$response = wp_remote_post(
		studio_headless_frontend_url( '${ HEADLESS_ROUTES.revalidate }' ),
		array(
			'blocking'  => false,
			'timeout'   => 5,
			'sslverify' => false,
			'headers'   => array(
				'Content-Type' => 'application/json',
				'${ REVALIDATE_SECRET_HEADER }' => STUDIO_REVALIDATE_SECRET,
			),
			'body'      => wp_json_encode( $body ),
		)
	);
	if ( is_wp_error( $response ) ) {
		error_log( '[studio-headless] revalidate failed: ' . $response->get_error_message() );
	}
}

add_action(
	'transition_post_status',
	function ( $new_status, $old_status, $post ) {
		if ( 'publish' === $new_status || 'publish' === $old_status ) {
			studio_headless_queue_revalidation( $post );
		}
	},
	10,
	3
);

add_action(
	'save_post',
	function ( $post_id, $post ) {
		if ( $post && 'publish' === $post->post_status ) {
			studio_headless_queue_revalidation( $post );
		}
	},
	10,
	2
);

if ( STUDIO_HEADLESS_MODE ) {
	add_action(
		'template_redirect',
		function () {
			if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || studio_headless_is_api_request()
				|| is_preview() || is_feed() || is_robots() || is_favicon() || is_trackback() ) {
				return;
			}
			$path = is_singular() ? studio_headless_post_path( get_queried_object() ) : null;
			wp_redirect( studio_headless_frontend_url( null === $path ? '/' : $path ), 302 );
			exit;
		},
		0
	);
}
`;
}

function getStandardMuPlugins( options: MuPluginOptions ): MuPlugin[] {
	const muPlugins: MuPlugin[] = [];

	if ( options.frontend ) {
		muPlugins.push( {
			filename: '0-headless.php',
			content: getHeadlessMuPluginContent( options.frontend ),
		} );
	}

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

	muPlugins.push( {
		filename: '0-https-for-reverse-proxy.php',
		content: `<?php
		// See https://developer.wordpress.org/advanced-administration/security/https/#using-a-reverse-proxy
		if( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && strpos( $_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false ){
			$_SERVER['HTTPS'] = 'on';
		}
		`,
	} );

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

	muPlugins.push( {
		filename: '0-permalinks.php',
		content: `<?php
			// Support permalinks without "index.php"
			add_filter( 'got_url_rewrite', '__return_true' );
	`,
	} );

	muPlugins.push( {
		filename: '0-mail-from.php',
		content: `<?php
		// WordPress sends as wordpress@<site host>, and PHPMailer refuses wordpress@localhost
		// (no dot in the domain), so without this every email a localhost site sends fails.
		add_filter( 'wp_mail_from', function ( $from_email ) {
			return preg_match( '/@[^.@]+$/', $from_email ) ? $from_email . '.localdomain' : $from_email;
		} );
		`,
	} );

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

	muPlugins.push( {
		filename: '0-deactivate-jetpack-modules.php',
		content: `<?php
			// Disable Jetpack Protect so local auto-login is not blocked by 2FA.
			// Disable Jetpack Stats so local previews and thumbnails do not bump remote site stats.
			add_filter( 'jetpack_active_modules', 'studio_deactivate_jetpack_modules' );
			function studio_deactivate_jetpack_modules( $active ) {
				$disabled_modules = array( 'protect', 'stats' );
				return array_values( array_diff( $active, $disabled_modules ) );
			}
	`,
	} );

	// Only an explicit `false` disables auto-updates. Sites created before this
	// option existed have no flag, and every other reader treats that as
	// auto-updating — reading it as falsy here left them pinned for good while
	// Settings showed "latest" (STU-2348).
	if ( options.isWpAutoUpdating === false ) {
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

					// A new username renames the admin Studio manages: inserting a second
					// administrator would fail on the email it still owns.
					$previous_username = get_option( 'studio_admin_username' );
					$previous_user = ! $user && $previous_username ? get_user_by( 'login', $previous_username ) : false;
					if ( $previous_user ) {
						global $wpdb;
						$renamed = array( 'user_login' => $username );
						$nicename = sanitize_title( mb_substr( $username, 0, 50 ) );
						if (
							$previous_user->user_nicename === sanitize_title( mb_substr( $previous_user->user_login, 0, 50 ) ) &&
							$nicename && ! get_user_by( 'slug', $nicename )
						) {
							$renamed['user_nicename'] = $nicename;
						}
						if ( $previous_user->display_name === $previous_user->user_login ) {
							$renamed['display_name'] = $username;
						}
						if ( false === $wpdb->update( $wpdb->users, $renamed, array( 'ID' => $previous_user->ID ) ) ) {
							status_header( 500 );
							header( 'Content-Type: application/json' );
							echo json_encode( [ 'error' => 'Failed to rename the admin user' ] );
							exit;
						}
						if ( get_user_meta( $previous_user->ID, 'nickname', true ) === $previous_user->user_login ) {
							update_user_meta( $previous_user->ID, 'nickname', $username );
						}
						// Multisite stores super admins by login.
						if ( is_multisite() ) {
							$super_admins = get_site_option( 'site_admins', array() );
							$index = is_array( $super_admins ) ? array_search( $previous_user->user_login, $super_admins, true ) : false;
							if ( false !== $index ) {
								$super_admins[ $index ] = $username;
								update_site_option( 'site_admins', $super_admins );
							}
						}
						clean_user_cache( $previous_user );
						$user = get_user_by( 'login', $username );
					}

					if ( $user ) {
						// Write only a changed password: wp_set_password() stores a new hash
						// each time and WordPress derives auth cookies from it, so rewriting
						// the same password logs the user out on every start. No user ID is
						// passed: with one, older WordPress rehashes legacy hashes here.
						if ( $has_password && ! wp_check_password( $_POST['password'], $user->user_pass ) ) {
							wp_set_password( $_POST['password'], $user->ID );
						}
						if ( $provided_email && $provided_email !== $user->user_email ) {
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
						// No Studio-managed admin to rename (e.g. its database was replaced),
						// so create one. Generate a unique email to avoid conflicts.
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

	// Studio's browser UI previews sites in an iframe on another localhost port,
	// which core's same-origin framing headers would block for wp-admin and login.
	muPlugins.push( {
		filename: '0-allow-localhost-framing.php',
		content: `<?php
		function studio_send_frame_options_header() {
			remove_action( current_action(), 'send_frame_options_header' );
			if ( ! headers_sent() ) {
				header( "Content-Security-Policy: frame-ancestors 'self' http://localhost:* http://127.0.0.1:*" );
			}
		}
		add_action( 'admin_init', 'studio_send_frame_options_header', 0 );
		add_action( 'login_init', 'studio_send_frame_options_header', 0 );
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

	return muPlugins;
}

// Content-addressed, so every process that runs a site (the server, WP-CLI,
// imports) resolves the same directory regardless of its TMPDIR. A loader
// pointing at another process's temp directory falls outside the running
// server's open_basedir (STU-2532).
function getMuPluginsDirectory( muPlugins: MuPlugin[] ): string {
	const hash = createHash( 'sha256' );
	for ( const plugin of muPlugins ) {
		hash.update( plugin.filename ).update( '\0' ).update( plugin.content ).update( '\0' );
	}
	return path.join( getMuPluginsPath(), hash.digest( 'hex' ).slice( 0, 16 ) );
}

// Skips identical content and otherwise replaces the file through a rename, so
// a running site never reads a half-written file.
async function writeFileIfChanged( filePath: string, content: string ): Promise< void > {
	try {
		if ( ( await readFile( filePath, 'utf8' ) ) === content ) {
			return;
		}
	} catch {
		// Missing or unreadable; write it.
	}

	const tempPath = `${ filePath }.${ randomUUID() }.tmp`;
	try {
		await writeFile( tempPath, content );
		await rename( tempPath, filePath );
	} catch ( error ) {
		await rm( tempPath, { force: true } );
		throw error;
	}
}

/**
 * Write the Studio mu-plugins for a WordPress instance and return their directory.
 */
export async function getMuPlugins( options: MuPluginOptions = {} ): Promise< string > {
	const muPlugins = getStandardMuPlugins( options );
	const muPluginsDir = getMuPluginsDirectory( muPlugins );
	try {
		await mkdir( muPluginsDir, { recursive: true } );
		for ( const plugin of muPlugins ) {
			await writeFileIfChanged( path.join( muPluginsDir, plugin.filename ), plugin.content );
		}
	} catch ( error ) {
		throw new Error( `Failed to create mu-plugins directory: ${ error }` );
	}
	return muPluginsDir;
}

/**
 * Point the site's loader mu-plugin at the Studio mu-plugins. WordPress
 * auto-loads the loader, which requires the rest from the Studio-managed
 * directory, keeping the user's `wp-content/mu-plugins/` nearly empty.
 */
export async function writeStudioMuPlugins(
	siteFolder: string,
	isWpAutoUpdating: MuPluginOptions[ 'isWpAutoUpdating' ],
	frontend?: MuPluginOptions[ 'frontend' ]
): Promise< string > {
	const muPluginsDir = path.join( siteFolder, 'wp-content', 'mu-plugins' );
	await mkdir( muPluginsDir, { recursive: true } );
	await cleanupLegacyMuPlugins( siteFolder );

	const studioMuPluginsDir = await getMuPlugins( { isWpAutoUpdating, frontend } );
	await writeFileIfChanged(
		path.join( muPluginsDir, STUDIO_LOADER_MU_PLUGIN_FILENAME ),
		getLoaderMuPluginContent( studioMuPluginsDir )
	);
	return studioMuPluginsDir;
}

/**
 * Filename of the loader mu-plugin that Studio drops into
 * the site's `wp-content/mu-plugins/`. It's the only Studio-managed file
 * that ever lands on disk during normal operation, so archive and export
 * filters use this name to skip it.
 */
export const STUDIO_LOADER_MU_PLUGIN_FILENAME = '99-studio-loader.php';

/**
 * Mu-plugin filenames that older Studio versions wrote directly into
 * `wp-content/mu-plugins/`. Newer versions keep these files in a Studio-managed
 * directory and load them through `STUDIO_LOADER_MU_PLUGIN_FILENAME`, so
 * any on-disk copies are leftovers we should clean up at startup. The
 * list includes both currently-shipped and retired filenames so it can
 * scrub anything previously installed by Studio.
 */
export const LEGACY_MU_PLUGIN_FILENAMES = [
	'0-allowed-redirect-hosts.php',
	'0-auto-login.php',
	'0-check-theme-availability.php',
	'0-clear-stat-cache-before-upgrade.php',
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
	'0-32bit-integer-warnings.php',
	'0-dns-functions.php',
	'0-sqlite.php',
	'0-wp-config-constants-polyfill.php',
];

/**
 * Remove legacy Studio mu-plugin files from a site's wp-content/mu-plugins/ directory.
 *
 * Older Studio versions wrote mu-plugin PHP files directly into the site directory.
 * Newer versions load them through `STUDIO_LOADER_MU_PLUGIN_FILENAME`. Having both
 * copies causes PHP fatal errors like "Cannot redeclare" because the same functions
 * are defined in both the on-disk file and the loaded one.
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
