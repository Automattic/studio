import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { escapePhpSingleQuotedString } from '@studio/common/lib/mu-plugins';
import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_USERNAME,
	decodeAdminPassword,
} from '@studio/common/lib/passwords';
import { getSettingsWpConfigConstants } from '@studio/common/lib/wp-config-constants';
import { isSqliteIntegrationInstalled } from '@studio/database/node';
import { getWpCliPharPath } from 'cli/lib/dependency-management/paths';
import { ensurePhpBinaryAvailable } from '../dependency-management/php-binary';
import { runPhpCommand } from './php-process';
import { getFullyResolvedTmpDirPath } from './tmp-dir';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

const WP_CONFIG_TRANSFORMER_PATH = path.resolve(
	import.meta.dirname,
	'php',
	'wp-config-transformer.php'
);

const DEFAULT_WP_CONFIG_CONSTANTS = { DB_NAME: 'wordpress' } as const;

type Logger = ( ...args: Parameters< typeof console.log > ) => void;

type EnsureWpConfigOptions = Pick<
	ServerConfig,
	'enableDebugLog' | 'enableDebugDisplay' | 'enableScriptDebug' | 'environmentType'
> & {
	forceDefaultDatabaseName?: boolean;
};

export async function ensureWpConfig(
	siteFolder: string,
	phpVersion: SupportedPHPVersion,
	signal?: AbortSignal,
	config?: EnsureWpConfigOptions
): Promise< void > {
	const shouldSetDefaultDatabaseName =
		config?.forceDefaultDatabaseName ?? isSqliteIntegrationInstalled( siteFolder );
	await defineWpConfigConstants(
		siteFolder,
		phpVersion,
		{
			...( shouldSetDefaultDatabaseName ? DEFAULT_WP_CONFIG_CONSTANTS : {} ),
			...getSettingsWpConfigConstants( config ?? {} ),
		},
		signal
	);
}

/**
 * Defines constants in the site's wp-config.php, creating it from wp-config-sample.php
 * when it doesn't exist yet.
 */
export async function defineWpConfigConstants(
	siteFolder: string,
	phpVersion: SupportedPHPVersion,
	constants: Record< string, unknown >,
	signal?: AbortSignal
): Promise< void > {
	const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
	const wpConfigSamplePath = path.join( siteFolder, 'wp-config-sample.php' );
	const defineConstantsScript = `
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
	await ensurePhpBinaryAvailable( phpVersion );

	try {
		await runPhpCommand(
			[
				'-r',
				defineConstantsScript,
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

/**
 * Reads constants from the site's wp-config.php. A constant that isn't defined with a string
 * or number literal (e.g. read from an environment variable) comes back as null.
 */
export async function readWpConfigConstants< Name extends string >(
	siteFolder: string,
	phpVersion: SupportedPHPVersion,
	names: readonly Name[]
): Promise< Record< Name, string | number | null > > {
	const readConstantsScript = `
require_once $argv[1];

$transformer = WP_Config_Transformer::from_file( $argv[2] );
$values = array();
foreach ( json_decode( $argv[3], true ) as $name ) {
	$values[ $name ] = $transformer->get_constant_value( $name );
}
echo json_encode( $values );
`;
	await ensurePhpBinaryAvailable( phpVersion );
	const { stdout } = await runPhpCommand(
		[
			'-r',
			readConstantsScript,
			WP_CONFIG_TRANSFORMER_PATH,
			path.join( siteFolder, 'wp-config.php' ),
			JSON.stringify( names ),
		],
		{ phpVersion, mode: 'capture' }
	);
	return JSON.parse( stdout );
}

function getSiteUrlPrependContent( siteUrl: string, originalAutoPrependFile?: string ): string {
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

async function isWordPressInstalled(
	siteFolder: string,
	phpVersion: SupportedPHPVersion,
	signal: AbortSignal
): Promise< boolean > {
	// SHORTINIT stops wp-settings.php once the database drop-in is loaded, before the
	// site's plugins and theme, whose fatal error would otherwise fail the check
	// and keep the site from starting.
	const installationCheckScript = `
error_reporting( E_ERROR );
ini_set( 'display_errors', '0' );
define( 'SHORTINIT', true );

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

function isCoreLanguagePackInstalled( sitePath: string, locale: string ): boolean {
	const languagesDir = path.join( sitePath, 'wp-content', 'languages' );
	return [ `${ locale }.l10n.php`, `${ locale }.mo` ].some( ( file ) =>
		fs.existsSync( path.join( languagesDir, file ) )
	);
}

/**
 * Installs WordPress unless it already is. Returns whether it ran the installer,
 * which also creates the admin user with the configured credentials.
 */
export async function installWordPress(
	config: ServerConfig,
	phpVersion: SupportedPHPVersion,
	signal: AbortSignal,
	finishInstallPath: string,
	logToConsole: Logger,
	skipInstallationCheck = false
): Promise< boolean > {
	const alreadyInstalled =
		! skipInstallationCheck &&
		( await isWordPressInstalled( config.sitePath, phpVersion, signal ) );
	if ( alreadyInstalled ) {
		logToConsole( `WordPress already installed; skipping installer` );
		return false;
	}

	const siteTitle = config.siteTitle ?? 'My WordPress Website';
	const username = config.adminUsername ?? DEFAULT_ADMIN_USERNAME;
	const password = decodeAdminPassword( config.adminPassword );
	const email = config.adminEmail ?? DEFAULT_ADMIN_EMAIL;
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
			`--require=${ finishInstallPath }`,
		],
		{ phpVersion, signal }
	);

	// `core install --locale` doesn't download translations, and WordPress only accepts a WPLANG
	// whose pack is installed, so fetch the core pack when Studio didn't bundle it for this locale.
	if ( locale && ! isCoreLanguagePackInstalled( config.sitePath, locale ) ) {
		try {
			await runPhpCommand(
				[
					getWpCliPharPath(),
					'language',
					'core',
					'install',
					locale,
					`--path=${ config.sitePath }`,
				],
				{ phpVersion, signal }
			);
		} catch ( error ) {
			logToConsole(
				`Failed to install the ${ locale } language pack: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}

	if ( locale ) {
		try {
			await runPhpCommand(
				[ getWpCliPharPath(), 'option', 'update', 'WPLANG', locale, `--path=${ config.sitePath }` ],
				{ phpVersion, signal }
			);
		} catch ( error ) {
			// Best-effort: site can still function in English if setting WPLANG fails.
			logToConsole(
				`Failed to set WPLANG to ${ locale }: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
	return true;
}
