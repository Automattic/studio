import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME, SHARED_CONFIG_LOCKFILE_NAME } from '../constants';
import { syncSiteSchema } from '../types/sync';
import { authTokenSchema, type StoredAuthToken } from './auth-token-schema';
import { hideDirectoryOnWindows } from './hide-dir-windows';
import { lockFileAsync, unlockFileAsync } from './lockfile';
import { getConfigDirectory, getSharedConfigPath } from './well-known-paths';

export { authTokenSchema };
export type { StoredAuthToken };

export class SharedConfigVersionMismatchError extends Error {
	constructor() {
		super(
			'A newer version of Studio or the Studio CLI is installed on your system. Please update all components to the same version.'
		);
		this.name = 'SharedConfigVersionMismatchError';
	}
}

// Schema updates must maintain backwards compatibility. If a breaking change is needed,
// increment SHARED_CONFIG_VERSION and add a data migration function.
const SHARED_CONFIG_VERSION = 1;

export const sharedSessionMetadataSchema = z
	.object( {
		archived: z.boolean().optional(),
	} )
	.loose();

export type SharedSessionMetadata = z.infer< typeof sharedSessionMetadataSchema >;

export const sharedConfigSchema = z
	.object( {
		version: z.literal( SHARED_CONFIG_VERSION ),
		authToken: authTokenSchema.optional(),
		locale: z.string().optional(),
		selectedSkills: z.array( z.string() ).optional(),
		sessions: z.record( z.string(), sharedSessionMetadataSchema ).optional(),
		// WordPress.com sites connected to local sites, keyed by user id.
		// Both Studio and the Studio CLI read and write this field through
		// the helpers in `./connected-sites.ts`.
		connectedWpcomSites: z.record( z.string(), z.array( syncSiteSchema ) ).optional(),
		// AI provider selection and the Anthropic API key, shared by Studio and
		// the Studio CLI. Typed as plain strings so an unknown provider value
		// written by a newer build degrades gracefully instead of failing the
		// parse; readers narrow with `isAiProviderId`.
		aiProvider: z.string().optional(),
		anthropicApiKey: z.string().optional(),
		// Anonymous install identifier for Tracks analytics, shared by Studio and the Studio CLI.
		// See `docs/design-docs/analytics-tracks.md`.
		analyticsInstallId: z.string().optional(),
		// When true, the user has opted out of Tracks analytics. Absent/false means opted in
		// (analytics default ON). Does not affect MC Stats or Sentry.
		analyticsOptOut: z.boolean().optional(),
	} )
	.loose();

export type SharedConfig = z.infer< typeof sharedConfigSchema >;

const DEFAULT_SHARED_CONFIG: SharedConfig = {
	version: SHARED_CONFIG_VERSION,
};

export async function readSharedConfig(): Promise< SharedConfig > {
	const configPath = getSharedConfigPath();

	if ( ! fs.existsSync( configPath ) ) {
		return structuredClone( DEFAULT_SHARED_CONFIG );
	}

	let data: Record< string, unknown > | undefined;
	try {
		const fileContent = await readFile( configPath, { encoding: 'utf8' } );
		data = JSON.parse( fileContent );
		return sharedConfigSchema.parse( data );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			if ( typeof data?.version === 'number' && data.version !== SHARED_CONFIG_VERSION ) {
				throw new SharedConfigVersionMismatchError();
			}
			return structuredClone( DEFAULT_SHARED_CONFIG );
		}
		if ( error instanceof SyntaxError ) {
			return structuredClone( DEFAULT_SHARED_CONFIG );
		}
		throw new Error( 'Failed to read shared config file.' );
	}
}

export async function saveSharedConfig( config: SharedConfig ): Promise< void > {
	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
		await hideDirectoryOnWindows( configDir );
	}

	const configPath = getSharedConfigPath();
	const persisted = { ...config, version: SHARED_CONFIG_VERSION };
	const fileContent = JSON.stringify( persisted, null, 2 ) + '\n';
	await writeFile( configPath, fileContent, { encoding: 'utf8' } );
}

function getLockfilePath(): string {
	return path.join( getConfigDirectory(), SHARED_CONFIG_LOCKFILE_NAME );
}

export async function lockSharedConfig(): Promise< void > {
	await lockFileAsync( getLockfilePath(), {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );
}

export async function unlockSharedConfig(): Promise< void > {
	await unlockFileAsync( getLockfilePath() );
}

export async function updateSharedConfig( update: Partial< SharedConfig > ): Promise< void > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const updated = { ...config, ...update };
		await saveSharedConfig( updated );
	} finally {
		await unlockSharedConfig();
	}
}

function pruneSharedSessionMetadata( metadata: SharedSessionMetadata ): void {
	if ( ! metadata.archived ) {
		delete metadata.archived;
	}
}

function pruneEmptySharedSessions( config: SharedConfig ): void {
	if ( ! config.sessions ) {
		return;
	}

	for ( const [ sessionId, metadata ] of Object.entries( config.sessions ) ) {
		pruneSharedSessionMetadata( metadata );
		if ( Object.keys( metadata ).length === 0 ) {
			delete config.sessions[ sessionId ];
		}
	}

	if ( Object.keys( config.sessions ).length === 0 ) {
		delete config.sessions;
	}
}

export async function readSharedSessions(): Promise< Record< string, SharedSessionMetadata > > {
	const config = await readSharedConfig();
	return config.sessions ?? {};
}

export async function readSharedSession(
	sessionId: string
): Promise< SharedSessionMetadata | undefined > {
	const sessions = await readSharedSessions();
	return sessions[ sessionId ];
}

export async function updateSharedSession(
	sessionId: string,
	patch: Partial< SharedSessionMetadata >
): Promise< SharedSessionMetadata | undefined > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		config.sessions ??= {};
		config.sessions[ sessionId ] ??= {};
		Object.assign( config.sessions[ sessionId ], patch );
		pruneEmptySharedSessions( config );
		await saveSharedConfig( config );
		return config.sessions?.[ sessionId ];
	} finally {
		await unlockSharedConfig();
	}
}

export async function deleteSharedSession( sessionId: string ): Promise< void > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		if ( ! config.sessions?.[ sessionId ] ) {
			return;
		}
		delete config.sessions[ sessionId ];
		pruneEmptySharedSessions( config );
		await saveSharedConfig( config );
	} finally {
		await unlockSharedConfig();
	}
}

export async function readAuthToken(): Promise< StoredAuthToken | null > {
	try {
		const config = await readSharedConfig();
		if ( ! config.authToken ) {
			return null;
		}
		const token = authTokenSchema.parse( config.authToken );
		if ( Date.now() >= token.expirationTime ) {
			return null;
		}
		return token;
	} catch ( error ) {
		if ( error instanceof SharedConfigVersionMismatchError ) {
			throw error;
		}
		return null;
	}
}

export async function getCurrentUserId(): Promise< number | null > {
	const token = await readAuthToken();
	return token?.id ?? null;
}

// Returns the anonymous Tracks install id, minting and persisting one on first use. Shared by Studio
// and the Studio CLI (both read the same `shared.json`). See `docs/design-docs/analytics-tracks.md`.
export async function getOrCreateAnalyticsInstallId(): Promise< string > {
	// Fast path: already minted. Avoids taking the lock on every launch.
	const existing = ( await readSharedConfig() ).analyticsInstallId;
	if ( existing ) {
		return existing;
	}

	// Mint under lock. The desktop app and the CLI it spawns can both reach this on first launch;
	// re-read inside the critical section so we don't clobber an id another process just minted.
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		if ( config.analyticsInstallId ) {
			return config.analyticsInstallId;
		}
		const id = crypto.randomUUID();
		await saveSharedConfig( { ...config, analyticsInstallId: id } );
		return id;
	} finally {
		await unlockSharedConfig();
	}
}

// True when the user has opted out of Tracks analytics. Default is opted IN (analytics ON).
// Takes an already-read config, for callers that hold one and shouldn't re-read the file.
export function isAnalyticsOptedOutInConfig( config: SharedConfig ): boolean {
	return config.analyticsOptOut === true;
}

export async function isAnalyticsOptedOut(): Promise< boolean > {
	return isAnalyticsOptedOutInConfig( await readSharedConfig() );
}

// Best-effort Automattician flag for the shared `is_a11n` Tracks property, derived from the stored
// auth token's email domain. Returns false when logged out. Kept synchronous-friendly (no network
// call) so it can run on every event; the authoritative team-membership check lives elsewhere.
export async function isAutomatticianFromToken(): Promise< boolean > {
	const token = await readAuthToken();
	const email = token?.email?.toLowerCase() ?? '';
	return email.endsWith( '@a8c.com' ) || email.endsWith( '@automattic.com' );
}
