import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { confirm, input, password, select } from '@inquirer/prompts';
import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import { installAiInstructionsToSite } from '@studio/common/lib/agent-skills';
import { extractFormValuesFromBlueprint } from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { getDomainNameValidationError } from '@studio/common/lib/domains';
import {
	arePathsEqual,
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { normalizeLandingPage } from '@studio/common/lib/landing-page';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { isOnline } from '@studio/common/lib/network-utils';
import {
	createPassword,
	encodePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import { portFinder } from '@studio/common/lib/port-finder';
import {
	hasDefaultDbBlock,
	removeDbConstants,
} from '@studio/common/lib/remove-default-db-constants';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import {
	isFileAccessAllowedForRuntime,
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import {
	SITE_MODE_NATIVE,
	SITE_MODE_SANDBOX,
	SITE_RUNTIME_NATIVE_PHP,
	siteRuntimeFromMode,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { sortSites } from '@studio/common/lib/sort-sites';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from '@studio/common/lib/wordpress-version-utils';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import {
	RecommendedPHPVersion,
	SupportedPHPVersions,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { isStepDefinition, type BlueprintV1Declaration } from '@wp-playground/blueprints';
import { bumpStat, getPlatformMetric } from 'cli/lib/bump-stat';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { removeSiteFromConfig } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import {
	getAiInstructionsPath,
	getWordPressVersionPath,
} from 'cli/lib/dependency-management/paths';
import { updateServerFiles } from 'cli/lib/dependency-management/setup';
import { downloadWordPress } from 'cli/lib/dependency-management/wordpress';
import { copyLanguagePackToSite } from 'cli/lib/language-packs';
import { validateSupportedPhpVersion } from 'cli/lib/php-versions';
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { generateSiteName } from 'cli/lib/site-name';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { StatsGroup } from 'cli/lib/types/bump-stats';
import { untildify } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();
const DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL =
	'https://github.com/Automattic/static-site-importer/releases/latest/download/static-site-importer.zip';
const STATIC_SITE_IMPORT_CONTRACT = 'ssi-url-import-v1-batch-pages-25';
const STATIC_SITE_IMPORT_IDENTITY_FILE = 'static-site-importer.json';
type StaticSiteImportIdentity = { url: string; contract: string; phase?: 'cleanup_pending' };

type StaticSiteImporterSource =
	| {
			type: 'url';
			path: string;
			payload: Record< string, unknown >;
	  }
	| {
			type: 'website-artifact';
			path: string;
			artifact: Record< string, unknown >;
			payload: Record< string, unknown >;
	  }
	| {
			type: 'source';
			path: string;
			payload: Record< string, unknown >;
	  };

export type CreateCommandOptions = {
	name?: string;
	siteId?: string;
	wpVersion: string;
	phpVersion: SupportedPHPVersion;
	runtime: SiteRuntime;
	fileAccess: SiteFileAccess;
	customDomain?: string;
	enableHttps: boolean;
	blueprint?: {
		contents: unknown;
		uri: string;
		stagedSource?: {
			sourcePath: string;
			targetPath: string;
		};
		staticSiteImport?: {
			code: string;
			identity?: StaticSiteImportIdentity;
		};
	};
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	noStart: boolean;
	skipBrowser: boolean;
	skipLogDetails: boolean;
};

function readSiteArtifact( artifactPath: string ): Record< string, unknown > {
	if ( ! fs.existsSync( artifactPath ) ) {
		throw new LoggerError( sprintf( __( 'Artifact file not found: %s' ), artifactPath ) );
	}

	try {
		const artifactContent = fs.readFileSync( artifactPath, 'utf-8' );
		const artifact = JSON.parse( artifactContent );
		if ( ! artifact || typeof artifact !== 'object' || Array.isArray( artifact ) ) {
			throw new Error( __( 'Artifact JSON must be an object.' ) );
		}
		return artifact as Record< string, unknown >;
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse artifact JSON file: %s' ), artifactPath ),
			error
		);
	}
}

function isUrl( value: string ): boolean {
	return value.startsWith( 'http://' ) || value.startsWith( 'https://' );
}

function sourceFilePayload( filePath: string, relativePath: string ): Record< string, string > {
	return {
		path: relativePath.replace( /\\/g, '/' ),
		content_base64: fs.readFileSync( filePath ).toString( 'base64' ),
	};
}

function collectSourceFiles( sourceDir: string ): Record< string, string >[] {
	const files: Record< string, string >[] = [];
	const walk = ( currentDir: string ) => {
		for ( const entry of fs.readdirSync( currentDir, { withFileTypes: true } ) ) {
			if ( entry.name === '.DS_Store' || entry.name === '__MACOSX' ) {
				continue;
			}

			const entryPath = path.join( currentDir, entry.name );
			if ( entry.isDirectory() ) {
				walk( entryPath );
				continue;
			}

			if ( entry.isFile() ) {
				files.push( sourceFilePayload( entryPath, path.relative( sourceDir, entryPath ) ) );
			}
		}
	};
	walk( sourceDir );
	return files;
}

function resolveStaticSiteImporterSource(
	sourcePath: string,
	stagedFigmaPath?: string
): StaticSiteImporterSource {
	if ( isUrl( sourcePath ) ) {
		return {
			type: 'url',
			path: sourcePath,
			payload: { url: sourcePath },
		};
	}

	if ( ! fs.existsSync( sourcePath ) ) {
		throw new LoggerError( sprintf( __( 'Import source not found: %s' ), sourcePath ) );
	}

	const stat = fs.statSync( sourcePath );
	if ( stat.isDirectory() ) {
		const files = collectSourceFiles( sourcePath );
		if ( files.length > 0 ) {
			return {
				type: 'source',
				path: sourcePath,
				payload: { files },
			};
		}

		throw new LoggerError( sprintf( __( 'Import source directory is empty: %s' ), sourcePath ) );
	}

	if ( ! stat.isFile() ) {
		throw new LoggerError(
			sprintf( __( 'Import source must be a file or directory: %s' ), sourcePath )
		);
	}

	const extension = path.extname( sourcePath ).toLowerCase();
	if ( extension === '.json' ) {
		const artifact = readSiteArtifact( sourcePath );
		return {
			type: 'website-artifact',
			path: sourcePath,
			artifact,
			payload: { artifact },
		};
	}

	if ( extension === '.zip' ) {
		return {
			type: 'source',
			path: sourcePath,
			payload: {
				archive: {
					name: path.basename( sourcePath ),
					content_base64: fs.readFileSync( sourcePath ).toString( 'base64' ),
				},
			},
		};
	}

	if ( extension === '.fig' ) {
		if ( ! stagedFigmaPath ) {
			throw new LoggerError( __( 'A site path is required to stage Figma imports.' ) );
		}
		return {
			type: 'source',
			path: sourcePath,
			payload: {
				figma_file: {
					name: path.basename( sourcePath ),
					staged_path: stagedFigmaPath,
				},
			},
		};
	}

	return {
		type: 'source',
		path: sourcePath,
		payload: {
			files: [ sourceFilePayload( sourcePath, path.basename( sourcePath ) ) ],
		},
	};
}

function buildStaticSiteImporterPhp(
	source: StaticSiteImporterSource,
	siteName: string,
	storeImportResult: boolean
): string {
	const sourceBase64 = Buffer.from( JSON.stringify( source.payload ) ).toString( 'base64' );
	return `<?php
if ( ! defined( 'ABSPATH' ) ) {
	require_once getcwd() . '/wp-load.php';
}

require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';

$source = json_decode( base64_decode( ${ phpString( sourceBase64 ) } ), true );
if ( ! is_array( $source ) ) {
	throw new RuntimeException( 'Static Site Importer source payload could not be decoded.' );
}

$input = array(
	'name'            => ${ phpString( siteName ) },
	'site_title'      => ${ phpString( siteName ) },
	'activate'        => true,
	'overwrite'       => true,
	'source_metadata' => array(
		'source'      => 'studio-create-from',
		'source_path' => ${ phpString( source.path ) },
	),
);

if ( isset( $source['url'] ) && function_exists( 'static_site_importer_ability_import_url' ) ) {
	$input['url'] = $source['url'];
	$input['work_dir'] = ABSPATH . '.studio-import/static-site-importer';
	$input['provider_args'] = array(
		'collect_site'                => true,
		'require_complete_collection' => true,
		'batch_pages'                 => 25,
		'max_bytes'                  => 10485760,
	);
	$input['require_proven_dynamic_client_assets'] = false;
	$result = static_site_importer_ability_import_url( $input );
} else {
	if ( isset( $source['artifact'] ) && is_array( $source['artifact'] ) ) {
		$artifact = $source['artifact'];
	} else {
		if ( ! function_exists( 'static_site_importer_rest_source_artifact' ) ) {
			throw new RuntimeException( 'Static Site Importer source artifact resolver is unavailable.' );
		}

		$artifact = static_site_importer_rest_source_artifact( $source );
		if ( is_wp_error( $artifact ) ) {
			throw new RuntimeException( 'Static Site Importer source resolution failed: ' . $artifact->get_error_message() );
		}
	}

	if ( ! function_exists( 'static_site_importer_ability_import_website_artifact' ) ) {
		throw new RuntimeException( 'Static Site Importer website artifact import ability is unavailable.' );
	}

	$input['artifact'] = $artifact;
	$result = static_site_importer_ability_import_website_artifact( $input );
}

${ storeImportResult ? "update_option( 'studio_create_from_import_result', $result, false );" : '' }

if ( ! is_array( $result ) || empty( $result['success'] ) ) {
	throw new RuntimeException( 'Static Site Importer import failed: ' . wp_json_encode( $result ) );
}
?>`;
}

function artifactTitle( artifact: Record< string, unknown > ): string | undefined {
	const directTitle = artifact.site_title || artifact.title || artifact.name;
	if ( typeof directTitle === 'string' && directTitle.trim() ) {
		return directTitle.trim();
	}

	const provenance = artifact.provenance;
	if ( provenance && typeof provenance === 'object' && ! Array.isArray( provenance ) ) {
		const provenanceTitle = ( provenance as Record< string, unknown > ).title;
		if ( typeof provenanceTitle === 'string' && provenanceTitle.trim() ) {
			return provenanceTitle.trim();
		}
	}

	return undefined;
}

function phpString( value: string ): string {
	return JSON.stringify( value );
}

export function buildCreateFromSourceBlueprint(
	sourcePath: string,
	siteName: string,
	staticSiteImporterPluginUrl = DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
	sitePath?: string,
	storeImportResult = false
): {
	contents: BlueprintV1Declaration;
	uri: string;
	stagedSource?: { sourcePath: string; targetPath: string };
	staticSiteImport: { code: string; identity?: StaticSiteImportIdentity };
} {
	const stagedFigmaRelativePath =
		path.extname( sourcePath ).toLowerCase() === '.fig'
			? path.join( '.studio-import', 'source.fig' )
			: undefined;
	const stagedFigmaPath =
		path.extname( sourcePath ).toLowerCase() === '.fig' && sitePath
			? path.join( sitePath, '.studio-import', 'source.fig' )
			: undefined;
	const source = resolveStaticSiteImporterSource( sourcePath, stagedFigmaRelativePath );
	const tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-create-from-' ) );
	const blueprintPath = path.join( tempDir, 'blueprint.json' );
	const blueprint: BlueprintV1Declaration = {
		landingPage: '/',
		features: {
			networking: true,
		},
		steps: [
			{
				step: 'installPlugin',
				pluginData: {
					resource: 'url',
					url: staticSiteImporterPluginUrl,
				},
				options: {
					activate: true,
					targetFolderName: 'static-site-importer',
				},
			},
		],
	};

	fs.writeFileSync( blueprintPath, `${ JSON.stringify( blueprint, null, 2 ) }\n` );
	return {
		contents: blueprint,
		uri: blueprintPath,
		...( stagedFigmaPath ? { stagedSource: { sourcePath, targetPath: stagedFigmaPath } } : {} ),
		staticSiteImport: {
			code: buildStaticSiteImporterPhp( source, siteName, storeImportResult ),
			...( source.type === 'url'
				? { identity: { url: source.path, contract: STATIC_SITE_IMPORT_CONTRACT } }
				: {} ),
		},
	};
}

function staticSiteImportIdentityPath( sitePath: string ): string {
	return path.join( sitePath, '.studio-import', STATIC_SITE_IMPORT_IDENTITY_FILE );
}

function cleanupSuccessfulStaticSiteImport( sitePath: string ): void {
	fs.rmSync( path.join( sitePath, '.studio-import', 'import.php' ), { force: true } );
	fs.rmSync( staticSiteImportIdentityPath( sitePath ), { force: true } );
}

async function runStaticSiteImport(
	site: SiteData,
	code: string,
	identity?: StaticSiteImportIdentity
): Promise< boolean > {
	const stagingDir = path.join( site.path, '.studio-import' );
	const scriptName = 'import.php';
	const scriptPath = path.join( stagingDir, scriptName );
	fs.mkdirSync( stagingDir, { recursive: true } );
	if ( identity ) {
		fs.writeFileSync( staticSiteImportIdentityPath( site.path ), JSON.stringify( identity ) );
	}
	fs.writeFileSync( scriptPath, code );

	logger.reportStart( LoggerAction.IMPORT_SITE, __( 'Importing static site…' ) );
	await using command = await runWpCliCommandWithMessaging( site, [
		'eval-file',
		`${ path.basename( stagingDir ) }/${ scriptName }`,
	] );
	const [ exitCode, stdout, stderr ] = await Promise.all( [
		command.response.exitCode,
		command.response.stdoutText,
		command.response.stderrText,
	] );
	if ( exitCode !== 0 ) {
		throw new LoggerError(
			__( 'Static site import failed.' ),
			new Error(
				stderr.trim() || stdout.trim() || sprintf( __( 'WP-CLI exited with code %d.' ), exitCode )
			)
		);
	}
	logger.reportSuccess( __( 'Static site imported successfully' ) );
	if ( identity ) {
		fs.writeFileSync(
			staticSiteImportIdentityPath( site.path ),
			JSON.stringify( { ...identity, phase: 'cleanup_pending' } )
		);
	}
	return cleanupStaticSiteImporterPlugin( site );
}

async function cleanupStaticSiteImporterPlugin( site: SiteData ): Promise< boolean > {
	try {
		await using command = await runWpCliCommandWithMessaging( site, [
			'eval',
			`require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
$plugin = 'static-site-importer/static-site-importer.php';
if ( is_plugin_active( $plugin ) ) {
	deactivate_plugins( $plugin, true );
}
if ( file_exists( WP_PLUGIN_DIR . '/' . $plugin ) ) {
	$result = delete_plugins( array( $plugin ) );
	if ( is_wp_error( $result ) ) {
		throw new RuntimeException( $result->get_error_message() );
	}
}`,
		] );
		const [ exitCode, stdout, stderr ] = await Promise.all( [
			command.response.exitCode,
			command.response.stdoutText,
			command.response.stderrText,
		] );
		if ( exitCode !== 0 ) {
			throw new Error(
				stderr.trim() || stdout.trim() || sprintf( __( 'WP-CLI exited with code %d.' ), exitCode )
			);
		}
		return true;
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__(
					'Static Site Importer cleanup failed. The imported site and resumable import state were preserved.'
				),
				error
			),
			false
		);
		return false;
	}
}

function resumableStaticSiteImportPhase(
	sitePath: string,
	code: string,
	identity: StaticSiteImportIdentity | undefined
): 'import' | 'cleanup_pending' | null {
	if ( ! identity ) {
		return null;
	}
	const scriptPath = path.join( sitePath, '.studio-import', 'import.php' );
	const identityPath = staticSiteImportIdentityPath( sitePath );
	if ( ! fs.existsSync( scriptPath ) || ! fs.existsSync( identityPath ) ) {
		return null;
	}
	try {
		const persistedIdentity = JSON.parse( fs.readFileSync( identityPath, 'utf-8' ) );
		if (
			persistedIdentity?.url !== identity.url ||
			persistedIdentity?.contract !== identity.contract ||
			fs.readFileSync( scriptPath, 'utf-8' ) !== code
		) {
			return null;
		}
		return persistedIdentity.phase === 'cleanup_pending' ? 'cleanup_pending' : 'import';
	} catch {
		return null;
	}
}

export async function runCommand(
	sitePath: string,
	options: CreateCommandOptions
): Promise< void > {
	const siteRuntime = options.runtime;
	if ( ! isFileAccessAllowedForRuntime( siteRuntime, options.fileAccess ) ) {
		throw new LoggerError(
			__(
				'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory.'
			)
		);
	}
	const phpVersion = validateSupportedPhpVersion( options.phpVersion );
	const isOnlineStatus = await isOnline();
	const stagedSource = options.blueprint?.stagedSource;
	const staticSiteImport = options.blueprint?.staticSiteImport;
	let resumedStaticSiteImport = false;
	let staticSiteImportSucceeded = false;
	let staticSiteImportResultObserved = false;
	let registeredSite = false;

	try {
		if ( isOnlineStatus ) {
			const updated = await updateServerFiles();
			if ( updated ) {
				logger.reportSuccess( __( 'Dependencies updated' ) );
			}
		}
	} catch ( error ) {
		// Errors here aren't critical and likely relate to things outside the user's control,
		// like network issues or bad API responses. Report them only in development.
		if ( process.env.NODE_ENV !== 'production' ) {
			const loggerError = new LoggerError( 'Failed to update dependencies', error );
			logger.reportError( loggerError, false );
		}
	}

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating site configuration…' ) );

		const pathExistsResult = await pathExists( sitePath );
		const isEmptyDirResult = pathExistsResult && ( await isEmptyDir( sitePath ) );
		const isWordPressDirResult = pathExistsResult && isWordPressDirectory( sitePath );

		if ( pathExistsResult && ! isEmptyDirResult && ! isWordPressDirResult ) {
			throw new LoggerError(
				__( 'The selected directory is not empty nor an existing WordPress site.' )
			);
		}

		let blueprintUri: string | undefined;
		let blueprint: BlueprintV1Declaration | undefined;
		let blueprintCredentials: { adminUsername?: string; adminPassword?: string } | null = null;

		if ( options.blueprint ) {
			const validation = await validateBlueprintData( options.blueprint.contents );
			if ( ! validation.valid ) {
				throw new LoggerError( validation.error );
			}

			// `validateBlueprintData()` does not give us a proper type guard, but in reality, it ensures
			// `options.blueprint.contents` conforms to the `BlueprintV1Declaration` schema.
			const formValues = extractFormValuesFromBlueprint(
				options.blueprint.contents as BlueprintV1Declaration
			);
			if ( formValues.adminUsername || formValues.adminPassword ) {
				blueprintCredentials = {
					adminUsername: formValues.adminUsername,
					adminPassword: formValues.adminPassword,
				};
			}

			blueprintUri = options.blueprint.uri;
			blueprint = options.blueprint.contents as BlueprintV1Declaration;

			const blueprintHasMultisite = blueprint?.steps
				?.filter( isStepDefinition )
				.some( ( step ) => step.step === 'enableMultisite' );

			if ( blueprintHasMultisite && ! options.customDomain ) {
				throw new LoggerError(
					__(
						'The enableMultisite Blueprint step requires a custom domain. WordPress multisite does not support custom ports. Use --domain <name>.local to set a custom domain.'
					)
				);
			}
		}

		const cliConfig = await readCliConfig();
		const existingSite = cliConfig.sites.find( ( site ) => arePathsEqual( site.path, sitePath ) );
		registeredSite = Boolean( existingSite );
		const resumePhase =
			existingSite && staticSiteImport
				? resumableStaticSiteImportPhase(
						sitePath,
						staticSiteImport.code,
						staticSiteImport.identity
				  )
				: null;
		if ( existingSite && staticSiteImport && resumePhase ) {
			resumedStaticSiteImport = true;
			try {
				staticSiteImportSucceeded =
					resumePhase === 'cleanup_pending'
						? await cleanupStaticSiteImporterPlugin( existingSite )
						: await runStaticSiteImport(
								existingSite,
								staticSiteImport.code,
								staticSiteImport.identity
						  );
				staticSiteImportResultObserved = true;
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to import static site' ), error );
			}
			if ( staticSiteImportSucceeded ) {
				cleanupSuccessfulStaticSiteImport( sitePath );
			}
			return;
		}
		if ( existingSite ) {
			throw new LoggerError( __( 'The selected directory is already in use.' ) );
		}

		for ( const site of cliConfig.sites ) {
			portFinder.addUnavailablePort( site.port );
		}

		if ( options.customDomain ) {
			const existingDomains = cliConfig.sites
				.map( ( site ) => site.customDomain )
				.filter( ( domain ): domain is string => Boolean( domain ) );
			const domainError = getDomainNameValidationError(
				true,
				options.customDomain,
				existingDomains
			);
			if ( domainError ) {
				throw new LoggerError( domainError );
			}
		}

		logger.reportSuccess( __( 'Site configuration validated' ) );

		if ( ! pathExistsResult ) {
			logger.reportStart( LoggerAction.CREATE_DIRECTORY, __( 'Creating site directory…' ) );
			fs.mkdirSync( sitePath, { recursive: true } );
			logger.reportSuccess( __( 'Site directory created' ) );
		}

		if ( stagedSource ) {
			fs.mkdirSync( path.dirname( stagedSource.targetPath ), { recursive: true } );
			fs.copyFileSync( stagedSource.sourcePath, stagedSource.targetPath );
		}

		if ( options.wpVersion === 'latest' ) {
			const bundledWPPath = path.join( getServerFilesPath(), 'wordpress-versions', 'latest' );

			if ( ! ( await pathExists( bundledWPPath ) ) ) {
				throw new LoggerError(
					__(
						'Cannot set up WordPress. Bundled WordPress files not found. Please connect to the internet or reinstall Studio.'
					)
				);
			}

			logger.reportStart( LoggerAction.SETUP_WORDPRESS, __( 'Copying bundled WordPress…' ) );
			await recursiveCopyDirectory( bundledWPPath, sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		} else if ( ! isOnlineStatus ) {
			throw new LoggerError(
				__(
					'Cannot set up WordPress while offline. Specific WordPress versions require an internet connection. Try using "latest" version or ensure internet connectivity.'
				)
			);
		} else if ( siteRuntime === SITE_RUNTIME_NATIVE_PHP && ! isWordPressDirResult ) {
			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Downloading WordPress %s…' ), options.wpVersion )
			);
			await downloadWordPress( options.wpVersion );
			logger.reportSuccess( __( 'WordPress files downloaded' ) );

			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Copying WordPress %s…' ), options.wpVersion )
			);
			await recursiveCopyDirectory( getWordPressVersionPath( options.wpVersion ), sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		}

		logger.reportStart( LoggerAction.INSTALL_SQLITE, __( 'Setting up SQLite integration…' ) );
		await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured' ) );

		try {
			const sharedConfig = await readSharedConfig();
			const selectedSkills = sharedConfig.selectedSkills ?? [];
			await installAiInstructionsToSite(
				{ path: sitePath, runtime: siteRuntime },
				getAiInstructionsPath(),
				selectedSkills
			);
		} catch ( error ) {
			logger.reportError(
				new LoggerError( __( 'Failed to install AI instructions. Proceeding anyway…' ), error ),
				false
			);
		}

		logger.reportStart( LoggerAction.ASSIGN_PORT, __( 'Assigning port…' ) );
		const port = await portFinder.getOpenPort();
		// translators: %d is the port number
		logger.reportSuccess( sprintf( __( 'Port assigned: %d' ), port ) );

		const siteName = options.name || path.basename( sitePath );
		const siteId = options.siteId || crypto.randomUUID();

		// Determine admin credentials: CLI args > Blueprint > defaults
		// External passwords need to be encoded; createPassword() already returns encoded
		const adminUsername = options.adminUsername || blueprintCredentials?.adminUsername || undefined;
		if ( adminUsername ) {
			const usernameError = validateAdminUsername( adminUsername );
			if ( usernameError ) {
				throw new LoggerError( usernameError );
			}
		}
		const adminEmail = options.adminEmail?.trim() || undefined;
		if ( adminEmail ) {
			const emailError = validateAdminEmail( adminEmail );
			if ( emailError ) {
				throw new LoggerError( emailError );
			}
		}

		const externalPassword = options.adminPassword || blueprintCredentials?.adminPassword;
		const adminPassword = externalPassword ? encodePassword( externalPassword ) : createPassword();

		const siteLanguage = await getPreferredSiteLanguage( options.wpVersion );

		if (
			siteLanguage &&
			siteLanguage !== DEFAULT_LOCALE &&
			options.wpVersion === DEFAULT_WORDPRESS_VERSION
		) {
			await copyLanguagePackToSite( sitePath, siteLanguage );
		}

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminUsername,
			adminPassword,
			adminEmail,
			port,
			phpVersion,
			runtime: siteRuntime,
			fileAccess: options.fileAccess,
			running: false,
			status: 'ready',
			isWpAutoUpdating: options.wpVersion === DEFAULT_WORDPRESS_VERSION,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
			landingPage: normalizeLandingPage( blueprint?.landingPage ),
		};

		logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site…' ) );

		try {
			await lockCliConfig();
			const userData = await readCliConfig();

			userData.sites.push( siteDetails );
			sortSites( userData.sites );

			await saveCliConfig( userData );
			logger.reportSuccess( __( 'Site created successfully' ) );
		} finally {
			await unlockCliConfig();
		}

		if ( ! options.noStart ) {
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
			await connectToDaemon();
			logger.reportSuccess( __( 'Process daemon started' ) );

			await setupCustomDomain( siteDetails, logger );

			const startMessage = blueprint
				? __( 'Starting WordPress server and applying Blueprint…' )
				: __( 'Starting WordPress server…' );
			logger.reportStart( LoggerAction.START_SITE, startMessage );
			try {
				await startWordPressServer( siteDetails, logger, {
					wpVersion: options.wpVersion,
					blueprint,
					blueprintUri,
					siteLanguage,
				} );
				logger.reportSuccess( __( 'WordPress server started' ) );

				stripWpConfigDbConstants( sitePath );

				siteDetails.running = true;
				siteDetails.url = siteDetails.customDomain
					? `${ siteDetails.enableHttps ? 'https' : 'http' }://${ siteDetails.customDomain }`
					: `http://localhost:${ siteDetails.port }`;

				if ( staticSiteImport ) {
					staticSiteImportSucceeded = await runStaticSiteImport(
						siteDetails,
						staticSiteImport.code,
						staticSiteImport.identity
					);
					staticSiteImportResultObserved = true;
				}

				if ( ! options.skipLogDetails ) {
					logSiteDetails( siteDetails );
				}
				if ( ! options.skipBrowser ) {
					await openSiteInBrowser( siteDetails );
				}
			} catch ( error ) {
				await removeSiteFromConfig( siteDetails.id );
				if ( ! isWordPressDirResult ) {
					await fs.promises.rm( sitePath, { recursive: true, force: true } );
				}
				throw new LoggerError(
					staticSiteImport
						? __( 'Failed to import static site' )
						: __( 'Failed to start WordPress server' ),
					error
				);
			}
		} else {
			if ( blueprint ) {
				logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
				await connectToDaemon();
				logger.reportSuccess( __( 'Process daemon started' ) );

				logger.reportStart( LoggerAction.START_SITE, __( 'Applying Blueprint…' ) );
				try {
					if ( ! blueprintUri ) {
						throw new LoggerError( __( 'Blueprint source path is missing' ) );
					}
					await runBlueprint( siteDetails, logger, {
						wpVersion: options.wpVersion,
						blueprint,
						blueprintUri,
						siteLanguage,
					} );
					logger.reportSuccess( __( 'Blueprint applied successfully' ) );

					stripWpConfigDbConstants( sitePath );
					if ( staticSiteImport ) {
						staticSiteImportSucceeded = await runStaticSiteImport(
							siteDetails,
							staticSiteImport.code,
							staticSiteImport.identity
						);
						staticSiteImportResultObserved = true;
					}
				} catch ( error ) {
					await removeSiteFromConfig( siteDetails.id );
					if ( ! isWordPressDirResult ) {
						await fs.promises.rm( sitePath, { recursive: true, force: true } );
					}
					throw new LoggerError(
						staticSiteImport
							? __( 'Failed to import static site' )
							: __( 'Failed to apply Blueprint' ),
						error
					);
				}
			}
			console.log( '' );
			console.log( __( 'Site created successfully' ) );
			console.log( '' );
			if ( ! options.skipLogDetails ) {
				logSiteDetails( siteDetails );
			}
			console.log( __( 'Run "studio start" to start the site.' ) );
		}

		logger.reportKeyValuePair( 'id', siteDetails.id );
		logger.reportKeyValuePair( 'port', String( siteDetails.port ) );
		logger.reportKeyValuePair( 'running', String( siteDetails.running ) );
		await emitCliEvent( { event: SITE_EVENTS.CREATED, data: { siteId: siteDetails.id } } );
	} finally {
		if ( stagedSource ) {
			fs.rmSync( path.join( sitePath, '.studio-import' ), { recursive: true, force: true } );
		} else if ( staticSiteImport && staticSiteImportSucceeded ) {
			cleanupSuccessfulStaticSiteImport( sitePath );
		} else if (
			staticSiteImport &&
			! resumedStaticSiteImport &&
			! registeredSite &&
			! staticSiteImportResultObserved
		) {
			fs.rmSync( path.join( sitePath, '.studio-import' ), { recursive: true, force: true } );
		}
		await disconnectFromDaemon();
	}
}

async function fetchBlueprint( url: string ) {
	const res = await fetch( url );

	if ( ! res.ok ) {
		throw new LoggerError( __( 'Failed to fetch Blueprint' ) );
	}

	try {
		return await res.json();
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to parse Blueprint JSON' ), error );
	}
}

function stripWpConfigDbConstants( sitePath: string ): void {
	const wpConfigPath = path.join( sitePath, 'wp-config.php' );
	if ( ! fs.existsSync( wpConfigPath ) ) {
		return;
	}
	const content = fs.readFileSync( wpConfigPath, 'utf-8' );
	if ( hasDefaultDbBlock( content ) ) {
		fs.writeFileSync( wpConfigPath, removeDbConstants( content ), 'utf-8' );
	}
}

function readBlueprint( blueprintPath: string ) {
	if ( ! fs.existsSync( blueprintPath ) ) {
		throw new LoggerError( sprintf( __( 'Blueprint file not found: %s' ), blueprintPath ) );
	}

	try {
		const blueprintContent = fs.readFileSync( blueprintPath, 'utf-8' );
		return JSON.parse( blueprintContent );
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse Blueprint JSON file: %s' ), blueprintPath ),
			error
		);
	}
}

function coerceSiteId( value: string ) {
	// Validate UUID format (8-4-4-4-12 hex characters)
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if ( ! uuidRegex.test( value ) ) {
		throw new ValidationError( 'id', value, __( 'Must be a valid UUID' ) );
	}
	return value;
}

function coerceWpVersion( value: string ) {
	if ( ! isValidWordPressVersion( value ) ) {
		throw new ValidationError(
			'wp',
			value,
			__(
				'Must be: "latest", "nightly", or a valid version number (e.g., "6.4", "6.4.1", "6.4-beta1")'
			)
		);
	}

	if ( ! isWordPressVersionAtLeast( value, MINIMUM_WORDPRESS_VERSION ) ) {
		throw new ValidationError(
			'wp',
			value,
			sprintf( __( 'Must be: at least %s' ), MINIMUM_WORDPRESS_VERSION )
		);
	}

	return value;
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a new site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'id', {
					type: 'string',
					describe: __( 'Site ID (UUID format, used internally by Studio app)' ),
					hidden: true,
					coerce: coerceSiteId,
				} )
				.option( 'name', {
					type: 'string',
					describe: __( 'Site name' ),
				} )
				.option( 'wp', {
					type: 'string',
					describe: __( 'WordPress version (e.g., "latest", "6.4", "6.4.1")' ),
					defaultDescription: DEFAULT_WORDPRESS_VERSION,
					coerce: coerceWpVersion,
				} )
				.option( 'php', {
					type: 'string',
					describe: __( 'PHP version' ),
					choices: SupportedPHPVersions,
					defaultDescription: RecommendedPHPVersion,
				} )
				.option( 'runtime', {
					type: 'string',
					describe: __(
						'Run the site with native PHP ("native") or in the Playground sandbox ("sandbox")'
					),
					choices: [ SITE_MODE_NATIVE, SITE_MODE_SANDBOX ] as const,
					default: SITE_MODE_NATIVE,
				} )
				.option( 'file-access', {
					type: 'string',
					describe: __(
						'Which files PHP can access with the native PHP runtime: the site directory only, or all files'
					),
					choices: [ SITE_FILE_ACCESS_SITE_DIRECTORY, SITE_FILE_ACCESS_ALL_FILES ] as const,
					default: SITE_FILE_ACCESS_SITE_DIRECTORY,
				} )
				.option( 'domain', {
					type: 'string',
					describe: __( 'Custom domain (e.g., "mysite.local")' ),
				} )
				.option( 'https', {
					type: 'boolean',
					describe: __( 'Enable HTTPS for custom domain' ),
					implies: 'domain',
				} )
				.option( 'blueprint', {
					type: 'string',
					describe: __( 'Path or URL to Blueprint JSON file' ),
				} )
				.option( 'from', {
					type: 'string',
					describe: __( 'Create the site from a static import source' ),
					conflicts: 'blueprint',
					coerce: ( value ) => {
						if ( isUrl( value ) ) {
							return value;
						}

						return path.resolve( untildify( value ) );
					},
				} )
				.option( 'static-site-importer-url', {
					type: 'string',
					describe: __( 'Static Site Importer plugin zip URL for --from imports' ),
					default: DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
				} )
				.option( 'store-import-result', {
					type: 'boolean',
					describe: __( 'Store the import result in the created site database' ),
					default: false,
				} )
				.option( 'original-blueprint-path', {
					type: 'string',
					hidden: true,
				} )
				.option( 'admin-username', {
					type: 'string',
					describe: __( 'Admin username (defaults to "admin")' ),
				} )
				.option( 'admin-password', {
					type: 'string',
					describe: __(
						'Admin password (auto-generated if not provided). Note: passwords in CLI arguments may be visible in process lists; consider using a Blueprint file for sensitive passwords.'
					),
				} )
				.option( 'admin-email', {
					type: 'string',
					describe: __( 'Admin email (defaults to "admin@localhost.com")' ),
				} )
				.option( 'start', {
					type: 'boolean',
					describe: __( 'Start the site after creation' ),
					default: true,
				} )
				.option( 'skip-browser', {
					type: 'boolean',
					describe: __( 'Skip opening the site in browser after starting' ),
					default: false,
				} )
				.option( 'skip-log-details', {
					type: 'boolean',
					describe: __( 'Skip printing site URL and admin credentials after creating' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			const artifact =
				argv.from && ! isUrl( argv.from ) && path.extname( argv.from ).toLowerCase() === '.json'
					? readSiteArtifact( argv.from )
					: undefined;
			let siteName = argv.name ?? ( artifact ? artifactTitle( artifact ) : undefined );
			let sitePath = argv.path;
			let wpVersion = argv.wp;
			let phpVersion = argv.php;
			let customDomain = argv.domain;
			let enableHttps = !! argv.https;
			let adminUsername = argv.adminUsername;
			let adminPassword = argv.adminPassword;
			let adminEmail = argv.adminEmail;
			const runtime = siteRuntimeFromMode( argv.runtime );
			const fileAccess = argv.fileAccess;
			if ( ! isFileAccessAllowedForRuntime( runtime, fileAccess ) ) {
				logger.reportError(
					new LoggerError(
						__(
							'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory.'
						)
					)
				);
				return;
			}

			// Validate and resolve the WordPress version against available versions before prompting
			if ( wpVersion && wpVersion !== 'latest' && wpVersion !== 'nightly' ) {
				try {
					logger.reportStart( LoggerAction.VALIDATE, __( 'Checking WordPress version…' ) );
					const availableVersions = await fetchWordPressVersions();
					const matchedVersion = availableVersions.find(
						( v ) => v.value === wpVersion || v.value.startsWith( wpVersion + '.' )
					);
					if ( ! matchedVersion ) {
						const versionLabels = availableVersions
							.filter( ( v ) => v.value !== 'latest' )
							.map( ( v ) => v.label );
						logger.reportError(
							new LoggerError(
								sprintf(
									/* translators: %1$s: requested version, %2$s: list of available versions */
									__( 'WordPress version "%1$s" is not available. Available versions: %2$s' ),
									wpVersion,
									versionLabels.join( ', ' )
								)
							)
						);
						return;
					}
					// Resolve short versions to full versions (e.g. "6.7" → "6.7.2")
					if ( matchedVersion.value !== wpVersion ) {
						logger.reportSuccess(
							sprintf(
								/* translators: %1$s: requested version, %2$s: resolved version */
								__( 'WordPress version: %1$s → %2$s' ),
								wpVersion,
								matchedVersion.value
							)
						);
					} else {
						logger.reportSuccess(
							sprintf(
								/* translators: %s: WordPress version */
								__( 'WordPress version: %s' ),
								wpVersion
							)
						);
					}
					wpVersion = matchedVersion.value;
				} catch {
					// If we can't fetch versions (network issue), let it proceed and fail later
				}
			}

			try {
				if ( process.stdin.isTTY ) {
					if ( ! siteName ) {
						const defaultName = await generateSiteName();
						siteName = await input( {
							message: __( 'Site name:' ),
							default: defaultName,
						} );
					}

					const pathWasExplicitlyProvided = sitePath !== process.cwd();
					if ( ! pathWasExplicitlyProvided ) {
						const suggestedPath = getDefaultSitePath( siteName || __( 'My WordPress Website' ) );
						const promptedPath = await input( {
							message: __( 'Site path:' ),
							default: suggestedPath,
						} );
						sitePath = path.resolve( untildify( promptedPath ) );
					}

					if ( ! wpVersion ) {
						let wpChoices: { name: string; value: string }[];
						try {
							const versions = await fetchWordPressVersions();
							wpChoices = versions.map( ( v ) => ( {
								name: v.value === 'latest' ? `latest (${ v.label })` : v.label,
								value: v.value,
							} ) );
						} catch {
							// Offline or API failure — offer only "latest"
							wpChoices = [
								{
									name: __( 'Latest (recommended)' ),
									value: 'latest',
								},
							];
						}
						wpVersion = await select( {
							message: __( 'WordPress version:' ),
							choices: wpChoices,
							default: DEFAULT_WORDPRESS_VERSION,
							loop: false,
						} );
					}

					if ( ! phpVersion ) {
						phpVersion = await select( {
							message: __( 'PHP version:' ),
							choices: SupportedPHPVersions.map( ( v ) => ( {
								name: v === RecommendedPHPVersion ? sprintf( __( '%s (recommended)' ), v ) : v,
								value: v,
							} ) ),
							default: RecommendedPHPVersion,
						} );
					}

					if ( ! customDomain ) {
						const cliConfig = await readCliConfig();
						const existingDomains = cliConfig.sites
							.map( ( site ) => site.customDomain )
							.filter( ( domain ): domain is string => Boolean( domain ) );

						customDomain = await input( {
							message: __( 'Custom domain (leave empty to skip):' ),
							validate: ( value ) =>
								getDomainNameValidationError( !! value, value, existingDomains ) || true,
						} );
					}

					if ( customDomain && ! argv.https ) {
						enableHttps = await confirm( {
							message: __( 'Enable HTTPS?' ),
							default: false,
						} );
					}

					if ( ! adminUsername ) {
						adminUsername = await input( {
							message: __( 'Admin username:' ),
							default: 'admin',
							validate: ( value ) => validateAdminUsername( value ) || true,
						} );
					}

					if ( ! adminPassword ) {
						adminPassword = await password( {
							message: __( 'Admin password (leave empty to auto-generate):' ),
							mask: true,
						} );
						if ( ! adminPassword ) {
							adminPassword = undefined;
						}
					}

					if ( ! adminEmail ) {
						adminEmail = await input( {
							message: __( 'Admin email:' ),
							default: 'admin@localhost.com',
							validate: ( value ) => validateAdminEmail( value ) || true,
						} );
					}
				}
			} catch {
				// User cancelled the prompt (Ctrl+C)
				return;
			}

			// Apply defaults for non-interactive mode when flags weren't provided
			wpVersion = wpVersion ?? DEFAULT_WORDPRESS_VERSION;

			const config: CreateCommandOptions = {
				name: siteName,
				siteId: argv.id,
				wpVersion,
				phpVersion: phpVersion ?? RecommendedPHPVersion,
				runtime,
				fileAccess,
				customDomain,
				enableHttps,
				adminUsername,
				adminPassword,
				adminEmail,
				noStart: ! argv.start,
				skipBrowser: !! argv.skipBrowser,
				skipLogDetails: !! argv.skipLogDetails,
			};

			if ( argv.from ) {
				config.blueprint = buildCreateFromSourceBlueprint(
					argv.from,
					siteName || __( 'Imported Site' ),
					argv.staticSiteImporterUrl,
					sitePath,
					argv.storeImportResult
				);
			} else if ( argv.blueprint ) {
				if ( argv.blueprint.startsWith( 'http://' ) || argv.blueprint.startsWith( 'https://' ) ) {
					config.blueprint = {
						uri: argv.blueprint,
						contents: await fetchBlueprint( argv.blueprint ),
					};
				} else {
					const uri = path.resolve( untildify( argv.blueprint ) );

					config.blueprint = {
						uri,
						contents: readBlueprint( uri ),
					};

					// When invoked by the desktop app, the blueprint contents come from a temp file
					// but resources should be resolved relative to the original file location.
					// For gallery blueprints the path is a URL; use it directly.
					if ( argv.originalBlueprintPath ) {
						const originalPath = argv.originalBlueprintPath;
						config.blueprint.uri =
							originalPath.startsWith( 'http://' ) || originalPath.startsWith( 'https://' )
								? originalPath
								: path.resolve( originalPath );
					}
				}
			}

			try {
				await runCommand( sitePath, config );

				if ( __ENABLE_CLI_TELEMETRY__ && ! argv.avoidTelemetry ) {
					bumpStat(
						__IS_PACKAGED_FOR_NPM__
							? StatsGroup.STUDIO_CLI_SITE_CREATE_NPM
							: StatsGroup.STUDIO_CLI_SITE_CREATE_APP,
						getPlatformMetric()
					);
				}
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to create site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
