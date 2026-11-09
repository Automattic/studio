import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';

interface CredentialsFile {
	deviceId?: string;
	credentials?: Record< string, Credential >;
}

const getCredentialsPath = () => path.join( getConfigDirectory(), 'ai-credentials.json' );
const getLockfilePath = () => `${ getCredentialsPath() }.lock`;

async function readCredentialsFile(): Promise< CredentialsFile > {
	let content: string;
	try {
		content = await readFile( getCredentialsPath(), { encoding: 'utf8' } );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) return {};
		throw error;
	}
	const parsed: unknown = JSON.parse( content );
	if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
		throw new Error( 'Invalid AI credentials file.' );
	}
	return parsed as CredentialsFile;
}

async function writeCredentialsFile( file: CredentialsFile ): Promise< void > {
	await writeFile( getCredentialsPath(), JSON.stringify( file, null, 2 ) + '\n', {
		encoding: 'utf8',
		mode: 0o600,
	} );
}

async function withCredentialsLock< T >( fn: () => Promise< T > ): Promise< T > {
	fs.mkdirSync( getConfigDirectory(), { recursive: true } );
	// OAuth refresh rotates tokens; hold a cross-process lock across pi's bounded refresh.
	await lockFileAsync( getLockfilePath(), { wait: 30_000, stale: 45_000 } );
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
			if ( ! next ) return current;
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
			const { [ providerId ]: _removed, ...credentials } = file.credentials ?? {};
			await writeCredentialsFile( { ...file, credentials } );
		} );
	}
}

export async function getOrCreateDeviceId(): Promise< string > {
	return withCredentialsLock( async () => {
		const file = await readCredentialsFile();
		if ( file.deviceId ) return file.deviceId;
		const deviceId = crypto.randomUUID();
		await writeCredentialsFile( { ...file, deviceId } );
		return deviceId;
	} );
}
