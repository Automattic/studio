import fs from 'fs';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { __, sprintf } from '@wordpress/i18n';
import chalk from 'chalk';
import semver from 'semver';

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 5000;
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/wp-studio/latest';
const CHANGELOG_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/changelog/';
const CACHE_FILE_NAME = 'cli-update-check.json';

interface UpdateCheckCache {
	lastChecked: number;
	latestVersion: string;
}

function getCacheFilePath(): string {
	return path.join( getConfigDirectory(), CACHE_FILE_NAME );
}

function readCache(): UpdateCheckCache | null {
	try {
		const content = fs.readFileSync( getCacheFilePath(), 'utf8' );
		const data = JSON.parse( content );
		if ( typeof data.lastChecked === 'number' && typeof data.latestVersion === 'string' ) {
			return data as UpdateCheckCache;
		}
	} catch {
		// Cache doesn't exist or is invalid
	}
	return null;
}

function writeCache( cache: UpdateCheckCache ): void {
	try {
		const configDir = getConfigDirectory();
		if ( ! fs.existsSync( configDir ) ) {
			fs.mkdirSync( configDir, { recursive: true } );
		}
		fs.writeFileSync( getCacheFilePath(), JSON.stringify( cache ), 'utf8' );
	} catch {
		// Non-critical, ignore write failures
	}
}

async function fetchLatestVersion(): Promise< string | null > {
	try {
		const controller = new AbortController();
		const timeout = setTimeout( () => controller.abort(), FETCH_TIMEOUT_MS );

		const response = await fetch( NPM_REGISTRY_URL, {
			signal: controller.signal,
			headers: { Accept: 'application/json' },
		} );
		clearTimeout( timeout );

		if ( ! response.ok ) {
			return null;
		}

		const data = ( await response.json() ) as { version?: string };
		return typeof data.version === 'string' ? data.version : null;
	} catch {
		return null;
	}
}

function hasJsonFlag(): boolean {
	return process.argv.includes( '--json' );
}

/**
 * Checks for available updates and displays a banner at the top of output.
 *
 * Reads from a local cache file synchronously so the banner prints immediately,
 * before any command output. A background fetch refreshes the cache for the next
 * invocation when it is stale or missing (same pattern as npm's update-notifier).
 *
 * The banner is suppressed in IPC mode or when --json flag is used.
 */
export function setupUpdateNotifier( currentVersion: string ): void {
	if ( Boolean( process.send ) || hasJsonFlag() ) {
		return;
	}

	const cache = readCache();
	const now = Date.now();

	// Start a background fetch if cache is stale or missing
	if ( ! cache || now - cache.lastChecked >= UPDATE_CHECK_INTERVAL_MS ) {
		// Fire and forget -- the result will be cached for the next invocation
		void fetchLatestVersion().then( ( version ) => {
			if ( version ) {
				writeCache( { lastChecked: now, latestVersion: version } );
			}
		} );
	}

	// Show the banner immediately from cache (before any command output).
	// On the first run the cache won't exist yet, so the banner won't show
	// until the next invocation.
	if (
		cache &&
		semver.valid( cache.latestVersion ) &&
		semver.valid( currentVersion ) &&
		semver.gt( cache.latestVersion, currentVersion )
	) {
		process.stderr.write( formatUpdateBanner( currentVersion, cache.latestVersion ) );
	}
}

export function formatUpdateBanner( currentVersion: string, latestVersion: string ): string {
	const updateLine = sprintf(
		/* translators: 1: current version, 2: latest version */
		__( 'Update available: %1$s → %2$s' ),
		chalk.dim( currentVersion ),
		chalk.green( latestVersion )
	);
	const commandLine = sprintf(
		/* translators: %s is the npm command to run */
		__( 'Run %s to update' ),
		chalk.cyan( 'npm update -g wp-studio' )
	);
	const changelogLine = sprintf(
		/* translators: %s is the changelog URL */
		__( 'Changelog: %s' ),
		chalk.cyan( CHANGELOG_URL )
	);

	const lines = [ '', updateLine, commandLine, '', changelogLine, '' ];

	// Calculate box width based on longest line (strip ANSI for measurement)
	// eslint-disable-next-line no-control-regex
	const ansiPattern = new RegExp( '\u001B\\[[0-9;]*m', 'g' );
	const stripAnsi = ( str: string ) => str.replace( ansiPattern, '' );
	const maxLen = Math.max( ...lines.map( ( l ) => stripAnsi( l ).length ) );
	const padding = 2;
	const innerWidth = maxLen + padding * 2;

	const top = chalk.yellow( `╭${ '─'.repeat( innerWidth ) }╮` );
	const bottom = chalk.yellow( `╰${ '─'.repeat( innerWidth ) }╯` );
	const side = chalk.yellow( '│' );

	const paddedLines = lines.map( ( line ) => {
		const visibleLen = stripAnsi( line ).length;
		const rightPad = innerWidth - padding - visibleLen;
		return `${ side }${ ' '.repeat( padding ) }${ line }${ ' '.repeat( rightPad ) }${ side }`;
	} );

	return [ '', top, ...paddedLines, bottom, '' ].join( '\n' );
}
