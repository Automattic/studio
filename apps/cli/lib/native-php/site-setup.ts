import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { escapePhpSingleQuotedString } from '@studio/common/lib/mu-plugins';
import { decodePassword } from '@studio/common/lib/passwords';
import { type NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';
import { getWpCliPharPath } from 'cli/lib/dependency-management/paths';
import { ensurePhpBinaryAvailable } from '../dependency-management/php-binary';
import { runPhpCommand } from './php-process';
import { getFullyResolvedTmpDirPath } from './tmp-dir';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

const WP_CONFIG_TRANSFORMER_PATH = path.resolve(
	import.meta.dirname,
	'php',
	'wp-config-transformer.php'
);

const DEFAULT_WP_CONFIG_CONSTANTS = { DB_NAME: 'wordpress' } as const;

type Logger = ( ...args: Parameters< typeof console.log > ) => void;

export async function ensureWpConfig(
	siteFolder: string,
	phpVersion: NativePhpSupportedVersion,
	signal?: AbortSignal,
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
	await ensurePhpBinaryAvailable( phpVersion );

	try {
		await runPhpCommand(
			[
				'-r',
				ensureWpConfigScript,
				WP_CONFIG_TRANSFORMER_PATH,
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

export function getSiteUrlPrependContent(
	siteUrl: string,
	originalAutoPrependFile?: string
): string {
	const escapedSiteUrl = escapePhpSingleQuotedString( siteUrl );
	const chained = originalAutoPrependFile
		? `require '${ escapePhpSingleQuotedString( originalAutoPrependFile ) }';`
		: '';

	// Define WP_HOME/WP_SITEURL before WordPress boots so the site serves from
	// the local URL even when the DB still holds a remote one. Running pre-boot
	// means derived URLs (WP_CONTENT_URL, etc.) resolve locally too.
	return `<?php
if ( ! defined( 'WP_HOME' ) ) {
	define( 'WP_HOME', '${ escapedSiteUrl }' );
}
if ( ! defined( 'WP_SITEURL' ) ) {
	define( 'WP_SITEURL', '${ escapedSiteUrl }' );
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
	siteUrl: string,
	originalAutoPrependFile?: string
): string {
	const dir = fs.mkdtempSync(
		path.join( getFullyResolvedTmpDirPath(), 'studio-siteurl-prepend-' )
	);
	const prependPath = path.join( dir, 'prepend.php' );
	fs.writeFileSync( prependPath, getSiteUrlPrependContent( siteUrl, originalAutoPrependFile ) );
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

	// WP-CLI's --locale flag may silently fall back to English when it can't
	// download the language pack (e.g. offline, wordpress.org unreachable).
	// Force WPLANG so the site respects the configured language even when
	// translation files aren't available yet.
	if ( locale ) {
		try {
			await runPhpCommand(
				[
					getWpCliPharPath(),
					'eval',
					`global $wpdb; $wpdb->query( $wpdb->prepare( "REPLACE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES ('WPLANG', %s, 'yes')", '${ locale }' ) );`,
					`--path=${ config.sitePath }`,
				],
				{ phpVersion, signal }
			);
		} catch {
			// noop
		}
	}

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
