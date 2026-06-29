import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { decodePassword } from '@studio/common/lib/passwords';
import { getWpCliPharPath } from 'cli/lib/dependency-management/paths';
import { runPhpCommand } from './php-process';
import type { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

const DEFAULT_WP_CONFIG_CONSTANTS = { DB_NAME: 'wordpress' } as const;

type Logger = ( ...args: Parameters< typeof console.log > ) => void;

export async function ensureWpConfig(
	siteFolder: string,
	phpVersion: NativePhpSupportedVersion,
	signal: AbortSignal,
	wpConfigTransformerPath: string,
	config?: Pick< ServerConfig, 'enableDebugLog' | 'enableDebugDisplay' >
): Promise< void > {
	const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
	const wpConfigSamplePath = path.join( siteFolder, 'wp-config-sample.php' );
	const ensureWpConfigScript = `
$transformer_path = $argv[1] ?? '';
$wp_config_path = $argv[2] ?? '';
$constants = json_decode( $argv[3] ?? '', true );

require_once $transformer_path;

$transformer = WP_Config_Transformer::from_file( $wp_config_path );
$transformer->define_constants( $constants );
$transformer->to_file( $wp_config_path );
`;

	if ( ! fs.existsSync( wpConfigPath ) && fs.existsSync( wpConfigSamplePath ) ) {
		await fs.promises.copyFile( wpConfigSamplePath, wpConfigPath );
	}

	const enableDebugLog = config?.enableDebugLog ?? false;
	const enableDebugDisplay = config?.enableDebugDisplay ?? false;
	const constants = {
		...DEFAULT_WP_CONFIG_CONSTANTS,
		WP_DEBUG: enableDebugLog || enableDebugDisplay,
		WP_DEBUG_LOG: enableDebugLog,
		WP_DEBUG_DISPLAY: enableDebugDisplay,
	};

	try {
		await runPhpCommand(
			[
				'-r',
				ensureWpConfigScript,
				wpConfigTransformerPath,
				wpConfigPath,
				JSON.stringify( constants ),
			],
			{ phpVersion, signal }
		);
	} catch ( error ) {
		throw new Error(
			`Failed to ensure wp-config.php constants: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
}

function escapePhpSingleQuotedString( value: string ): string {
	return value.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
}

export function getSiteUrlPrependContent( originalAutoPrependFile?: string ): string {
	const chained = originalAutoPrependFile
		? `require '${ escapePhpSingleQuotedString( originalAutoPrependFile ) }';`
		: '';

	// Define WP_HOME/WP_SITEURL before WordPress boots so the site serves from
	// the local URL regardless of the siteurl/home in the DB (e.g. after pulling
	// a remote site — STU-1925). Pre-boot so derived URLs (WP_CONTENT_URL, etc.)
	// resolve locally too. Taken from the request to survive dynamic ports/custom
	// domains; wp-cli is left untouched.
	return `<?php
if ( PHP_SAPI !== 'cli' && ! empty( $_SERVER['HTTP_HOST'] ) ) {
	$studio_is_https = ( ! empty( $_SERVER['HTTPS'] ) && $_SERVER['HTTPS'] !== 'off' )
		|| ( ! empty( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && stripos( $_SERVER['HTTP_X_FORWARDED_PROTO'], 'https' ) !== false );
	$studio_local_url = ( $studio_is_https ? 'https' : 'http' ) . '://' . $_SERVER['HTTP_HOST'];
	if ( ! defined( 'WP_HOME' ) ) {
		define( 'WP_HOME', $studio_local_url );
	}
	if ( ! defined( 'WP_SITEURL' ) ) {
		define( 'WP_SITEURL', $studio_local_url );
	}
}
${ chained }
`;
}

/**
 * Writes the auto_prepend_file that forces WordPress to serve from the local
 * URL. Returns the path to use as auto_prepend_file. For imported sites it
 * chains to reprint's own runtime.php so that prepend still runs.
 */
export function writeSiteUrlPrependFile(
	sitePath: string,
	originalAutoPrependFile?: string
): string {
	const hash = crypto.createHash( 'sha1' ).update( sitePath ).digest( 'hex' ).slice( 0, 16 );
	const prependPath = path.join( os.tmpdir(), `studio-siteurl-prepend-${ hash }.php` );
	fs.writeFileSync( prependPath, getSiteUrlPrependContent( originalAutoPrependFile ) );
	return prependPath;
}

export async function isWordPressInstalled(
	siteFolder: string,
	phpVersion: NativePhpSupportedVersion,
	signal: AbortSignal
): Promise< boolean > {
	const installationCheckScript = `
error_reporting( E_ERROR );
ini_set( 'display_errors', '0' );

$wp_load = getcwd() . '/wp-load.php';
if ( ! file_exists( $wp_load ) ) {
	echo '0';
	exit( 0 );
}
require_once $wp_load;
echo is_blog_installed() ? '1' : '0';
`;

	let stdout = '';
	try {
		const result = await runPhpCommand( [ '-r', installationCheckScript ], {
			phpVersion,
			siteFolder,
			signal,
			mode: 'capture',
		} );
		stdout = result.stdout;
	} catch ( error ) {
		throw new Error(
			`Failed to check WordPress installation status: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}

	const status = stdout.trim();
	return status === '1';
}

export async function installWordPress(
	config: ServerConfig,
	phpVersion: NativePhpSupportedVersion,
	signal: AbortSignal,
	setDefaultPermalinksPath: string,
	logToConsole: Logger
): Promise< void > {
	const alreadyInstalled = await isWordPressInstalled( config.sitePath, phpVersion, signal );
	if ( alreadyInstalled ) {
		logToConsole( `WordPress already installed; skipping installer` );
		return;
	}

	const siteTitle = config.siteTitle ?? 'My WordPress Website';
	const username = config.adminUsername ?? 'admin';
	const password = config.adminPassword ? decodePassword( config.adminPassword ) : 'password';
	const email = config.adminEmail ?? 'admin@localhost.com';
	const siteUrl = config.absoluteUrl ?? `http://localhost:${ config.port }`;
	// WP-CLI defaults to en_US; Studio's DEFAULT_LOCALE of "en" is not a WP locale code.
	const locale =
		config.siteLanguage && config.siteLanguage !== DEFAULT_LOCALE ? config.siteLanguage : undefined;

	await runPhpCommand(
		[
			getWpCliPharPath(),
			'core',
			'install',
			`--path=${ config.sitePath }`,
			`--url=${ siteUrl }`,
			`--title=${ siteTitle }`,
			`--admin_user=${ username }`,
			`--admin_password=${ password }`,
			`--admin_email=${ email }`,
			...( locale ? [ `--locale=${ locale }` ] : [] ),
			'--skip-email',
		],
		{ phpVersion, signal }
	);

	await runPhpCommand(
		[
			getWpCliPharPath(),
			'option',
			'update',
			'studio_admin_username',
			username,
			`--path=${ config.sitePath }`,
		],
		{ phpVersion, signal }
	);

	try {
		await runPhpCommand( [ setDefaultPermalinksPath ], {
			phpVersion,
			siteFolder: config.sitePath,
			signal,
		} );
	} catch ( error ) {
		throw new Error(
			`Failed to set default permalinks: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
}
