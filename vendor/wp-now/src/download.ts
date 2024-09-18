import followRedirects, { FollowResponse } from 'follow-redirects';
import fs from 'fs-extra';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import { IncomingMessage } from 'http';
import os from 'os';
import path from 'path';
import unzipper from 'unzipper';
import { DEFAULT_WORDPRESS_VERSION, SQLITE_FILENAME, SQLITE_URL, WP_CLI_URL } from './constants';
import getSqlitePath from './get-sqlite-path';
import getWordpressVersionsPath from './get-wordpress-versions-path';
import getWpCliPath from './get-wp-cli-path';
import getWpNowPath from './get-wp-now-path';
import { output } from './output';
import { isValidWordPressVersion } from './wp-playground-wordpress';

function httpsGet( url: string, callback: ( res: IncomingMessage & FollowResponse ) => void ) {
	const proxy =
		process.env.https_proxy ||
		process.env.HTTPS_PROXY ||
		process.env.http_proxy ||
		process.env.HTTP_PROXY;

	let agent: HttpsProxyAgent | HttpProxyAgent | undefined;

	if ( proxy ) {
		const urlParts = new URL( url );
		const Agent = urlParts.protocol === 'https:' ? HttpsProxyAgent : HttpProxyAgent;
		agent = new Agent( { proxy } );
	}

	https.get( url, { agent }, callback );
}

function getWordPressVersionUrl( version = DEFAULT_WORDPRESS_VERSION ) {
	if ( ! isValidWordPressVersion( version ) ) {
		throw new Error(
			'Unrecognized WordPress version. Please use "latest" or numeric versions such as "6.2", "6.0.1", "6.2-beta1", or "6.2-RC1"'
		);
	}
	return `https://wordpress.org/wordpress-${ version }.zip`;
}

interface DownloadFileAndUnzipResult {
	downloaded: boolean;
	statusCode: number;
}

const { https } = followRedirects;

async function downloadFile( {
	url,
	destinationFilePath,
	itemName,
	overwrite = false,
} ): Promise< DownloadFileAndUnzipResult > {
	let statusCode = 0;
	try {
		if ( fs.existsSync( destinationFilePath ) && ! overwrite ) {
			return { downloaded: false, statusCode: 0 };
		}
		fs.ensureDirSync( path.dirname( destinationFilePath ) );
		const response = await new Promise< IncomingMessage >( ( resolve ) =>
			httpsGet( url, ( response ) => resolve( response ) )
		);
		statusCode = response.statusCode;
		if ( response.statusCode !== 200 ) {
			throw new Error( `Failed to download file (Status code ${ response.statusCode }).` );
		}
		await new Promise< void >( ( resolve, reject ) => {
			fs.ensureFileSync( destinationFilePath );
			const file = fs.createWriteStream( destinationFilePath );
			response.pipe( file );
			file.on( 'finish', () => {
				file.close();
				resolve();
			} );
			file.on( 'error', ( error ) => {
				file.close();
				reject( error );
			} );
		} );
		output?.log( `Downloaded ${ itemName } to ${ destinationFilePath }` );
		return { downloaded: true, statusCode };
	} catch ( error ) {
		output?.error( `Error downloading file ${ itemName }`, error );
		return { downloaded: false, statusCode };
	}
}

export async function downloadWpCli( overwrite = false ) {
	return downloadFile( {
		url: WP_CLI_URL,
		destinationFilePath: getWpCliPath(),
		itemName: 'wp-cli',
		overwrite,
	} );
}

async function downloadFileAndUnzip( {
	url,
	destinationFolder,
	checkFinalPath,
	itemName,
	overwrite = false,
} ): Promise< DownloadFileAndUnzipResult > {
	if ( ! overwrite && fs.existsSync( checkFinalPath ) ) {
		output?.log( `${ itemName } folder already exists. Skipping download.` );
		return { downloaded: false, statusCode: 0 };
	}

	let statusCode = 0;

	try {
		await fs.ensureDir( path.dirname( destinationFolder ) );

		output?.log( `Downloading ${ itemName }...` );
		const response = await new Promise< IncomingMessage >( ( resolve ) =>
			httpsGet( url, ( response ) => resolve( response ) )
		);
		statusCode = response.statusCode;

		if ( response.statusCode !== 200 ) {
			throw new Error( `Failed to download file (Status code ${ response.statusCode }).` );
		}

		const entryPromises: Promise< unknown >[] = [];

		/**
		 * Using Parse because Extract is broken:
		 * https://github.com/WordPress/wordpress-playground/issues/248
		 */
		await response
			.pipe( unzipper.Parse() )
			.on( 'entry', ( entry ) => {
				const filePath = path.join( destinationFolder, entry.path );
				/*
				 * Use the sync version to ensure entry is piped to
				 * a write stream before moving on to the next entry.
				 */
				fs.ensureDirSync( path.dirname( filePath ) );

				if ( entry.type === 'Directory' ) {
					entryPromises.push( entry.autodrain().promise() );
				} else {
					const promise = new Promise( ( resolve, reject ) => {
						entry
							.pipe( fs.createWriteStream( filePath ) )
							.on( 'close', resolve )
							.on( 'error', reject );
					} );
					entryPromises.push( promise );
				}
			} )
			.promise();

		// Wait until all entries have been extracted before continuing
		await Promise.all( entryPromises );

		return { downloaded: true, statusCode };
	} catch ( err ) {
		output?.error( `Error downloading or unzipping ${ itemName }:`, err );
	}
	return { downloaded: false, statusCode };
}

export async function downloadWordPress(
	wordPressVersion = DEFAULT_WORDPRESS_VERSION,
	{ overwrite }: { overwrite: boolean } = { overwrite: false }
) {
	const finalFolder = getWordPressVersionPath( wordPressVersion );
	const tempFolder = os.tmpdir();
	const { downloaded, statusCode } = await downloadFileAndUnzip( {
		url: getWordPressVersionUrl( wordPressVersion ),
		destinationFolder: tempFolder,
		checkFinalPath: finalFolder,
		itemName: `WordPress ${ wordPressVersion }`,
		overwrite,
	} );
	if ( downloaded ) {
		await fs.ensureDir( path.dirname( finalFolder ) );
		await fs.move( path.join( tempFolder, 'wordpress' ), finalFolder, {
			overwrite: true,
		} );
	} else if ( 404 === statusCode ) {
		output?.log(
			`WordPress ${ wordPressVersion } not found. Check https://wordpress.org/download/releases/ for available versions.`
		);
	}
}

export async function downloadSqliteIntegrationPlugin(
	{ overwrite }: { overwrite: boolean } = { overwrite: false }
) {
	const finalFolder = getSqlitePath();
	const tempFolder = path.join( os.tmpdir(), SQLITE_FILENAME );
	const { downloaded, statusCode } = await downloadFileAndUnzip( {
		url: SQLITE_URL,
		destinationFolder: tempFolder,
		checkFinalPath: finalFolder,
		itemName: 'SQLite',
		overwrite,
	} );
	if ( downloaded ) {
		const nestedFolder = path.join( tempFolder, SQLITE_FILENAME );
		await fs.ensureDir( path.dirname( finalFolder ) );
		await fs.move( nestedFolder, finalFolder, {
			overwrite: true,
		} );
	} else if ( 0 !== statusCode ) {
		throw Error( 'An error ocurred when download SQLite' );
	}
}

export async function downloadSQLiteCommand( downloadUrl: string, targetPath: string ) {
	const tempFolder = path.join( os.tmpdir(), 'wp-cli-sqlite-command' );
	const { downloaded, statusCode } = await downloadFileAndUnzip( {
		url: downloadUrl,
		destinationFolder: tempFolder,
		checkFinalPath: targetPath,
		itemName: 'SQLite Command',
		overwrite: true,
	} );

	if ( ! downloaded ) {
		throw new Error( `Failed to download SQLite CLI command. Status code: ${ statusCode }` );
	}

	await fs.ensureDir( path.dirname( targetPath ) );

	await fs.move( path.join( tempFolder ), targetPath, {
		overwrite: true,
	} );
}

export async function downloadMuPlugins( customMuPluginsPath = '' ) {
	const muPluginsPath = customMuPluginsPath || path.join( getWpNowPath(), 'mu-plugins' );
	fs.ensureDirSync( muPluginsPath );

	fs.removeSync( path.join( muPluginsPath, '0-allow-wp-org.php' ) );

	fs.writeFile(
		path.join( muPluginsPath, '0-allowed-redirect-hosts.php' ),
		`<?php
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
	`
	);

	fs.writeFile(
		path.join( muPluginsPath, '0-dns-functions.php' ),
		`<?php
		// Polyfill for DNS functions/features which are not currently supported by @php-wasm/node.
		// See https://github.com/WordPress/wordpress-playground/issues/1042
		// These specific features are polyfilled so the Jetpack plugin loads correctly, but others should be added as needed.
		if ( ! function_exists( 'dns_get_record' ) ) {
			function dns_get_record() {
				return array();
			}
		}
		if ( ! defined( 'DNS_NS' ) ) {
			define( 'DNS_NS', 2 );
		}`
	);

	fs.writeFile(
		path.join( muPluginsPath, '0-thumbnails.php' ),
		`<?php
		// Facilitates the taking of screenshots to be used as thumbnails.
		if ( isset( $_GET['studio-hide-adminbar'] ) ) {
			add_filter( 'show_admin_bar', '__return_false' );
		}
		`
	);

	fs.writeFile(
		path.join( muPluginsPath, '0-sqlite.php' ),
		`<?php
		if ( file_exists( WP_CONTENT_DIR . "/db.php" ) && file_exists( __DIR__ . "/${ SQLITE_FILENAME }/load.php" ) ) {
			require_once __DIR__ . "/${ SQLITE_FILENAME }/load.php";
		}`
	);

	fs.writeFile(
		path.join( muPluginsPath, '0-32bit-integer-warnings.php' ),
		`<?php
/**
 * This is a temporary workaround to hide the 32bit integer warnings that
 * appear when using various time related function, such as strtotime and mktime.
 * Examples of the warnings that are displayed:
 * Warning: mktime(): Epoch doesn't fit in a PHP integer in <file>
 * Warning: strtotime(): Epoch doesn't fit in a PHP integer in <file>
 */
set_error_handler(function($severity, $message, $file, $line) {
  if (strpos($message, "fit in a PHP integer") !== false) {
      return;
  }
  return false;
});
`
	);

	fs.writeFile(
		path.join( muPluginsPath, '0-check-theme-availability.php' ),
		`<?php
	function check_current_theme_availability() {
			// Get the current theme's directory
			$current_theme = wp_get_theme();
			$theme_dir = get_theme_root() . '/' . $current_theme->stylesheet;

			if (!is_dir($theme_dir)) {
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
`
	);

	fs.writeFile(
		path.join( muPluginsPath, '0-permalinks.php' ),
		`<?php
			// Support permalinks without "index.php"
			add_filter( 'got_url_rewrite', '__return_true' );
	`
	);
}

export function getWordPressVersionPath( wpVersion: string ) {
	return path.join( getWordpressVersionsPath(), wpVersion );
}
