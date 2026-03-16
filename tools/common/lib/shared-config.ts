import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME, SHARED_CONFIG_LOCKFILE_NAME } from '../constants';
import { lockFileAsync, unlockFileAsync } from './lockfile';

const SHARED_CONFIG_FILENAME = 'shared.json';

export const authTokenSchema = z.object( {
	accessToken: z.string(),
	expiresIn: z.number(),
	expirationTime: z.number(),
	id: z.number(),
	email: z.string(),
	displayName: z.string().default( '' ),
} );

export type StoredToken = z.infer< typeof authTokenSchema >;

const sharedConfigSchema = z
	.object( {
		version: z.number().default( 1 ),
		authToken: authTokenSchema.optional(),
		locale: z.string().optional(),
	} )
	.loose();

export type SharedConfig = z.infer< typeof sharedConfigSchema >;

const DEFAULT_SHARED_CONFIG: SharedConfig = {
	version: 1,
};

export function getSharedConfigDirectory(): string {
	if ( process.env.E2E && process.env.E2E_SHARED_CONFIG_PATH ) {
		return process.env.E2E_SHARED_CONFIG_PATH;
	}
	return path.join( os.homedir(), '.studio' );
}

export function getSharedConfigPath(): string {
	return path.join( getSharedConfigDirectory(), SHARED_CONFIG_FILENAME );
}

export async function readSharedConfig(): Promise< SharedConfig > {
	const configPath = getSharedConfigPath();

	if ( ! fs.existsSync( configPath ) ) {
		return structuredClone( DEFAULT_SHARED_CONFIG );
	}

	try {
		const fileContent = await readFile( configPath, { encoding: 'utf8' } );
		const data = JSON.parse( fileContent );
		return sharedConfigSchema.parse( data );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			throw new Error( 'Invalid shared config file format.' );
		}
		if ( error instanceof SyntaxError ) {
			throw new Error( 'Shared config file is corrupted.' );
		}
		throw new Error( 'Failed to read shared config file.' );
	}
}

export async function saveSharedConfig( config: SharedConfig ): Promise< void > {
	config.version = 1;

	const configDir = getSharedConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
	}

	const configPath = getSharedConfigPath();
	const fileContent = JSON.stringify( config, null, 2 ) + '\n';
	await writeFile( configPath, fileContent, { encoding: 'utf8' } );
}

function getLockfilePath(): string {
	return path.join( getSharedConfigDirectory(), SHARED_CONFIG_LOCKFILE_NAME );
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

export async function updateSharedConfig(
	update: Partial< Omit< SharedConfig, 'version' > >
): Promise< void > {
	try {
		await lockSharedConfig();
		const config = await readSharedConfig();
		const updated = { ...config, ...update };
		await saveSharedConfig( updated );
	} finally {
		await unlockSharedConfig();
	}
}

export async function readAuthToken(): Promise< StoredToken | null > {
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
	} catch {
		return null;
	}
}

export async function getCurrentUserId(): Promise< number | null > {
	const token = await readAuthToken();
	return token?.id ?? null;
}
