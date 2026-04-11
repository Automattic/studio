/**
 * CLI command: studio site pull-streaming
 *
 * Imports a remote WordPress site into a local Studio site using the
 * streaming site migration protocol and the importer's two-phase file
 * filtering support.
 */
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProcessIdAllocator } from '@php-wasm/universal';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { arePathsEqual, isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { generateNumberedName } from '@studio/common/lib/generate-site-name';
import { portFinder } from '@studio/common/lib/port-finder';
import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';
import { sortSites } from '@studio/common/lib/sort-sites';
import { ImportCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import chalk from 'chalk';
import { getWpComSites, rotateStreamingExportSecret, type WpComSiteInfo } from 'cli/lib/api';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteUrl, updateSiteAutoStart, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import {
	type ImporterResult,
	runImporterCommandUntilComplete,
} from 'cli/lib/import/migration-client';
import {
	loadImportedRuntimeStartOptions,
	normalizeImportedSqliteDatabasePath,
} from 'cli/lib/import/runtime-start-options';
import { PROCESS_MANAGER_LOGS_DIR } from 'cli/lib/paths';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

const PLUGIN_INSTALL_HINT =
	'Make sure the streaming-site-migration plugin is installed and activated.\n' +
	'Download the latest version from:\n' +
	'https://github.com/adamziel/streaming-site-migration/releases/latest';

const IMPORTS_ROOT = path.join( os.homedir(), '.studio', 'imports' );
const SKIPPED_DOWNLOAD_LIST = '.import-download-list-skipped.jsonl';
const DEFAULT_WPCOM_SITE_LIST_LIMIT = 15;
const FILES_SYNC_MAX_EXEC_SECONDS = 30;

const importStageOrder = [
	'initialized',
	'essential-files-complete',
	'flattened',
	'db-downloaded',
	'db-applied',
	'runtime-generated',
	'site-registered',
	'site-started',
	'completed',
] as const;

type ImportStage = ( typeof importStageOrder )[ number ];

const IMPORT_METADATA_VERSION = 1;

interface ImportMetadata {
	version: number;
	importKey: string;
	normalizedUrl: string;
	siteName: string;
	sitePath: string;
	technicalSiteDirectory: string;
	rawDirectory: string;
	stateDirectory: string;
	runtimeDirectory: string;
	runtimeBlueprintPath: string;
	stage: ImportStage;
	siteId?: string;
	port?: number;
	localUrl?: string;
	remoteSiteUrl?: string;
	tablePrefix?: string;
	secret?: string;
}

interface ImporterStateSnapshot {
	command?: string | null;
	status?: string | null;
	cursor?: unknown;
	stage?: string | null;
	preflight?: {
		data?: {
			runtime?: {
				document_root?: string | null;
			};
		};
	};
}

interface ResolveImportMetadataResult {
	created: boolean;
	metadata: ImportMetadata;
}

interface ResolvedImportSource {
	secret: string;
	url: string;
	/**
	 * When the source is a WP.com site, carry the site info and token so the
	 * caller can rotate the secret if the stored one turns out to be stale.
	 */
	wpComSite?: WpComSiteInfo;
	wpComToken?: StoredAuthToken;
}

class ImportError extends LoggerError {
	technicalDetails: string;

	constructor( userMessage: string, technicalDetails: string ) {
		super( userMessage );
		this.technicalDetails = technicalDetails;
	}
}

function redBox( message: string ): string {
	const lines = message.split( '\n' );
	const maxLen = Math.max( ...lines.map( ( line ) => line.length ) );
	const top = chalk.red( '┌' + '─'.repeat( maxLen + 2 ) + '┐' );
	const bottom = chalk.red( '└' + '─'.repeat( maxLen + 2 ) + '┘' );
	const body = lines
		.map( ( line ) => chalk.red( '│' ) + ' ' + line.padEnd( maxLen ) + ' ' + chalk.red( '│' ) )
		.join( '\n' );
	return `${ top }\n${ body }\n${ bottom }`;
}

function readRecentDaemonLogs( siteId: string, maxLines = 30 ): string | null {
	const processName = `studio-site-${ siteId }`;
	const logPaths = [
		path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-out.log` ),
		path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-error.log` ),
	];

	const sections: string[] = [];
	for ( const logPath of logPaths ) {
		try {
			const content = fs.readFileSync( logPath, 'utf-8' ).trim();
			if ( content ) {
				const lines = content.split( '\n' );
				const tail = lines.slice( -maxLines ).join( '\n' );
				sections.push( `--- ${ path.basename( logPath ) } ---\n${ tail }` );
			}
		} catch {
			// Log file may not exist yet.
		}
	}

	return sections.length > 0 ? sections.join( '\n\n' ) : null;
}

function formatServerStartErrorDetails( siteId: string | undefined, error: unknown ): string {
	const parts: string[] = [];

	if ( error instanceof Error ) {
		parts.push( error.message );

		const cliArgs = ( error as Error & { cliArgs?: Record< string, unknown > } ).cliArgs;
		if ( cliArgs ) {
			parts.push( `\nPlayground CLI args:\n${ JSON.stringify( cliArgs, null, 2 ) }` );
		}
	} else {
		parts.push( String( error ) );
	}

	if ( siteId ) {
		const recentLogs = readRecentDaemonLogs( siteId );
		if ( recentLogs ) {
			parts.push( `\nDaemon process logs:\n${ recentLogs }` );
		}
	}

	return parts.join( '\n' );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseImporterJson( result: ImporterResult ): any {
	const raw = result.stdout.trim();
	const parsedValues: unknown[] = [];
	let index = 0;

	while ( index < raw.length ) {
		while ( /\s/.test( raw[ index ] ?? '' ) ) {
			index++;
		}

		if ( index >= raw.length ) {
			break;
		}

		if ( raw[ index ] !== '{' && raw[ index ] !== '[' ) {
			index++;
			continue;
		}

		let depth = 0;
		let inString = false;
		let isEscaped = false;
		let endIndex = index;

		for ( ; endIndex < raw.length; endIndex++ ) {
			const char = raw[ endIndex ];

			if ( inString ) {
				if ( isEscaped ) {
					isEscaped = false;
					continue;
				}

				if ( char === '\\' ) {
					isEscaped = true;
					continue;
				}

				if ( char === '"' ) {
					inString = false;
				}
				continue;
			}

			if ( char === '"' ) {
				inString = true;
				continue;
			}

			if ( char === '{' || char === '[' ) {
				depth++;
				continue;
			}

			if ( char === '}' || char === ']' ) {
				depth--;
				if ( depth === 0 ) {
					endIndex++;
					break;
				}
			}
		}

		try {
			parsedValues.push( JSON.parse( raw.slice( index, endIndex ) ) );
			index = endIndex;
		} catch {
			index++;
		}
	}

	if ( parsedValues.length > 0 ) {
		return parsedValues.at( -1 );
	}

	throw new LoggerError(
		`reprint.phar did not return valid JSON.\nstdout: ${ raw }\nstderr: ${ result.stderr }`
	);
}

function getStageRank( stage: ImportStage ): number {
	return importStageOrder.indexOf( stage );
}

function hasReachedStage( metadata: ImportMetadata, stage: ImportStage ): boolean {
	return getStageRank( metadata.stage ) >= getStageRank( stage );
}

function reportVerboseCommand( verbose: boolean, command: string, args: string[] = [] ): void {
	if ( ! verbose ) {
		return;
	}

	console.error( `[command] ${ [ command, ...args ].join( ' ' ) }` );
}

function getMetadataPath( technicalSiteDirectory: string ): string {
	return path.join( technicalSiteDirectory, 'import.json' );
}

function getImporterStatePath( stateDirectory: string ): string {
	return path.join( stateDirectory, '.import-state.json' );
}

function getRemoteIndexPath( stateDirectory: string ): string {
	return path.join( stateDirectory, '.import-remote-index.jsonl' );
}

function getLegacyStateDirectory( technicalSiteDirectory: string ): string {
	return path.join( technicalSiteDirectory, 'tmp', 'export', 'state' );
}

function getLegacyRawDirectory( technicalSiteDirectory: string ): string {
	return path.join( technicalSiteDirectory, 'tmp', 'export', 'docroot' );
}

function moveDirectoryContents( sourceDirectory: string, targetDirectory: string ): boolean {
	if ( ! fs.existsSync( sourceDirectory ) ) {
		return false;
	}

	fs.mkdirSync( targetDirectory, { recursive: true } );

	let moved = false;
	for ( const entry of fs.readdirSync( sourceDirectory ) ) {
		const sourcePath = path.join( sourceDirectory, entry );
		const targetPath = path.join( targetDirectory, entry );

		if ( ! fs.existsSync( targetPath ) ) {
			fs.renameSync( sourcePath, targetPath );
			moved = true;
			continue;
		}

		if ( fs.statSync( sourcePath ).isDirectory() && fs.statSync( targetPath ).isDirectory() ) {
			moved = moveDirectoryContents( sourcePath, targetPath ) || moved;
		}
	}

	if ( fs.readdirSync( sourceDirectory ).length === 0 ) {
		fs.rmSync( sourceDirectory, { recursive: true, force: true } );
	}

	return moved;
}

export function migrateLegacyImporterLayout(
	technicalSiteDirectory: string,
	stateDirectory: string,
	rawDirectory: string
): boolean {
	const movedState = moveDirectoryContents(
		getLegacyStateDirectory( technicalSiteDirectory ),
		stateDirectory
	);
	const movedRaw = moveDirectoryContents(
		getLegacyRawDirectory( technicalSiteDirectory ),
		rawDirectory
	);

	return movedState || movedRaw;
}

function saveImportMetadata( metadata: ImportMetadata ): void {
	fs.mkdirSync( metadata.technicalSiteDirectory, { recursive: true } );
	const metadataPath = getMetadataPath( metadata.technicalSiteDirectory );
	const tempPath = `${ metadataPath }.tmp`;
	fs.writeFileSync( tempPath, JSON.stringify( metadata, null, 2 ) + '\n' );
	fs.renameSync( tempPath, metadataPath );
}

function readImportMetadata( metadataPath: string ): ImportMetadata | null {
	try {
		const metadata = JSON.parse( fs.readFileSync( metadataPath, 'utf-8' ) ) as ImportMetadata;
		if ( metadata.version !== IMPORT_METADATA_VERSION ) {
			return null;
		}
		return metadata;
	} catch {
		return null;
	}
}

function readImporterState( stateDirectory: string ): ImporterStateSnapshot | null {
	try {
		return JSON.parse(
			fs.readFileSync( getImporterStatePath( stateDirectory ), 'utf-8' )
		) as ImporterStateSnapshot;
	} catch {
		return null;
	}
}

function updateImporterState(
	stateDirectory: string,
	update: ( state: Record< string, unknown > ) => Record< string, unknown >
): void {
	const statePath = getImporterStatePath( stateDirectory );
	if ( ! fs.existsSync( statePath ) ) {
		return;
	}

	try {
		const currentState = JSON.parse( fs.readFileSync( statePath, 'utf-8' ) ) as Record<
			string,
			unknown
		>;
		const nextState = update( currentState );
		fs.writeFileSync( statePath, JSON.stringify( nextState, null, 2 ) + '\n' );
	} catch {
		// Leave importer state untouched if it cannot be parsed.
	}
}

function decodeImporterStatePath( value: string | null | undefined ): string | null {
	if ( ! value ) {
		return null;
	}

	if ( ! value.startsWith( 'base64:' ) ) {
		return value;
	}

	try {
		return Buffer.from( value.slice( 'base64:'.length ), 'base64' ).toString( 'utf8' );
	} catch {
		return null;
	}
}

function getRequiredRawRootDirectoryNames( stateDirectory: string ): string[] {
	const state = readImporterState( stateDirectory ) as
		| ( ImporterStateSnapshot & Record< string, unknown > )
		| null;
	const preflight = state?.preflight?.data as Record< string, unknown > | undefined;
	const wpDetect = preflight?.wp_detect as Record< string, unknown > | undefined;
	const runtime = preflight?.runtime as Record< string, unknown > | undefined;
	const constantValues = runtime?.constant_values as Record< string, unknown > | undefined;
	const roots = Array.isArray( wpDetect?.roots ) ? wpDetect.roots : [];

	const paths = roots
		.map( ( root ) => {
			if ( ! root || typeof root !== 'object' || Array.isArray( root ) ) {
				return null;
			}

			return decodeImporterStatePath( typeof root.path === 'string' ? root.path : null );
		} )
		.concat(
			[
				constantValues?.ABSPATH,
				constantValues?.WP_CONTENT_DIR,
				constantValues?.WP_PLUGIN_DIR,
				constantValues?.WPMU_PLUGIN_DIR,
				constantValues?.TEMPLATEPATH,
				constantValues?.STYLESHEETPATH,
			].map( ( value ) => ( typeof value === 'string' ? value : null ) )
		)
		.filter( ( value ): value is string => Boolean( value && value.startsWith( '/' ) ) );

	return [ ...new Set( paths.map( ( value ) => value.replace( /^\/+/, '' ).split( '/' )[ 0 ] ) ) ];
}

export function repairBlockingRawImportPaths(
	stateDirectory: string,
	rawDirectory: string
): string[] {
	const repairedPaths: string[] = [];

	for ( const directoryName of getRequiredRawRootDirectoryNames( stateDirectory ) ) {
		const blockedPath = path.join( rawDirectory, directoryName );
		if ( ! fs.existsSync( blockedPath ) ) {
			continue;
		}

		try {
			if ( fs.statSync( blockedPath ).isDirectory() ) {
				continue;
			}
		} catch {
			// Broken symlinks and unreadable paths must be repaired below.
		}

		fs.rmSync( blockedPath, { recursive: true, force: true } );
		repairedPaths.push( blockedPath );
	}

	return repairedPaths;
}

export function buildDbApplyArgs(
	metadata: Pick< ImportMetadata, 'normalizedUrl' | 'remoteSiteUrl' | 'localUrl' | 'sitePath' >
): string[] {
	return [
		'db-apply',
		getApiUrl( metadata.normalizedUrl ),
		'--state-dir=/state',
		'--fs-root=/docroot',
		'--target-engine=sqlite',
		'--target-sqlite-path=/site/wp-content/database/.ht.sqlite',
		`--new-site-url=${ metadata.localUrl! }`,
	];
}

export function shouldRefreshFlattenedSite(
	metadata: Pick< ImportMetadata, 'stateDirectory' | 'rawDirectory' | 'sitePath' >
): boolean {
	const flattenedWpContentDirectory = path.join( metadata.sitePath, 'wp-content' );
	if ( ! fs.existsSync( flattenedWpContentDirectory ) ) {
		return true;
	}

	for ( const directoryName of [ 'themes', 'plugins' ] ) {
		const flattenedDirectory = path.join( flattenedWpContentDirectory, directoryName );
		if ( ! fs.existsSync( flattenedDirectory ) ) {
			return true;
		}

		for ( const entry of fs.readdirSync( flattenedDirectory ) ) {
			const entryPath = path.join( flattenedDirectory, entry );
			let stats;
			try {
				stats = fs.lstatSync( entryPath );
			} catch {
				return true;
			}

			if ( stats.isSymbolicLink() && ! fs.existsSync( entryPath ) ) {
				return true;
			}
		}
	}

	return false;
}

export function shouldRestartFilesSyncIndex( stateDirectory: string ): boolean {
	const state = readImporterState( stateDirectory );
	if ( ! state ) {
		return false;
	}

	if ( state.command !== 'files-sync' || state.status === 'complete' ) {
		return false;
	}

	if ( state.stage !== 'index' || state.cursor !== null ) {
		return false;
	}

	const remoteIndexPath = getRemoteIndexPath( stateDirectory );
	return fs.existsSync( remoteIndexPath ) && fs.statSync( remoteIndexPath ).size > 0;
}

export function normalizeImportUrl( url: string ): string {
	const trimmedUrl = url.trim();
	const normalized = new URL(
		/^[a-z][a-z\d+.-]*:\/\//i.test( trimmedUrl ) ? trimmedUrl : `https://${ trimmedUrl }`
	);
	normalized.hash = '';
	normalized.pathname = normalized.pathname.replace( /\/+$/, '' ) || '/';
	normalized.searchParams.delete( 'site-export-api' );
	return normalized.toString();
}

export function inferSiteNameFromUrl( url: string ): string {
	return new URL( normalizeImportUrl( url ) ).hostname;
}

export function getImportKey( normalizedUrl: string, explicitName?: string ): string {
	return crypto
		.createHash( 'sha256' )
		.update( `${ normalizedUrl }\n${ explicitName || '__auto__' }` )
		.digest( 'hex' )
		.slice( 0, 12 );
}

function readStoredSecret( url: string, explicitName?: string ): string | undefined {
	const normalizedUrl = normalizeImportUrl( url );
	const importKey = getImportKey( normalizedUrl, explicitName );
	const technicalSiteDirectory = path.join( IMPORTS_ROOT, importKey );
	const metadataPath = getMetadataPath( technicalSiteDirectory );
	const metadata = readImportMetadata( metadataPath );
	return metadata?.secret;
}

async function resolveSiteName( normalizedUrl: string, explicitName?: string ): Promise< string > {
	if ( explicitName ) {
		return explicitName;
	}

	const cliConfig = await readCliConfig();
	const baseName = inferSiteNameFromUrl( normalizedUrl );
	return generateNumberedName(
		baseName,
		cliConfig.sites.map( ( site ) => site.name ),
		path.dirname( getDefaultSitePath( baseName ) )
	);
}

export function findMatchingWpComSite(
	sites: WpComSiteInfo[],
	url: string
): WpComSiteInfo | undefined {
	const normalizedUrl = normalizeImportUrl( url );
	const target = new URL( normalizedUrl );

	return sites.find( ( site ) => {
		try {
			const normalizedSiteUrl = normalizeImportUrl( site.url );
			if ( normalizedSiteUrl === normalizedUrl ) {
				return true;
			}

			return new URL( normalizedSiteUrl ).host === target.host;
		} catch {
			return false;
		}
	} );
}

export function formatWpComSitesList(
	sites: WpComSiteInfo[],
	limit = DEFAULT_WPCOM_SITE_LIST_LIMIT
): string {
	const visibleSites = sites.slice( 0, limit );
	const lines = visibleSites.map(
		( site, index ) => `${ index + 1 }. ${ site.name } - ${ site.url }`
	);

	if ( sites.length > visibleSites.length ) {
		lines.push(
			`... and ${
				sites.length - visibleSites.length
			} more. Run \`studio site pull-streaming --list-wpcom-sites\` to see the full list.`
		);
	}

	return lines.join( '\n' );
}

async function loadWpComSites(): Promise< { sites: WpComSiteInfo[]; token: StoredAuthToken } > {
	const token = await readAuthToken();
	if ( ! token ) {
		throw new LoggerError(
			__(
				'WordPress.com authentication is required. Run `studio auth login` to import a connected WordPress.com site, or provide both `--url` and `--secret` for a non-WordPress.com site.'
			)
		);
	}

	try {
		const sites = await getWpComSites( token.accessToken );
		return { token, sites };
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to load WordPress.com sites' ), error );
	}
}

async function rotateWpComSecret( site: WpComSiteInfo, token: StoredAuthToken ): Promise< string > {
	try {
		return await rotateStreamingExportSecret( site.id, token.accessToken );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to rotate the WordPress.com site secret' ), error );
	}
}

async function listWpComSites( limit?: number ): Promise< WpComSiteInfo[] > {
	const { sites } = await loadWpComSites();

	if ( sites.length === 0 ) {
		console.log( __( 'No active WordPress.com sites found.' ) );
		return sites;
	}

	console.log( __( 'Connected WordPress.com sites:' ) );
	console.log( formatWpComSitesList( sites, limit ?? sites.length ) );
	console.log( '' );

	return sites;
}

async function resolveImportSource(
	url?: string,
	providedSecret?: string,
	listWpComSitesOnly = false,
	providedName?: string
): Promise< ResolvedImportSource | null > {
	if ( listWpComSitesOnly ) {
		await listWpComSites();
		return null;
	}

	// When the caller provides an explicit secret, use it directly.
	if ( url && providedSecret ) {
		return { url, secret: providedSecret };
	}

	// When the caller provides a URL, try the stored secret first without
	// loading the full site list or rotating.  The caller will fall back to
	// loading sites and rotating the secret if the preflight fails.
	if ( url ) {
		const storedSecret = readStoredSecret( url, providedName );
		if ( storedSecret ) {
			return { url, secret: storedSecret };
		}
	}

	// Need the full site list: either no URL was given (interactive pick) or
	// no stored secret exists and we need the site ID to rotate one.
	const { token, sites } = await loadWpComSites();

	let resolvedUrl: string;
	let wpComSite: WpComSiteInfo;

	if ( url ) {
		const matched = findMatchingWpComSite( sites, url );
		if ( ! matched ) {
			throw new LoggerError(
				__(
					'No secret was provided, and this URL is not one of your connected WordPress.com sites. Provide `--secret` for a non-WordPress.com site.'
				)
			);
		}
		resolvedUrl = url;
		wpComSite = matched;
	} else {
		if ( sites.length === 0 ) {
			throw new LoggerError(
				__(
					'No active WordPress.com sites found. Provide both `--url` and `--secret` to import a non-WordPress.com site.'
				)
			);
		}

		if ( sites.length > 1 ) {
			console.log( __( 'Connected WordPress.com sites:' ) );
			console.log( formatWpComSitesList( sites ) );
			console.log( '' );
			throw new LoggerError(
				__(
					'Multiple WordPress.com sites are available. Re-run with `--url <site-url>`, or use `--list-wpcom-sites` to see the full list.'
				)
			);
		}

		wpComSite = sites[ 0 ];
		resolvedUrl = wpComSite.url;
		console.log( `${ __( 'Using your only connected WordPress.com site:' ) } ${ resolvedUrl }` );
		console.log( '' );
	}

	return {
		url: resolvedUrl,
		secret: await rotateWpComSecret( wpComSite, token ),
		wpComSite,
		wpComToken: token,
	};
}

export async function resolveImportMetadata(
	url: string,
	explicitName?: string
): Promise< ResolveImportMetadataResult > {
	const normalizedUrl = normalizeImportUrl( url );
	const importKey = getImportKey( normalizedUrl, explicitName );
	const technicalSiteDirectory = path.join( IMPORTS_ROOT, importKey );
	const metadataPath = getMetadataPath( technicalSiteDirectory );
	const existing = readImportMetadata( metadataPath );

	if ( existing ) {
		return { created: false, metadata: existing };
	}

	const siteName = await resolveSiteName( normalizedUrl, explicitName );
	const sitePath = getDefaultSitePath( siteName );
	if ( ( await pathExists( sitePath ) ) && ! ( await isEmptyDir( sitePath ) ) ) {
		throw new LoggerError( __( 'Site directory already exists and is not empty.' ) );
	}
	const metadata: ImportMetadata = {
		version: IMPORT_METADATA_VERSION,
		importKey,
		normalizedUrl,
		siteName,
		sitePath,
		technicalSiteDirectory,
		rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
		stateDirectory: path.join( technicalSiteDirectory, 'state' ),
		runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
		runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
		stage: 'initialized',
	};

	saveImportMetadata( metadata );
	return { created: true, metadata };
}

export function getApiUrl( normalizedUrl: string ): string {
	const apiUrl = new URL( normalizedUrl );
	apiUrl.search = '?site-export-api';
	return apiUrl.toString();
}

export function buildFilesSyncArgs(
	apiUrl: string,
	secret: string,
	extraArgs: string[] = []
): string[] {
	return [
		'files-sync',
		apiUrl,
		`--secret=${ secret }`,
		...extraArgs,
		`--max-exec=${ FILES_SYNC_MAX_EXEC_SECONDS }`,
		'--no-adaptive',
		'--state-dir=/state',
		'--fs-root=/docroot',
	];
}

function setStage( metadata: ImportMetadata, stage: ImportStage ): void {
	metadata.stage = stage;
	saveImportMetadata( metadata );
}

async function ensureFreshSitePath( metadata: ImportMetadata ): Promise< void > {
	if ( hasReachedStage( metadata, 'flattened' ) ) {
		return;
	}

	if ( ( await pathExists( metadata.sitePath ) ) && ! ( await isEmptyDir( metadata.sitePath ) ) ) {
		throw new LoggerError( __( 'Site directory already exists and is not empty.' ) );
	}
}

function getPreflightCachePath( metadata: ImportMetadata ): string {
	return path.join( metadata.stateDirectory, 'preflight.json' );
}

async function runPreflight(
	metadata: ImportMetadata,
	apiUrl: string,
	secret: string,
	verbose = false
): Promise< {
	siteurl?: string;
	wp_version?: string;
	php_version?: string;
	table_prefix?: string;
} > {
	const preflightCachePath = getPreflightCachePath( metadata );

	if ( fs.existsSync( preflightCachePath ) ) {
		return JSON.parse( fs.readFileSync( preflightCachePath, 'utf-8' ) );
	}

	logger.reportStart( LoggerAction.PREFLIGHT, __( 'Initiating the migration…' ) );

	let preflightResult: ImporterResult;
	try {
		preflightResult = await runImporterCommandUntilComplete(
			metadata.stateDirectory,
			metadata.rawDirectory,
			[
				'preflight',
				apiUrl,
				`--secret=${ secret }`,
				'--no-adaptive',
				'--state-dir=/state',
				'--fs-root=/docroot',
			],
			undefined,
			{
				verboseCommands: verbose,
			}
		);
	} catch ( preflightError ) {
		const details =
			preflightError instanceof Error ? preflightError.message : String( preflightError );
		throw new ImportError(
			__( 'Could not connect to the remote site.' ) + '\n\n' + PLUGIN_INSTALL_HINT,
			details
		);
	}

	let envelope;
	try {
		envelope = parseImporterJson( preflightResult );
	} catch {
		throw new ImportError(
			__( 'The remote site did not respond with a recognized format.' ) +
				'\n\n' +
				PLUGIN_INSTALL_HINT,
			`stdout: ${ preflightResult.stdout }\nstderr: ${ preflightResult.stderr }`
		);
	}

	const preflightData = envelope.data ?? envelope;
	if ( ! preflightData.ok ) {
		const errorDetail = preflightData.error || '';
		const isJsonParseError = /^Invalid JSON\b/i.test( errorDetail );
		const userMessage = isJsonParseError
			? __( 'The remote site responded with HTML instead of the expected export API.' )
			: __( 'Remote site preflight check failed.' );

		throw new ImportError(
			userMessage + '\n\n' + PLUGIN_INSTALL_HINT,
			preflightResult.stdout.trim() + '\n' + preflightResult.stderr.trim()
		);
	}

	const preflight = {
		siteurl: preflightData.database?.wp?.siteurl || undefined,
		wp_version: preflightData.database?.wp?.wp_version || undefined,
		php_version: preflightData.php?.version || undefined,
		table_prefix: preflightData.database?.wp?.table_prefix || undefined,
	};

	fs.writeFileSync( preflightCachePath, JSON.stringify( preflight, null, 2 ) + '\n' );
	logger.reportSuccess(
		`Connected – WordPress ${ preflight.wp_version || 'unknown' }, PHP ${
			preflight.php_version || 'unknown'
		}`
	);
	return preflight;
}

function ensureImportDirectories( metadata: ImportMetadata ): void {
	fs.mkdirSync( metadata.rawDirectory, { recursive: true } );
	fs.mkdirSync( metadata.stateDirectory, { recursive: true } );
	fs.mkdirSync( metadata.runtimeDirectory, { recursive: true } );
	fs.mkdirSync( metadata.sitePath, { recursive: true } );
}

async function ensurePort( metadata: ImportMetadata ): Promise< void > {
	if ( metadata.port && metadata.localUrl ) {
		return;
	}

	const cliConfig = await readCliConfig();
	for ( const site of cliConfig.sites ) {
		portFinder.addUnavailablePort( site.port );
	}

	const existingSite = cliConfig.sites.find(
		( site ) =>
			( metadata.siteId && site.id === metadata.siteId ) ||
			arePathsEqual( site.path, metadata.sitePath ) ||
			site.technicalSiteDirectory === metadata.technicalSiteDirectory
	);

	const port = existingSite?.port ?? ( await portFinder.getOpenPort() );
	metadata.port = port;
	metadata.localUrl = existingSite ? getSiteUrl( existingSite ) : `http://localhost:${ port }`;
	saveImportMetadata( metadata );
}

function hasSkippedFiles( metadata: ImportMetadata ): boolean {
	const skippedListPath = path.join( metadata.stateDirectory, SKIPPED_DOWNLOAD_LIST );
	return fs.existsSync( skippedListPath ) && fs.statSync( skippedListPath ).size > 0;
}

export function prepareSkippedEarlierState( metadata: ImportMetadata ): void {
	if ( ! hasSkippedFiles( metadata ) ) {
		return;
	}

	updateImporterState( metadata.stateDirectory, ( state ) => ( {
		...state,
		command: 'files-sync',
		status: 'complete',
		stage: null,
		filter: 'essential-files',
	} ) );
}

function resetEssentialFilesRepairState( stateDirectory: string ): void {
	const existingState = readImporterState( stateDirectory ) as Record< string, unknown > | null;
	const preflight = existingState?.preflight;

	for ( const fileName of [
		'.import-index.jsonl',
		'.import-remote-index.jsonl',
		'.import-download-list.jsonl',
		'.import-download-list-skipped.jsonl',
		'.import-status.json',
	] ) {
		fs.rmSync( path.join( stateDirectory, fileName ), { force: true } );
	}

	const statePath = getImporterStatePath( stateDirectory );
	if ( preflight ) {
		fs.writeFileSync( statePath, JSON.stringify( { preflight }, null, 2 ) + '\n' );
	} else {
		fs.rmSync( statePath, { force: true } );
	}
}

function getDownloadedSqlDumpPath( metadata: ImportMetadata ): string {
	return path.join( metadata.stateDirectory, 'db.sql' );
}

function querySqliteValue( dbPath: string, sql: string ): string | null {
	const result = spawnSync( 'sqlite3', [ dbPath, sql ] );
	if ( result.status !== 0 ) {
		return null;
	}

	return result.stdout.toString().trim();
}

function normalizeComparableUrl( value: string ): string {
	return value.trim().replace( /\/+$/, '' );
}

function isFreshWordPressInstallDatabase( dbPath: string, tablePrefix: string ): boolean {
	if ( ! fs.existsSync( dbPath ) ) {
		return false;
	}

	const blogname = querySqliteValue(
		dbPath,
		`SELECT option_value FROM ${ tablePrefix }options WHERE option_name = 'blogname';`
	);
	if ( blogname !== 'My WordPress Website' ) {
		return false;
	}

	const posts = querySqliteValue(
		dbPath,
		`SELECT post_title || '|' || post_status || '|' || post_type FROM ${ tablePrefix }posts ORDER BY ID LIMIT 5;`
	);

	return (
		posts?.includes( 'Hello world!|publish|post' ) === true &&
		posts.includes( 'Sample Page|publish|page' )
	);
}

function needsLocalUrlRewrite(
	dbPath: string,
	tablePrefix: string,
	localUrl: string | undefined
): boolean {
	if ( ! localUrl || ! fs.existsSync( dbPath ) ) {
		return false;
	}

	const expectedLocalUrl = normalizeComparableUrl( localUrl );
	for ( const optionName of [ 'home', 'siteurl' ] ) {
		const optionValue = querySqliteValue(
			dbPath,
			`SELECT option_value FROM ${ tablePrefix }options WHERE option_name = '${ optionName }';`
		);
		if ( optionValue && normalizeComparableUrl( optionValue ) !== expectedLocalUrl ) {
			return true;
		}
	}

	return false;
}

function removeImportedSqliteDatabase( sitePath: string ): void {
	const databaseDirectory = path.join( sitePath, 'wp-content', 'database' );
	fs.rmSync( path.join( databaseDirectory, '.ht.sqlite' ), { force: true } );
	fs.rmSync( path.join( databaseDirectory, '.ht.sqlite.php' ), { force: true } );
}

/**
 * Detects post-completion damage to a finished import and rolls back to an
 * earlier stage so the next run can recover.
 *
 * This runs at the start of every `pull-streaming` invocation.  When an
 * import has already reached the 'completed' stage, Studio checks that the
 * critical artifacts are still intact.  If any are missing or corrupt, the
 * stage is rewound to the latest point where the pipeline can pick up again.
 *
 * The checks, in order:
 *
 *  1. Runtime blueprint missing — the blueprint.json that tells Playground
 *     how to start the imported site.  It lives in a persistent directory
 *     so this only happens if the user (or another tool) deletes it.
 *
 *  2. SQLite database missing — the imported .ht.sqlite was deleted.
 *     WordPress Playground will happily create a fresh one on next start,
 *     which leads to check 3.
 *
 *  3. Fresh WordPress install detected — Playground replaced the imported
 *     database with a blank install (blogname "My WordPress Website",
 *     "Hello world!" post).  This happens when Playground starts a site
 *     whose .ht.sqlite was deleted or corrupted: it creates a fresh
 *     database to bootstrap WordPress.  We detect this and re-apply the
 *     imported database from the downloaded SQL dump.
 *
 *  4. URL rewrite stale — the database still contains the remote site URL
 *     instead of the local Studio URL.  reprint's `db-apply` handles this
 *     during the normal flow, but the local URL isn't finalized until the
 *     site is registered (a later stage), so a crash between those stages
 *     can leave the URL unwritten.  Re-applying the database fixes it.
 *
 *  5. Flattened site structure broken — wp-content/themes or
 *     wp-content/plugins is missing, or contains broken symlinks.
 *     reprint's `flat-document-root` creates symlinks from the site
 *     directory into the raw download tree.  If raw files are cleaned up
 *     or moved, those symlinks break.  We roll all the way back to
 *     re-download and re-flatten.
 */
export function repairCompletedImportState( metadata: ImportMetadata ): string | null {
	if ( metadata.stage !== 'completed' ) {
		return null;
	}

	if ( ! fs.existsSync( metadata.runtimeBlueprintPath ) ) {
		metadata.stage = 'db-applied';
		saveImportMetadata( metadata );
		return 'Runtime configuration is missing. Resuming from runtime generation.';
	}

	const sqlitePath = normalizeImportedSqliteDatabasePath( metadata.sitePath );
	if ( ! fs.existsSync( sqlitePath ) ) {
		if ( fs.existsSync( getDownloadedSqlDumpPath( metadata ) ) ) {
			metadata.stage = 'db-downloaded';
			saveImportMetadata( metadata );
			return 'Imported database is missing. Resuming from database apply.';
		}

		metadata.stage = 'flattened';
		saveImportMetadata( metadata );
		return 'Imported database is missing. Resuming from database download.';
	}

	const tablePrefix = metadata.tablePrefix || 'wp_';
	if ( isFreshWordPressInstallDatabase( sqlitePath, tablePrefix ) ) {
		removeImportedSqliteDatabase( metadata.sitePath );
		metadata.stage = fs.existsSync( getDownloadedSqlDumpPath( metadata ) )
			? 'db-downloaded'
			: 'flattened';
		saveImportMetadata( metadata );
		return 'Detected a fresh local WordPress database instead of the imported database. Reapplying the imported database.';
	}

	if ( needsLocalUrlRewrite( sqlitePath, tablePrefix, metadata.localUrl ) ) {
		removeImportedSqliteDatabase( metadata.sitePath );
		metadata.stage = 'db-downloaded';
		saveImportMetadata( metadata );
		return 'Imported database still references the remote site URL. Reapplying the imported database with the local Studio URL.';
	}

	const repairedRawPaths = repairBlockingRawImportPaths(
		metadata.stateDirectory,
		metadata.rawDirectory
	);
	if ( repairedRawPaths.length > 0 || shouldRefreshFlattenedSite( metadata ) ) {
		resetEssentialFilesRepairState( metadata.stateDirectory );
		metadata.stage = 'initialized';
		saveImportMetadata( metadata );
		return repairedRawPaths.length > 0
			? 'Imported file layout is incomplete. Re-downloading site files and rebuilding the flattened site structure.'
			: 'Flattened site structure is incomplete. Rebuilding the flattened site from the importer output.';
	}

	return null;
}

async function rebuildFlattenedSiteDirectory( metadata: ImportMetadata ): Promise< void > {
	const site = await findExistingSite( metadata );
	if ( site?.id ) {
		try {
			await connectToDaemon();
			if ( await isServerRunning( site.id ) ) {
				await stopWordPressServer( site.id );
			}
		} finally {
			await disconnectFromDaemon();
		}
	}

	fs.rmSync( metadata.sitePath, { recursive: true, force: true } );
	fs.mkdirSync( metadata.sitePath, { recursive: true } );
}

async function refreshFlattenedSiteDirectory(
	metadata: Pick<
		ImportMetadata,
		'stateDirectory' | 'rawDirectory' | 'sitePath' | 'runtimeBlueprintPath' | 'normalizedUrl'
	>,
	verbose: boolean
): Promise< void > {
	await runImporterCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		[
			'flat-document-root',
			getApiUrl( metadata.normalizedUrl ),
			'--no-adaptive',
			'--state-dir=/state',
			'--fs-root=/docroot',
			'--flatten-to=/flat',
		],
		undefined,
		{
			mounts: [ { hostPath: metadata.sitePath, vfsPath: '/flat' } ],
			verboseCommands: verbose,
		}
	);
}

async function findExistingSite( metadata: ImportMetadata ): Promise< SiteData | undefined > {
	const cliConfig = await readCliConfig();
	return cliConfig.sites.find(
		( site ) =>
			( metadata.siteId && site.id === metadata.siteId ) ||
			arePathsEqual( site.path, metadata.sitePath ) ||
			site.technicalSiteDirectory === metadata.technicalSiteDirectory
	);
}

async function syncMetadataWithExistingSite(
	metadata: ImportMetadata
): Promise< SiteData | undefined > {
	const site = await findExistingSite( metadata );
	if ( ! site ) {
		return undefined;
	}

	let changed = false;
	if ( metadata.siteId !== site.id ) {
		metadata.siteId = site.id;
		changed = true;
	}
	if ( metadata.port !== site.port ) {
		metadata.port = site.port;
		changed = true;
	}
	const localUrl = getSiteUrl( site );
	if ( metadata.localUrl !== localUrl ) {
		metadata.localUrl = localUrl;
		changed = true;
	}
	if ( ! hasReachedStage( metadata, 'site-registered' ) ) {
		metadata.stage = 'site-registered';
		changed = true;
	}
	if ( changed ) {
		saveImportMetadata( metadata );
	}

	return site;
}

function getAutoLoginUrl( localUrl: string, redirectTo?: string ): string {
	const base = `${ localUrl }/studio-auto-login`;
	if ( ! redirectTo ) {
		return base;
	}
	return `${ base }?redirect_to=${ encodeURIComponent( redirectTo ) }`;
}

function printReadyMessage( metadata: ImportMetadata ): void {
	if ( ! metadata.localUrl ) {
		return;
	}

	console.log( '' );
	console.log( `Site "${ metadata.siteName }" is ready.` );
	console.log( '' );
	console.log( __( 'Site URL: ' ), getAutoLoginUrl( metadata.localUrl ) );
	console.log( __( 'WP Admin: ' ), getAutoLoginUrl( metadata.localUrl, '/wp-admin/' ) );
	console.log( '' );
}

function printCompletionMessage( metadata: ImportMetadata ): void {
	console.log( '' );
	console.log( `Site "${ metadata.siteName }" imported successfully.` );
	console.log( '' );
	if ( metadata.localUrl ) {
		console.log( __( 'Site URL: ' ), getAutoLoginUrl( metadata.localUrl ) );
		console.log( __( 'WP Admin: ' ), getAutoLoginUrl( metadata.localUrl, '/wp-admin/' ) );
		console.log( '' );
	}
}

function printResumeMessage( url: string, providedName?: string, requiresSecret = false ): void {
	const command = [ 'studio site pull-streaming', `--url ${ url }` ];
	if ( requiresSecret ) {
		command.push( '--secret <secret>' );
	}
	if ( providedName ) {
		command.push( `--name "${ providedName }"` );
	}

	console.log( '' );
	console.log( 'To resume this import, re-run the same command:' );
	console.log( `  ${ command.join( ' ' ) }` );
	console.log( '' );
}

async function trashImportPaths( paths: string[], verbose = false ): Promise< void > {
	const deleteTargets = paths
		.filter( ( value ): value is string => Boolean( value ) )
		.filter(
			( value, index, values ) =>
				values.findIndex( ( other ) => arePathsEqual( other, value ) ) === index
		)
		.filter( ( value ) => fs.existsSync( value ) );

	if ( deleteTargets.length === 0 ) {
		return;
	}

	reportVerboseCommand( verbose, 'trash', deleteTargets );
	const trash = ( await import( 'trash' ) ).default;
	await trash( deleteTargets );
}

async function abortImport(
	url: string | undefined,
	providedName?: string,
	verbose = false
): Promise< void > {
	if ( ! url ) {
		throw new LoggerError(
			__( 'Provide `--url` to abort an import and clean up its local state.' )
		);
	}

	const normalizedUrl = normalizeImportUrl( url );
	const importKey = getImportKey( normalizedUrl, providedName );
	const technicalSiteDirectory = path.join( IMPORTS_ROOT, importKey );
	const metadata = readImportMetadata( getMetadataPath( technicalSiteDirectory ) );

	if ( ! metadata ) {
		throw new LoggerError(
			__( 'No matching import state was found for that URL. Nothing to abort.' )
		);
	}

	migrateLegacyImporterLayout(
		metadata.technicalSiteDirectory,
		metadata.stateDirectory,
		metadata.rawDirectory
	);

	logger.reportStart(
		LoggerAction.ABORT_IMPORT,
		__( 'Aborting import and cleaning up local files…' )
	);

	const existingSite = await findExistingSite( metadata );
	if ( existingSite ) {
		reportVerboseCommand( verbose, 'studio', [
			'site',
			'delete',
			'--path',
			existingSite.path,
			'--files',
		] );
		const { runCommand: deleteSiteCommand } = await import( 'cli/commands/site/delete' );
		await deleteSiteCommand( existingSite.path, true );
		logger.reportSuccess( __( 'Import aborted and local files removed' ) );
		return;
	}

	await trashImportPaths( [ metadata.sitePath, metadata.technicalSiteDirectory ], verbose );
	logger.reportSuccess( __( 'Import aborted and local files removed' ) );
}

async function restartUnresumableFilesSync(
	metadata: ImportMetadata,
	apiUrl: string,
	secret: string,
	verbose = false
): Promise< void > {
	if ( ! shouldRestartFilesSyncIndex( metadata.stateDirectory ) ) {
		return;
	}

	logger.reportWarning(
		__(
			'Restarting remote file indexing before resume because the previous run did not save a resumable cursor.'
		)
	);
	await runImporterCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		buildFilesSyncArgs( apiUrl, secret, [ '--abort' ] ),
		undefined,
		{
			verboseCommands: verbose,
		}
	);
	logger.reportSuccess( __( 'Interrupted file indexing state cleared' ) );
}

async function registerSite(
	metadata: ImportMetadata
): Promise< { created: boolean; site: SiteData } > {
	const existingSite = await syncMetadataWithExistingSite( metadata );
	if ( existingSite ) {
		return { created: false, site: existingSite };
	}

	await ensurePort( metadata );

	const siteId = metadata.siteId || crypto.randomUUID();
	const siteDetails: SiteData = {
		id: siteId,
		name: metadata.siteName,
		path: metadata.sitePath,
		port: metadata.port!,
		phpVersion: DEFAULT_PHP_VERSION,
		running: false,
		isWpAutoUpdating: true,
		enableHttps: false,
		technicalSiteDirectory: metadata.technicalSiteDirectory,
		runtimeBlueprintPath: metadata.runtimeBlueprintPath,
	};

	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const existingByPath = cliConfig.sites.find(
			( site ) =>
				arePathsEqual( site.path, metadata.sitePath ) ||
				site.technicalSiteDirectory === metadata.technicalSiteDirectory
		);

		if ( existingByPath ) {
			metadata.siteId = existingByPath.id;
			metadata.port = existingByPath.port;
			metadata.localUrl = getSiteUrl( existingByPath );
			saveImportMetadata( metadata );
			return { created: false, site: existingByPath };
		}

		cliConfig.sites.push( siteDetails );
		sortSites( cliConfig.sites );
		await saveCliConfig( cliConfig );
	} finally {
		await unlockCliConfig();
	}

	metadata.siteId = siteId;
	saveImportMetadata( metadata );
	return { created: true, site: siteDetails };
}

export async function runCommand(
	url?: string,
	providedSecret?: string,
	providedName?: string,
	listWpComSitesOnly = false,
	verbose = false,
	abort = false
): Promise< void > {
	if ( abort ) {
		if ( listWpComSitesOnly ) {
			throw new LoggerError( __( '`--abort` cannot be combined with `--list-wpcom-sites`.' ) );
		}

		await abortImport( url, providedName, verbose );
		return;
	}

	const resolvedSource = await resolveImportSource(
		url,
		providedSecret,
		listWpComSitesOnly,
		providedName
	);
	if ( ! resolvedSource ) {
		return;
	}

	const { url: resolvedUrl } = resolvedSource;
	let secret = resolvedSource.secret;
	const { created, metadata } = await resolveImportMetadata( resolvedUrl, providedName );
	const apiUrl = getApiUrl( metadata.normalizedUrl );

	if (
		migrateLegacyImporterLayout(
			metadata.technicalSiteDirectory,
			metadata.stateDirectory,
			metadata.rawDirectory
		)
	) {
		logger.reportWarning(
			__( 'Recovered importer state from an older Studio runtime layout before continuing.' )
		);
	}

	await ensureFreshSitePath( metadata );
	ensureImportDirectories( metadata );

	const repairedCompletedImportMessage = repairCompletedImportState( metadata );
	if ( repairedCompletedImportMessage ) {
		logger.reportWarning( __( repairedCompletedImportMessage ) );
		if ( metadata.stage === 'initialized' ) {
			await rebuildFlattenedSiteDirectory( metadata );
		}
	}

	if ( metadata.stage === 'completed' ) {
		if ( shouldRefreshFlattenedSite( metadata ) ) {
			logger.reportStart( LoggerAction.CREATE_SITE, __( 'Refreshing site directory…' ) );
			await rebuildFlattenedSiteDirectory( metadata );
			await refreshFlattenedSiteDirectory( metadata, verbose );
			logger.reportSuccess( __( 'Site directory refreshed' ) );
		}
		await syncMetadataWithExistingSite( metadata );
		printCompletionMessage( metadata );
		return;
	}

	const isResume = ! created || fs.readdirSync( metadata.stateDirectory ).length > 0;
	if ( isResume ) {
		console.log( `Resuming previous import for ${ metadata.normalizedUrl }` );
		console.log( '' );
	}

	console.log( `Importing "${ metadata.siteName }" from ${ metadata.normalizedUrl }` );
	console.log( `Technical directory: ${ metadata.technicalSiteDirectory }` );
	console.log( `Site directory: ${ metadata.sitePath }` );
	console.log( '' );

	try {
		let preflight;
		try {
			preflight = await runPreflight( metadata, apiUrl, secret, verbose );
		} catch ( preflightError ) {
			// The stored secret may have expired.  Resolve the WP.com site
			// (loading the site list only now, if we haven't already) and
			// rotate the secret before retrying the preflight.
			if ( resolvedSource.wpComSite && resolvedSource.wpComToken ) {
				secret = await rotateWpComSecret( resolvedSource.wpComSite, resolvedSource.wpComToken );
			} else {
				let token: StoredAuthToken | null;
				try {
					token = await readAuthToken();
				} catch {
					token = null;
				}
				if ( ! token ) {
					throw preflightError;
				}
				const sites = await getWpComSites( token.accessToken );
				const matched = findMatchingWpComSite( sites, resolvedUrl );
				if ( ! matched ) {
					throw preflightError;
				}
				resolvedSource.wpComSite = matched;
				resolvedSource.wpComToken = token;
				secret = await rotateWpComSecret( matched, token );
			}
			preflight = await runPreflight( metadata, apiUrl, secret, verbose );
		}
		metadata.remoteSiteUrl = preflight.siteurl || metadata.normalizedUrl;
		metadata.tablePrefix = preflight.table_prefix || undefined;
		metadata.secret = secret;
		saveImportMetadata( metadata );

		const repairedRawPaths = repairBlockingRawImportPaths(
			metadata.stateDirectory,
			metadata.rawDirectory
		);
		if ( repairedRawPaths.length > 0 && hasReachedStage( metadata, 'essential-files-complete' ) ) {
			logger.reportWarning(
				__(
					'Recovered a broken importer filesystem layout. Re-downloading site files and rebuilding the flattened site.'
				)
			);
			resetEssentialFilesRepairState( metadata.stateDirectory );
			metadata.stage = 'initialized';
			saveImportMetadata( metadata );
			await rebuildFlattenedSiteDirectory( metadata );
		}

		const importerState = readImporterState( metadata.stateDirectory );
		if (
			! importerState?.command &&
			hasReachedStage( metadata, 'essential-files-complete' ) &&
			shouldRefreshFlattenedSite( metadata )
		) {
			logger.reportWarning(
				__( 'Rebuilding sute files because the importer state was reset during a previous repair.' )
			);
			metadata.stage = 'initialized';
			saveImportMetadata( metadata );
			await rebuildFlattenedSiteDirectory( metadata );
		}

		if ( ! hasReachedStage( metadata, 'essential-files-complete' ) ) {
			await restartUnresumableFilesSync( metadata, apiUrl, secret, verbose );
			logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Downloading site files…' ) );
			await runImporterCommandUntilComplete(
				metadata.stateDirectory,
				metadata.rawDirectory,
				buildFilesSyncArgs( apiUrl, secret, [ '--filter=essential-files', '--follow-symlinks' ] ),
				( progress ) => logger.reportProgress( progress ),
				{
					progressLabel: 'Downloading files',
					verboseCommands: verbose,
				}
			);
			logger.reportSuccess( __( 'Files downloaded' ) );

			setStage( metadata, 'essential-files-complete' );
		}

		if ( ! hasReachedStage( metadata, 'flattened' ) ) {
			logger.reportStart( LoggerAction.CREATE_SITE, __( 'Preparing site directory…' ) );
			await refreshFlattenedSiteDirectory( metadata, verbose );
			logger.reportSuccess( __( 'Site directory prepared' ) );
			setStage( metadata, 'flattened' );
		}

		if ( ! hasReachedStage( metadata, 'db-downloaded' ) ) {
			logger.reportStart( LoggerAction.DOWNLOAD_SQL, __( 'Downloading database…' ) );
			await runImporterCommandUntilComplete(
				metadata.stateDirectory,
				metadata.rawDirectory,
				[
					'db-sync',
					apiUrl,
					`--secret=${ secret }`,
					'--sql-output=file',
					'--no-adaptive',
					'--state-dir=/state',
					'--fs-root=/docroot',
				],
				( progress ) => logger.reportProgress( progress ),
				{
					progressLabel: __( 'Downloading database' ),
					verboseCommands: verbose,
				}
			);
			logger.reportSuccess( __( 'Database downloaded' ) );
			setStage( metadata, 'db-downloaded' );
		}

		await ensurePort( metadata );

		if ( ! hasReachedStage( metadata, 'db-applied' ) ) {
			logger.reportStart( LoggerAction.IMPORT_SQL, __( 'Applying database…' ) );
			await runImporterCommandUntilComplete(
				metadata.stateDirectory,
				metadata.rawDirectory,
				[ ...buildDbApplyArgs( metadata ), `--secret=${ secret }`, '--no-adaptive' ],
				( progress ) => logger.reportProgress( progress ),
				{
					progressLabel: __( 'Applying database' ),
					mounts: [ { hostPath: metadata.sitePath, vfsPath: '/site' } ],
					verboseCommands: verbose,
				}
			);
			logger.reportSuccess( __( 'Database imported' ) );
			setStage( metadata, 'db-applied' );
		}

		if ( ! hasReachedStage( metadata, 'runtime-generated' ) ) {
			logger.reportStart( LoggerAction.URL_REWRITE, __( 'Generating runtime configuration…' ) );
			await runImporterCommandUntilComplete(
				metadata.stateDirectory,
				metadata.rawDirectory,
				[
					'apply-runtime',
					'--no-adaptive',
					'--state-dir=/state',
					'--flat-document-root=/flat',
					'--output-dir=/output',
					'--runtime=playground-cli',
				],
				undefined,
				{
					mounts: [
						{ hostPath: metadata.sitePath, vfsPath: '/flat' },
						{ hostPath: metadata.runtimeDirectory, vfsPath: '/output' },
					],
					verboseCommands: verbose,
				}
			);
			logger.reportSuccess( __( 'Runtime configuration generated' ) );
			setStage( metadata, 'runtime-generated' );
		}

		let createdSiteRecord = false;
		if ( ! hasReachedStage( metadata, 'site-registered' ) ) {
			logger.reportStart( LoggerAction.CREATE_SITE, `Creating site "${ metadata.siteName }"…` );
			const result = await registerSite( metadata );
			createdSiteRecord = result.created;
			logger.reportSuccess( `Site "${ metadata.siteName }" created` );
			setStage( metadata, 'site-registered' );
			logger.reportKeyValuePair( 'id', result.site.id );

			if ( createdSiteRecord ) {
				await emitCliEvent( { event: SITE_EVENTS.CREATED, data: { siteId: result.site.id } } );
			}
		}

		const site = ( await syncMetadataWithExistingSite( metadata ) )!;
		if ( ! hasReachedStage( metadata, 'site-started' ) ) {
			const runtimeStartOptions = await loadImportedRuntimeStartOptions(
				metadata.runtimeBlueprintPath
			);

			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );

			try {
				await connectToDaemon();
				const processDesc = await startWordPressServer( site, logger, runtimeStartOptions );
				logger.reportSuccess( __( 'WordPress server started' ) );

				if ( processDesc.status === 'online' ) {
					await updateSiteLatestCliPid( site.id, processDesc.pid );
				}
				await updateSiteAutoStart( site.id, true );
				metadata.localUrl = getSiteUrl( site );
				saveImportMetadata( metadata );
				setStage( metadata, 'site-started' );
			} catch ( serverError ) {
				const details = formatServerStartErrorDetails( site.id, serverError );
				throw new ImportError(
					__( 'Failed to start the WordPress server for the imported site.' ),
					details
				);
			} finally {
				await disconnectFromDaemon();
			}
		}

		printReadyMessage( metadata );

		if ( ! hasReachedStage( metadata, 'completed' ) ) {
			if ( hasSkippedFiles( metadata ) ) {
				// Only prepare the state for skipped-earlier if the importer
				// isn't already mid-way through a skipped-earlier run.  When
				// it is (status=partial, stage=fetch-skipped), the state file
				// already encodes the resumption point and overwriting it
				// would break the importer's validation.
				const importerState = readImporterState( metadata.stateDirectory );
				const isResumingSkipped =
					importerState?.stage === 'fetch-skipped' && importerState?.status !== 'complete';

				if ( ! isResumingSkipped ) {
					prepareSkippedEarlierState( metadata );
				}

				logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Downloading remaining files…' ) );
				await runImporterCommandUntilComplete(
					metadata.stateDirectory,
					metadata.rawDirectory,
					buildFilesSyncArgs( apiUrl, secret, [
						...( isResumingSkipped ? [] : [ '--filter=skipped-earlier' ] ),
					] ),
					( progress ) => logger.reportProgress( progress ),
					{
						progressLabel: __( 'Remaining files' ),
						verboseCommands: verbose,
					}
				);
				logger.reportSuccess( __( 'Remaining files downloaded' ) );
			}

			setStage( metadata, 'completed' );
		}

		printCompletionMessage( metadata );
	} catch ( error ) {
		printResumeMessage( metadata.normalizedUrl, providedName, Boolean( providedSecret ) );
		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to import site' ), error );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull-streaming',
		describe: __( 'Pull a remote WordPress site using the streaming importer' ),
		builder: ( builderYargs ) => {
			return builderYargs
				.option( 'url', {
					type: 'string',
					describe: __( 'URL of the remote WordPress site' ),
				} )
				.option( 'secret', {
					type: 'string',
					describe: __( 'Shared HMAC secret configured in the migration plugin' ),
				} )
				.option( 'name', {
					type: 'string',
					describe: __( 'Local site name' ),
				} )
				.option( 'list-wpcom-sites', {
					type: 'boolean',
					describe: __( 'List connected WordPress.com sites and exit' ),
					default: false,
				} )
				.option( 'abort', {
					type: 'boolean',
					describe: __( 'Abort a matching import and remove its local files' ),
					default: false,
				} )
				.option( 'verbose', {
					type: 'boolean',
					describe: __( 'Show detailed error information and executed commands' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			const verbose = argv.verbose as boolean;

			try {
				await runCommand(
					argv.url as string | undefined,
					argv.secret as string | undefined,
					argv.name as string | undefined,
					argv.listWpcomSites as boolean,
					verbose,
					argv.abort as boolean
				);
			} catch ( error ) {
				if ( error instanceof ImportError ) {
					logger.spinner.fail( __( 'Import failed' ) );
					console.error( '\n' + redBox( error.message ) );
					if ( verbose && error.technicalDetails ) {
						console.error( '\n' + chalk.dim( error.technicalDetails ) );
					} else if ( error.technicalDetails ) {
						console.error( chalk.dim( '\nRun with --verbose for detailed error output.' ) );
					}
				} else if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to import site' ), error ) );
				}
			}
		},
	} );
};
