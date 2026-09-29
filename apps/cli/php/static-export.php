<?php
/**
 * Static export driver, loaded with `wp --require=<staging dir>/static-export.php studio-static-export`.
 *
 * The staging directory (inside the site, so the PHP-wasm runtime can reach it) holds this
 * file, a copy of the Simply Static plugin, a copy of the site database and `config.json`.
 * Simply Static is loaded from there instead of being installed in the site, and its state
 * (options, crawl table, cron events) goes to the database copy, so the site is left untouched.
 * Pages are fetched over HTTP from the running site, which serves the real database.
 */

$studio_static_config = json_decode( file_get_contents( __DIR__ . '/config.json' ), true );

define( 'DB_DIR', __DIR__ . '/' );
define( 'DB_FILE', $studio_static_config['databaseFile'] );

// The stored home/siteurl can differ from the URL the site is served on (e.g. after the
// site folder was copied), and Simply Static crawls and rewrites based on home_url().
$studio_static_source_url = rtrim( $studio_static_config['sourceUrl'], '/' );
WP_CLI::add_wp_hook(
	'pre_option_home',
	function () use ( $studio_static_source_url ) {
		return $studio_static_source_url;
	}
);
WP_CLI::add_wp_hook(
	'pre_option_siteurl',
	function () use ( $studio_static_source_url ) {
		return $studio_static_source_url;
	}
);

WP_CLI::add_wp_hook(
	'muplugins_loaded',
	function () {
		require_once __DIR__ . '/simply-static/simply-static.php';
	}
);

// Run the job queue inline in this process instead of through loopback requests.
WP_CLI::add_wp_hook( 'wp_archive_creation_job_loopback_available', '__return_false' );
// GET_LOCK()/IS_USED_LOCK() don't exist on SQLite, and this process is the only worker.
WP_CLI::add_wp_hook( 'wp_archive_creation_job_use_database_lock', '__return_false' );

// Smart crawl force-enables the wp-includes crawler, which copies all of wp-includes.
// Referenced core assets are still exported as they are found in the pages.
WP_CLI::add_wp_hook(
	'simply_static_crawlers',
	function ( $crawlers ) {
		return array_filter(
			$crawlers,
			function ( $crawler ) {
				return ! $crawler instanceof \Simply_Static\Crawler\Wp_Includes_Crawler;
			}
		);
	}
);

// Simply Static's list of asset extensions misses AVIF, so AVIF images were never exported.
WP_CLI::add_wp_hook(
	'simply_static_allowed_local_asset_extensions',
	function ( $extensions ) {
		return array_merge( $extensions, array( 'avif' ) );
	}
);

// Simply Static refuses to fetch, and mangles when rewriting, URLs with dot segments such
// as Jetpack's `jetpack-forms/src/../dist/...` stylesheets.
function studio_static_resolve_dot_segments( $url ) {
	$path = wp_parse_url( $url, PHP_URL_PATH );
	if ( ! $path || ! preg_match( '#(^|/)\.\.?(/|$)#', $path ) ) {
		return $url;
	}
	$segments = array();
	foreach ( explode( '/', $path ) as $segment ) {
		if ( '..' === $segment ) {
			array_pop( $segments );
		} elseif ( '.' !== $segment ) {
			$segments[] = $segment;
		}
	}
	return str_replace( $path, implode( '/', $segments ), $url );
}
WP_CLI::add_wp_hook( 'simply_static_extracted_url', 'studio_static_resolve_dot_segments' );
WP_CLI::add_wp_hook( 'simply_static_pre_converted_url', 'studio_static_resolve_dot_segments' );

WP_CLI::add_command(
	'studio-static-export',
	function () use ( $studio_static_config ) {
		$options = \Simply_Static\Options::instance();
		$options
			->set( 'delivery_method', 'local' )
			->set( 'local_dir', __DIR__ . '/output/' )
			->set( 'clear_directory_before_export', true )
			->set( 'generate_404', true )
			->set( 'add_feeds', true )
			->set( 'crawlers', array( 'home', 'post_type', 'taxonomy', 'author', 'archive', 'pagination', 'rss_feeds', 'sitemap', 'text_file' ) )
			// Only referenced from the inline emoji settings JSON, which isn't crawled.
			->set( 'additional_urls', includes_url( 'js/wp-emoji-release.min.js' ) );

		$destination = wp_parse_url( $studio_static_config['destinationUrl'] ?? '' );
		if ( ! empty( $destination['host'] ) ) {
			$options
				->set( 'destination_url_type', 'absolute' )
				->set( 'destination_scheme', $destination['scheme'] . '://' )
				->set( 'destination_host', $destination['host'] . ( isset( $destination['port'] ) ? ':' . $destination['port'] : '' ) );
		} else {
			$options
				->set( 'destination_url_type', 'relative' )
				->set( 'relative_path', '' );
		}
		$options->save();

		// The queue runs inline from a shutdown function once this command returns.
		add_action(
			'ss_completed',
			function ( $status, $message = '' ) {
				if ( 'success' !== $status ) {
					WP_CLI::error( 'Static export failed: ' . $message, false );
					exit( 1 );
				}
				WP_CLI::success( 'Static export complete.' );
			},
			10,
			2
		);

		if ( ! \Simply_Static\Plugin::instance()->run_static_export( 0, 'export' ) ) {
			WP_CLI::error( 'Could not start the static export.' );
		}
	}
);
