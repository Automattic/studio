import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';

/**
 * Model-provider credentials that pi signs in, refreshes and reads, kept in
 * `~/.studio/ai-credentials.json`: owner-only, apart from shared.json, and
 * behind their own lockfile. pi refreshes OAuth tokens inside `modify`, forked
 * CLI turns can do so at the same moment, and each refresh rotates the refresh
 * token, so the lock has to hold across processes.
 */

interface CredentialsFile {
	// Stable per install. Sign-in flows that identify the app installation,
	// such as Sign in with ChatGPT, send it.
	deviceId?: string;
	credentials?: Record< string, Credential >;
}

// pi bounds an OAuth refresh to 15 s and holds the lock across it, longer than
// the 5 s stale time the config lockfiles use.
const LOCK_WAIT_MS = 30_000;
const LOCK_STALE_MS = 45_000;

function getCredentialsPath(): string {
	return path.join( getConfigDirectory(), 'ai-credentials.json' );
}

function getLockfilePath(): string {
	return path.join( getConfigDirectory(), 'ai-credentials.json.lock' );
}

async function readCredentialsFile(): Promise< CredentialsFile > {
	let content: string;
	try {
		content = await readFile( getCredentialsPath(), { encoding: 'utf8' } );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return {};
		}
		throw error;
	}
	try {
		const parsed: unknown = JSON.parse( content );
		return parsed && typeof parsed === 'object' ? ( parsed as CredentialsFile ) : {};
	} catch {
		return {};
	}
}

async function writeCredentialsFile( file: CredentialsFile ): Promise< void > {
	await writeFile( getCredentialsPath(), JSON.stringify( file, null, 2 ) + '\n', {
		encoding: 'utf8',
		mode: 0o600,
	} );
}

async function withCredentialsLock< T >( fn: () => Promise< T > ): Promise< T > {
	fs.mkdirSync( getConfigDirectory(), { recursive: true } );
	await lockFileAsync( getLockfilePath(), { wait: LOCK_WAIT_MS, stale: LOCK_STALE_MS } );
	try {
		return await fn();
	} finally {
		await unlockFileAsync( getLockfilePath() );
	}
}

export class FileCredentialStore implements CredentialStore {
	async read( providerId: string ): Promise< Credential | undefined > {
		return ( await readCredentialsFile() ).credentials?.[ providerId ];
	}

	async list(): Promise< readonly CredentialInfo[] > {
		const { credentials = {} } = await readCredentialsFile();
		return Object.entries( credentials ).map( ( [ providerId, credential ] ) => ( {
			providerId,
			type: credential.type,
		} ) );
	}

	async modify(
		providerId: string,
		fn: ( current: Credential | undefined ) => Promise< Credential | undefined >
	): Promise< Credential | undefined > {
		return withCredentialsLock( async () => {
			const file = await readCredentialsFile();
			const current = file.credentials?.[ providerId ];
			const next = await fn( current );
			if ( ! next ) {
				return current;
			}
			await writeCredentialsFile( {
				...file,
				credentials: { ...file.credentials, [ providerId ]: next },
			} );
			return next;
		} );
	}

	async delete( providerId: string ): Promise< void > {
		await withCredentialsLock( async () => {
			const file = await readCredentialsFile();
			if ( ! file.credentials?.[ providerId ] ) {
				return;
			}
			const { [ providerId ]: _removed, ...credentials } = file.credentials;
			await writeCredentialsFile( { ...file, credentials } );
		} );
	}
}

/** This install's device id, created on first use. */
export async function getOrCreateDeviceId(): Promise< string > {
	const existing = ( await readCredentialsFile() ).deviceId;
	if ( existing ) {
		return existing;
	}
	return withCredentialsLock( async () => {
		const file = await readCredentialsFile();
		if ( file.deviceId ) {
			return file.deviceId;
		}
		const deviceId = crypto.randomUUID();
		await writeCredentialsFile( { ...file, deviceId } );
		return deviceId;
	} );
}

// pi's OpenAI provider id; Sign in with ChatGPT is its OAuth method.
export const CHATGPT_PI_PROVIDER = 'openai';

export async function hasChatGptCredential(): Promise< boolean > {
	return ( await new FileCredentialStore().read( CHATGPT_PI_PROVIDER ) )?.type === 'oauth';
}

/**
 * Signs out of ChatGPT on this install. OpenAI keeps the refresh token valid
 * until it expires; the user can disconnect Studio in ChatGPT's settings.
 */
export async function deleteChatGptCredential(): Promise< void > {
	await new FileCredentialStore().delete( CHATGPT_PI_PROVIDER );
}
