import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from '@studio/common/lib/chalk';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { __, sprintf } from '@wordpress/i18n';
import semver from 'semver';
import { z } from 'zod';
import { renderBannerBox } from 'cli/lib/banner-box';
import { updateCheckSchema, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';

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
const updatesEndpointResponseSchema = z.object( { version: z.string() } );

/**
 * Reads a cached update check from cli.json synchronously.
 * Uses a direct fs.readFileSync + zod parse to avoid the async readCliConfig path,
 * so the banner can be printed before any command output.
 */
function readUpdateCheck( field: CliConfigUpdateCheckField ): UpdateCheck | null {
	try {
		const content = fs.readFileSync( getCliConfigPath(), 'utf8' );
		const data = JSON.parse( content );
		return updateCheckSchema.parse( data?.[ field ] );
	} catch {
		// File doesn't exist, field missing, or invalid
	}
	return null;
}

function isPathInside( child: string, parent: string ): boolean {
	const relative = path.relative( parent, child );
	return relative !== '' && ! relative.startsWith( '..' ) && ! path.isAbsolute( relative );
}

/**
 * True when the running binary lives under the standalone install home
 * (`STUDIO_CLI_HOME`, defaulting to ~/.studio) — i.e. a curl-installed CLI.
 */
export function isStandaloneInstall(): boolean {
	const home = process.env.STUDIO_CLI_HOME || path.join( os.homedir(), '.studio' );
	return isPathInside( process.execPath, home );
}

/**
 * Determines how this CLI was installed:
 * - `npm`: published to npm (build-time flag).
 * - `standalone`: curl-installed, running from the standalone install home.
 * - `embedded`: bundled in the desktop app, or a dev build — no update notifier.
 */
export function getCliInstallKind(): CliInstallKind {
	if ( __IS_PACKAGED_FOR_NPM__ ) {
		return 'npm';
	}
	if ( isStandaloneInstall() ) {
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
	if ( Boolean( process.send ) || hasJsonFlag() ) {
		return;
	}

	switch ( installKind ) {
		case 'npm':
			await notifyNpm( currentVersion );
			break;
		case 'standalone':
			await notifyStandalone( currentVersion );
			break;
		case 'embedded':
			break;
	}
}

async function fetchNpmLatestVersion(): Promise< string | null > {
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

async function notifyNpm( currentVersion: string ): Promise< void > {
	const updateCheck = readUpdateCheck( 'updateCheck' );
	const now = Date.now();

	// Fetch and cache if stale or missing (up to FETCH_TIMEOUT_MS)
	if ( ! updateCheck || now - updateCheck.lastChecked >= UPDATE_CHECK_INTERVAL_MS ) {
		const version = await fetchNpmLatestVersion();
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
	const latestCheck = readUpdateCheck( 'updateCheck' );

	if (
		latestCheck &&
		semver.valid( latestCheck.latestVersion ) &&
		semver.valid( currentVersion ) &&
		semver.gt( latestCheck.latestVersion, currentVersion )
	) {
		process.stderr.write( formatUpdateBanner( currentVersion, latestCheck.latestVersion ) );
	}
}

type StandaloneCheckResult =
	| { kind: 'update'; latestVersion: string }
	| { kind: 'current' }
	| { kind: 'error' };

async function fetchStandaloneUpdate( currentVersion: string ): Promise< StandaloneCheckResult > {
	try {
		const url = new URL( STUDIO_UPDATES_ENDPOINT );
		url.searchParams.set( 'product', CLI_PRODUCT_SLUG );
		url.searchParams.set( 'platform', process.platform );
		url.searchParams.set( 'studioArch', process.arch );
		url.searchParams.set( 'version', currentVersion );

		const controller = new AbortController();
		const timeout = setTimeout( () => controller.abort(), FETCH_TIMEOUT_MS );

		const response = await fetch( url, {
			signal: controller.signal,
			headers: { Accept: 'application/json' },
		} );
		clearTimeout( timeout );

		// The endpoint replies 204 when the client is already on the latest build.
		if ( response.status === 204 ) {
			return { kind: 'current' };
		}
		if ( ! response.ok ) {
			return { kind: 'error' };
		}

		const data = updatesEndpointResponseSchema.parse( await response.json() );
		return { kind: 'update', latestVersion: data.version };
	} catch {
		return { kind: 'error' };
	}
}

async function notifyStandalone( currentVersion: string ): Promise< void > {
	const cached = readUpdateCheck( 'standaloneUpdateCheck' );
	const now = Date.now();

	let latestVersion: string | null = null;

	if ( cached && now - cached.lastChecked < UPDATE_CHECK_INTERVAL_MS ) {
		latestVersion = cached.latestVersion;
	} else {
		const result = await fetchStandaloneUpdate( currentVersion );

		if ( result.kind === 'update' ) {
			latestVersion = result.latestVersion;
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
		semver.valid( currentVersion ) &&
		semver.gt( latestVersion, currentVersion )
	) {
		process.stderr.write(
			formatUpdateBanner( currentVersion, latestVersion, standaloneUpdateCommand( currentVersion ) )
		);
	}
}

type UpdateChannel = 'production' | 'beta' | 'nightly';

function channelForVersion( version: string ): UpdateChannel {
	if ( /-dev\.|-dev\d/.test( version ) ) {
		return 'nightly';
	}
	if ( version.includes( '-beta' ) ) {
		return 'beta';
	}
	return 'production';
}

/**
 * The OS-appropriate installer one-liner to update a standalone (curl-installed) CLI,
 * pinned to the running version's channel via STUDIO_CLI_VERSION. Production uses the
 * installer default (`latest`); nightly/beta use the matching CDN alias.
 *
 * The `beta` CDN alias is still pending (wpcom follow-up), but no beta CLI builds exist
 * yet, so the beta branch is currently unreachable in practice.
 */
export function standaloneUpdateCommand(
	currentVersion: string,
	platform: NodeJS.Platform = process.platform
): string {
	const channel = channelForVersion( currentVersion );
	const alias = channel === 'production' ? '' : channel;

	if ( platform === 'win32' ) {
		const prefix = alias ? `$env:STUDIO_CLI_VERSION='${ alias }'; ` : '';
		return `${ prefix }irm ${ STUDIO_API_BASE }/install.ps1 | iex`;
	}

	const prefix = alias ? `STUDIO_CLI_VERSION=${ alias } ` : '';
	return `${ prefix }curl -fsSL ${ STUDIO_API_BASE }/install.sh | bash`;
}

export function formatUpdateBanner(
	currentVersion: string,
	latestVersion: string,
	updateCommand: string = NPM_UPDATE_COMMAND
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
