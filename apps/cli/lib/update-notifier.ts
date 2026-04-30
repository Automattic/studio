import fs from 'fs';
import chalk from '@studio/common/lib/chalk';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { __, sprintf } from '@wordpress/i18n';
import semver from 'semver';
import { z } from 'zod';
import { updateCheckSchema, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/wp-studio/latest';
const CHANGELOG_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/changelog/';

type UpdateCheck = z.infer< typeof updateCheckSchema >;

const npmRegistryResponseSchema = z.object( {
	version: z.string(),
} );

/**
 * Reads the updateCheck field from cli.json synchronously.
 * Uses a direct fs.readFileSync + zod parse to avoid the async readCliConfig path,
 * so the banner can be printed before any command output.
 */
function readUpdateCheck(): UpdateCheck | null {
	try {
		const content = fs.readFileSync( getCliConfigPath(), 'utf8' );
		const data = JSON.parse( content );
		return updateCheckSchema.parse( data?.updateCheck );
	} catch {
		// File doesn't exist, field missing, or invalid
	}
	return null;
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

		const data = npmRegistryResponseSchema.parse( await response.json() );
		return data.version;
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
 * Reads the updateCheck field from cli.json synchronously so the banner prints
 * immediately, before any command output. If the cache is stale or missing,
 * fetches the latest version from the npm registry and saves it to cli.json.
 *
 * The banner is suppressed in IPC mode or when --json flag is used.
 */
export async function setupUpdateNotifier( currentVersion: string ): Promise< void > {
	if ( ! __IS_PACKAGED_FOR_NPM__ || Boolean( process.send ) || hasJsonFlag() ) {
		return;
	}

	const updateCheck = readUpdateCheck();
	const now = Date.now();

	// Fetch and cache if stale or missing (up to FETCH_TIMEOUT_MS)
	if ( ! updateCheck || now - updateCheck.lastChecked >= UPDATE_CHECK_INTERVAL_MS ) {
		const version = await fetchLatestVersion();
		if ( version ) {
			try {
				await updateCliConfigWithPartial( {
					updateCheck: { lastChecked: now, latestVersion: version },
				} );
			} catch {
				// Non-critical, ignore write failures
			}
		}
	}

	// Read again in case we just updated the cache on the first run
	const latestCheck = readUpdateCheck();

	if (
		latestCheck &&
		semver.valid( latestCheck.latestVersion ) &&
		semver.valid( currentVersion ) &&
		semver.gt( latestCheck.latestVersion, currentVersion )
	) {
		process.stderr.write( formatUpdateBanner( currentVersion, latestCheck.latestVersion ) );
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
		const rightPad = Math.max( 0, innerWidth - padding - visibleLen );
		return `${ side }${ ' '.repeat( padding ) }${ line }${ ' '.repeat( rightPad ) }${ side }`;
	} );

	return [ '', top, ...paddedLines, bottom, '' ].join( '\n' );
}
