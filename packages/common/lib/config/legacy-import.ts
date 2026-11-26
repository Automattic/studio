import fs from 'fs';
import os from 'os';
import path from 'path';
import { CONFIG_SECTIONS, configSiteSchema } from '@studio/common/lib/config/schema';
import { isRecord, parseRaw, type RawConfig } from '@studio/common/lib/config/store';
import { captureException, redactHomePaths } from '@studio/common/lib/error-reporting';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { getClosestSupportedPhpVersion } from '@studio/common/types/php-versions';
import { migrateConfig } from './migrations';

/**
 * Builds `config.json` from the files earlier builds kept: `shared.json`, `cli.json` and
 * `app.json` in `~/.studio`, or, from before Studio 1.7.7, `appdata-v1.json` in Electron's app
 * data folder. It applies every change the old per-surface migrations made on the way, so an
 * install of any version upgrades in one step.
 *
 * The originals are copied to `~/.studio/legacy-config/`, and the three files are replaced with
 * a version-2 stub that builds of before `config.json` reject with their "update Studio" error,
 * rather than starting with no sites. A later import, after `config.json` was lost, reads the
 * copies in place of the stubs.
 */

const LEGACY_FILES = [ 'shared.json', 'cli.json', 'app.json' ] as const;

type Legacy = Partial< Record< 'shared' | 'cli' | 'app', RawConfig > >;

function record( value: unknown ): RawConfig {
	return isRecord( value ) ? value : {};
}

function records( value: unknown ): RawConfig[] {
	return Array.isArray( value ) ? value.filter( isRecord ) : [];
}

const STUB = { version: 2, movedTo: 'config.json' };

// Undefined when the file is missing, unreadable, or a stub left by an earlier import.
function readJson( filePath: string ): RawConfig | undefined {
	try {
		const parsed = parseRaw( fs.readFileSync( filePath, 'utf8' ) );
		return parsed && parsed.movedTo === undefined ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// Electron's app data folder, where builds before 1.7.7 kept `appdata-v1.json`.
export function getLegacyAppDataDirectory(): string | undefined {
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, 'Studio' );
	}
	if ( process.platform === 'win32' ) {
		return process.env.APPDATA && path.join( process.env.APPDATA, 'Studio' );
	}
	if ( process.platform === 'linux' ) {
		return path.join(
			process.env.XDG_CONFIG_HOME || path.join( os.homedir(), '.config' ),
			'Studio'
		);
	}
	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio' );
}

function findAppdataV1(): string | undefined {
	const directory = getLegacyAppDataDirectory();
	const file = directory && path.join( directory, 'appdata-v1.json' );
	return file && fs.existsSync( file ) ? file : undefined;
}

const pick = ( source: RawConfig, keys: readonly string[] ) =>
	Object.fromEntries(
		keys.filter( ( key ) => key in source ).map( ( key ) => [ key, source[ key ] ] )
	);

const SITE_KEYS = new Set( Object.keys( configSiteSchema.shape ) );
const METADATA_KEYS = [ 'sortOrder', 'autoStart', 'hideFrontendAdminBar' ] as const;
const DESKTOP_KEYS = Object.keys( CONFIG_SECTIONS.desktop.shape );
const CLI_KEYS = Object.keys( CONFIG_SECTIONS.cli.shape );

// The split builds' migration from `appdata-v1.json`: sign-in and locale to `shared.json` unless it
// existed, sites and previews to `cli.json` unless it held none, the rest to `app.json`.
function splitAppdataV1( old: RawConfig, legacy: Legacy ): Legacy {
	const { authToken, locale, sites, snapshots, aiProvider, anthropicApiKey, version, ...app } = old;
	const oldSites = records( sites );
	const cli = legacy.cli ?? {};
	const cliIsEmpty = ! records( cli.sites ).length && ! records( cli.snapshots ).length;
	const siteMetadata: Record< string, RawConfig > = {};
	for ( const site of oldSites ) {
		if ( typeof site.id === 'string' ) {
			siteMetadata[ site.id ] = pick( site, METADATA_KEYS );
		}
	}
	return {
		shared: legacy.shared ?? { authToken, locale },
		cli: cliIsEmpty
			? { ...cli, sites: oldSites, snapshots: records( snapshots ), aiProvider, anthropicApiKey }
			: cli,
		app: { ...app, siteMetadata },
	};
}

// A Studio sign-in as earlier builds stored it, as the WordPress.com provider's config.
function toWpcomConfig( token: unknown ): RawConfig | undefined {
	if ( ! isRecord( token ) || typeof token.accessToken !== 'string' ) {
		return undefined;
	}
	return {
		token: token.accessToken,
		expiresAt: token.expirationTime,
		user: { id: token.id, email: token.email, displayName: token.displayName ?? '' },
	};
}

function mergeLastBump( ...maps: unknown[] ): Record< string, Record< string, number > > {
	const merged: Record< string, Record< string, number > > = {};
	for ( const map of maps.filter( isRecord ) ) {
		for ( const [ rawGroup, metrics ] of Object.entries( map ) ) {
			if ( ! isRecord( metrics ) ) {
				continue;
			}
			const group =
				rawGroup === 'local-environment-launch-uniques' ? 'studio-app-launch-uniques' : rawGroup;
			for ( const [ metric, time ] of Object.entries( metrics ) ) {
				if ( typeof time === 'number' ) {
					merged[ group ] ??= {};
					merged[ group ][ metric ] = Math.max( merged[ group ][ metric ] ?? 0, time );
				}
			}
		}
	}
	return merged;
}

export function buildConfigFromLegacy( { shared = {}, cli = {}, app = {} }: Legacy ): RawConfig {
	const {
		version: _sharedVersion,
		authToken,
		locale,
		selectedSkills,
		globalInstructionsEnabled,
		sessions,
		connectedWpcomSites,
		providerConfigs,
		rememberedSignIns,
		signInHostId,
		remoteSites,
		aiProvider,
		aiImageProvider,
		anthropicApiKey,
		analyticsInstallId,
		analyticsOptOut,
		...sharedRest
	} = shared;
	const {
		version: _appVersion,
		siteMetadata,
		aiSessionPlacements,
		lastBumpStats: appLastBump,
		sentryUserId,
		connectedWpcomSites: appConnectedWpcomSites,
		stopSitesOnQuit,
		desks: _desks,
		lastSeenVersion: _lastSeenVersion,
		betaFeatures,
		...appRest
	} = app;
	const metadata = record( siteMetadata );

	const sites = records( cli.sites ).map( ( site ) => {
		const stored: RawConfig = {
			...pick(
				site,
				Object.keys( site ).filter( ( key ) => SITE_KEYS.has( key ) && key !== 'autoStart' )
			),
			...pick( record( metadata[ String( site.id ) ] ), METADATA_KEYS ),
		};
		if ( site.runtime === 'playground' && typeof site.phpVersion === 'string' ) {
			stored.phpVersion = getClosestSupportedPhpVersion( site.phpVersion ) ?? site.phpVersion;
		}
		stored.autoStart ??= site.autoStart;
		stored.runtimeStat = record( cli.siteRuntimeStats )[ String( site.id ) ];
		return stored;
	} );
	const sitesById = new Map( sites.map( ( site ) => [ String( site.id ), site ] ) );
	const connect = ( localSiteId: unknown, connection: RawConfig ) => {
		const site = sitesById.get( String( localSiteId ) );
		if ( site ) {
			site.connections = [ ...records( site.connections ), connection ];
		}
	};

	const wpcomConnections = isRecord( connectedWpcomSites )
		? connectedWpcomSites
		: record( appConnectedWpcomSites );
	for ( const [ account, connections ] of Object.entries( wpcomConnections ) ) {
		for ( const connection of records( connections ) ) {
			const { localSiteId, lastPushTimestamp, lastPullTimestamp, ...site } = connection;
			connect( localSiteId, {
				provider: 'wpcom',
				account,
				site,
				lastPushTimestamp: lastPushTimestamp ?? null,
				lastPullTimestamp: lastPullTimestamp ?? null,
			} );
		}
	}
	for ( const [ localSiteId, connections ] of Object.entries( record( remoteSites ) ) ) {
		records( connections ).forEach( ( connection ) => connect( localSiteId, connection ) );
	}

	const configs: RawConfig = { ...record( providerConfigs ) };
	const wpcom = toWpcomConfig( authToken );
	if ( wpcom ) {
		configs.wpcom = wpcom;
	}
	const apiKey = anthropicApiKey ?? cli.anthropicApiKey;
	if ( ! configs.anthropic && typeof apiKey === 'string' && apiKey ) {
		configs.anthropic = { method: 'api-key', apiKey };
	}

	const placements = record( aiSessionPlacements );
	const configSessions = Object.fromEntries(
		[ ...new Set( [ ...Object.keys( record( sessions ) ), ...Object.keys( placements ) ] ) ].map(
			( id ) => [ id, { ...record( record( sessions )[ id ] ), placement: placements[ id ] } ]
		)
	);

	const preferences: RawConfig = {
		...Object.fromEntries(
			Object.entries( appRest ).filter( ( [ key ] ) => ! DESKTOP_KEYS.includes( key ) )
		),
		locale,
		analyticsOptOut,
		selectedSkills,
		globalInstructionsEnabled,
	};
	if ( stopSitesOnQuit !== undefined && preferences.quitSitesBehavior === undefined ) {
		// The old "Stop sites" kept sites flagged to auto-start; off was "Leave running".
		preferences.quitSitesBehavior = stopSitesOnQuit ? 'stop-and-auto-start' : 'leave-running';
	}
	if ( isRecord( betaFeatures ) && betaFeatures.enableAgenticUi === false ) {
		preferences.onboardingHints = {
			...record( preferences.onboardingHints ),
			migratedFromClassic: true,
		};
	}

	const desktop = pick( appRest, DESKTOP_KEYS );
	if ( typeof desktop.promptWindowsSpeedUpResult === 'string' ) {
		desktop.promptWindowsSpeedUpResult = {
			response: desktop.promptWindowsSpeedUpResult,
			appVersion: '',
			dontAskAgain: false,
		};
	}

	return migrateConfig(
		JSON.parse(
			JSON.stringify( {
				...sharedRest,
				version: 1,
				install: { analyticsId: analyticsInstallId, sentryUserId, signInHostId },
				providers: {
					selected: aiProvider ?? cli.aiProvider,
					selectedImage: aiImageProvider,
					configs,
					remembered: rememberedSignIns,
				},
				preferences,
				sites,
				snapshots: records( cli.snapshots ),
				sessions: configSessions,
				stats: { lastBump: mergeLastBump( appLastBump, cli.lastBumpStats ) },
				desktop,
				cli: pick( cli, CLI_KEYS ),
			} )
		)
	);
}

/**
 * The legacy config as `config.json`, and a function that retires the legacy files once it is
 * written: a copy in `legacy-config/`, then the version-2 stubs.
 */
export async function importLegacyConfig(): Promise< {
	config: RawConfig;
	retire: () => Promise< void >;
} > {
	const directory = getConfigDirectory();
	const backup = path.join( directory, 'legacy-config' );
	const files = LEGACY_FILES.map( ( name ) => readJson( path.join( directory, name ) ) );
	// Files already imported once are stubs: their copies hold the data.
	const [ shared, cli, app ] = files.map(
		( file, index ) => file ?? readJson( path.join( backup, LEGACY_FILES[ index ] ) )
	);
	const present = LEGACY_FILES.filter( ( _name, index ) => files[ index ] );
	if ( [ shared, cli, app ].some( ( file, index ) => file && ! files[ index ] ) ) {
		captureException( new Error( 'Imported the Studio settings again from legacy-config/' ) );
	}
	let legacy: Legacy = { shared, cli, app };
	const appdataV1 = legacy.app ? undefined : findAppdataV1();
	const old = appdataV1 && readJson( appdataV1 );
	if ( old ) {
		legacy = splitAppdataV1( old, legacy );
	}

	const retire = async () => {
		if ( present.length ) {
			await fs.promises.mkdir( backup, { recursive: true } );
			for ( const name of present ) {
				await fs.promises.copyFile( path.join( directory, name ), path.join( backup, name ) );
				await fs.promises.writeFile(
					path.join( directory, name ),
					JSON.stringify( STUB, null, 2 ) + '\n'
				);
			}
		}
		if ( appdataV1 && old ) {
			await fs.promises.rename(
				appdataV1,
				path.join( path.dirname( appdataV1 ), 'appdata-v1.deprecated.json' )
			);
		}
		if ( present.length || old ) {
			console.log( `Moved the Studio settings to ${ redactHomePaths( directory ) }/config.json` );
		}
	};

	return { config: buildConfigFromLegacy( legacy ), retire };
}
