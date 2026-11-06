import chalk from '@studio/common/lib/chalk';
import { __, sprintf } from '@wordpress/i18n';
import semver from 'semver';
import { z } from 'zod';
import { renderBannerBox } from 'cli/lib/banner-box';
import {
	readCliConfig,
	updateCheckSchema,
	updateCliConfigWithPartial,
} from 'cli/lib/cli-config/core';

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/wp-studio/latest';
const CHANGELOG_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/changelog/';

// Standalone (curl-installed) CLIs check the same wpcom endpoint the desktop app uses; the
// `product` param selects the Studio CLI builds. The server detects the channel from the
// version, compares, and replies 204 (already current) or 200 { version }.
const STUDIO_API_BASE = 'https://public-api.wordpress.com/wpcom/v2/studio-app';
const STUDIO_UPDATES_ENDPOINT = `${ STUDIO_API_BASE }/updates`;
const CLI_PRODUCT_SLUG = 'wordpress-com-studio-cli';

const NPM_UPDATE_COMMAND = 'npm update -g wp-studio';

type UpdateCheck = z.infer< typeof updateCheckSchema >;
type CliConfigUpdateCheckField = 'updateCheck' | 'standaloneUpdateCheck';
export type CliInstallKind = 'npm' | 'standalone' | 'embedded';

const npmRegistryResponseSchema = z.object( { version: z.string() } );
const updatesEndpointResponseSchema = z.object( {
	version: z.string(),
	downloadUrl: z.string().optional(),
} );

export interface CliUpdate {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
	downloadUrl?: string;
}

/**
 * Reads a cached update check from cli.json. Fails safe: `readCliConfig` throws on a
 * malformed or unreadable config, but a background update check must never crash the CLI,
 * so any error — or a missing/invalid field — just means "no cached check".
 */
async function readUpdateCheck( field: CliConfigUpdateCheckField ): Promise< UpdateCheck | null > {
	try {
		const config = await readCliConfig();
		return updateCheckSchema.parse( config[ field ] );
	} catch {
		return null;
	}
}

/**
 * Determines how this CLI was built, from the flags baked in by the matching vite config:
 * - `npm`: published to npm (`vite.config.npm.ts`).
 * - `standalone`: the curl-installed bundle (`vite.config.standalone.ts`).
 * - `embedded`: bundled in the desktop app, or a dev build — no update notifier.
 */
export function getCliInstallKind(): CliInstallKind {
	if ( __IS_PACKAGED_FOR_NPM__ ) {
		return 'npm';
	}
	if ( __IS_PACKAGED_FOR_STANDALONE__ ) {
		return 'standalone';
	}
	return 'embedded';
}

function hasJsonFlag(): boolean {
	return process.argv.includes( '--json' );
}

/**
 * Checks for available updates and displays a banner at the top of output.
 *
 * Branches by install kind: npm builds check the npm registry; standalone (curl) installs
 * check the wpcom updates endpoint for the Studio CLI product. The banner is suppressed in
 * IPC mode, when --json is used, and for desktop-embedded/dev builds.
 */
export async function setupUpdateNotifier(
	currentVersion: string,
	installKind: CliInstallKind = getCliInstallKind()
): Promise< void > {
	if (
		Boolean( process.send ) ||
		hasJsonFlag() ||
		process.argv
			.slice( 2 )
			.some( ( arg ) =>
				[ 'mcp', 'update', 'uninstall', '--help', '-h', '--version', '-v' ].includes( arg )
			)
	) {
		return;
	}

	const update = await getAvailableCliUpdate( currentVersion, installKind );
	if ( update ) {
		process.stderr.write(
			formatUpdateBanner( currentVersion, update.latestVersion, update.updateCommand )
		);
	}
}

export async function getAvailableCliUpdate(
	currentVersion: string,
	installKind: CliInstallKind = getCliInstallKind(),
	force = false
): Promise< CliUpdate | null > {
	if ( ! semver.valid( currentVersion ) || installKind === 'embedded' ) {
		return null;
	}
	return installKind === 'npm'
		? checkNpm( currentVersion, force )
		: checkStandalone( currentVersion, force );
}

async function fetchNpmLatestVersion(): Promise< string | null > {
	try {
		const response = await fetch( NPM_REGISTRY_URL, {
			signal: AbortSignal.timeout( FETCH_TIMEOUT_MS ),
			headers: { Accept: 'application/json' },
		} );

		if ( ! response.ok ) {
			return null;
		}

		const data = npmRegistryResponseSchema.parse( await response.json() );
		return data.version;
	} catch {
		return null;
	}
}

async function checkNpm( currentVersion: string, force: boolean ): Promise< CliUpdate | null > {
	const updateCheck = await readUpdateCheck( 'updateCheck' );
	const now = Date.now();
	let latestVersion = updateCheck?.latestVersion;

	// Fetch and cache if stale or missing (up to FETCH_TIMEOUT_MS)
	if ( force || ! updateCheck || now - updateCheck.lastChecked >= UPDATE_CHECK_INTERVAL_MS ) {
		const version = await fetchNpmLatestVersion();
		if ( version ) {
			latestVersion = version;
			try {
				await updateCliConfigWithPartial( {
					updateCheck: { lastChecked: now, latestVersion: version },
				} );
			} catch {
				// Non-critical, ignore write failures
			}
		}
	}

	if (
		latestVersion &&
		semver.valid( latestVersion ) &&
		semver.gt( latestVersion, currentVersion )
	) {
		return { currentVersion, latestVersion, updateCommand: NPM_UPDATE_COMMAND };
	}
	return null;
}

type StandaloneCheckResult =
	| { kind: 'update'; latestVersion: string; downloadUrl?: string }
	| { kind: 'current' }
	| { kind: 'error' };

async function fetchStandaloneUpdate( currentVersion: string ): Promise< StandaloneCheckResult > {
	try {
		const url = new URL( STUDIO_UPDATES_ENDPOINT );
		url.searchParams.set( 'product', CLI_PRODUCT_SLUG );
		url.searchParams.set( 'platform', process.platform );
		url.searchParams.set( 'studioArch', process.arch );
		url.searchParams.set( 'version', currentVersion );

		const response = await fetch( url, {
			signal: AbortSignal.timeout( FETCH_TIMEOUT_MS ),
			headers: { Accept: 'application/json' },
		} );

		// The endpoint replies 204 when the client is already on the latest build.
		if ( response.status === 204 ) {
			return { kind: 'current' };
		}
		if ( ! response.ok ) {
			return { kind: 'error' };
		}

		const data = updatesEndpointResponseSchema.parse( await response.json() );
		return { kind: 'update', latestVersion: data.version, downloadUrl: data.downloadUrl };
	} catch {
		return { kind: 'error' };
	}
}

async function checkStandalone(
	currentVersion: string,
	force: boolean
): Promise< CliUpdate | null > {
	const cached = await readUpdateCheck( 'standaloneUpdateCheck' );
	const now = Date.now();

	let latestVersion: string | null = null;
	let downloadUrl: string | undefined;

	// ~/.studio is shared across installs, so a cache left by a different channel (e.g. a
	// prior nightly) must not be trusted for this one — refetch on a channel mismatch.
	if (
		! force &&
		cached &&
		now - cached.lastChecked < UPDATE_CHECK_INTERVAL_MS &&
		channelForVersion( cached.latestVersion ) === channelForVersion( currentVersion )
	) {
		latestVersion = cached.latestVersion;
	} else {
		const result = await fetchStandaloneUpdate( currentVersion );
		if ( force && result.kind === 'error' ) {
			throw new Error( __( 'Could not check for Studio CLI updates. Please try again.' ) );
		}

		if ( result.kind === 'update' ) {
			latestVersion = result.latestVersion;
			downloadUrl = result.downloadUrl;
		} else if ( result.kind === 'current' ) {
			// Treat the running version as latest so we stay quiet until the TTL elapses.
			latestVersion = currentVersion;
		}

		// Cache successful checks only; on error, retry on the next run.
		if ( result.kind !== 'error' ) {
			try {
				await updateCliConfigWithPartial( {
					standaloneUpdateCheck: {
						lastChecked: now,
						latestVersion: latestVersion ?? currentVersion,
					},
				} );
			} catch {
				// Non-critical, ignore write failures
			}
		}
	}

	if (
		latestVersion &&
		semver.valid( latestVersion ) &&
		channelForVersion( latestVersion ) === channelForVersion( currentVersion ) &&
		semver.gt( latestVersion, currentVersion )
	) {
		return {
			currentVersion,
			latestVersion,
			updateCommand: 'studio update',
			downloadUrl,
		};
	}
	return null;
}

type UpdateChannel = 'production' | 'beta' | 'nightly';

export function channelForVersion( version: string ): UpdateChannel {
	if ( /-dev\.|-dev\d/.test( version ) ) {
		return 'nightly';
	}
	if ( version.includes( '-beta' ) ) {
		return 'beta';
	}
	return 'production';
}

export function formatUpdateBanner(
	currentVersion: string,
	latestVersion: string,
	updateCommand: string
): string {
	const updateLine = sprintf(
		/* translators: 1: current version, 2: latest version */
		__( 'Update available: %1$s → %2$s' ),
		chalk.dim( currentVersion ),
		chalk.green( latestVersion )
	);

	const commandLine = sprintf(
		/* translators: %s is the command to run to update */
		__( 'Run %s to update' ),
		chalk.cyan( updateCommand )
	);

	const changelogLine = sprintf(
		/* translators: %s is the changelog URL */
		__( 'Changelog: %s' ),
		chalk.cyan( CHANGELOG_URL )
	);

	return renderBannerBox( [ '', updateLine, commandLine, '', changelogLine, '' ], chalk.yellow );
}
