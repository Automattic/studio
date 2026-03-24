import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME, SHARED_CONFIG_LOCKFILE_NAME } from '../constants';
import { authTokenSchema, type StoredAuthToken } from './auth-token-schema';
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

export const sharedConfigSchema = z
	.object( {
		version: z.literal( SHARED_CONFIG_VERSION ),
		authToken: authTokenSchema.optional(),
		locale: z.string().optional(),
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
