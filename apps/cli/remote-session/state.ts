import fs from 'fs';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import {
	getRemoteSessionStateLockFilePath,
	getRemoteSessionStatePath,
} from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';

export const remoteSessionStateSchema = z.object( {
	chat_id: z.number().int(),
	session_id: z.string().min( 1 ).optional(),
	updated_at: z.string().optional(),
} );

export type RemoteSessionState = z.infer< typeof remoteSessionStateSchema >;

async function readStateUnlocked(): Promise< RemoteSessionState | null > {
	const statePath = getRemoteSessionStatePath();
	if ( ! fs.existsSync( statePath ) ) {
		return null;
	}
	try {
		const content = await readFile( statePath, { encoding: 'utf8' } );
		return remoteSessionStateSchema.parse( JSON.parse( content ) );
	} catch {
		return null;
	}
}

async function writeStateUnlocked( state: RemoteSessionState ): Promise< void > {
	const statePath = getRemoteSessionStatePath();
	const content = JSON.stringify( state, null, 2 ) + '\n';
	await writeFile( statePath, content, { encoding: 'utf8', mode: 0o600 } );
	try {
		await fs.promises.chmod( statePath, 0o600 );
	} catch {
		// chmod can fail on Windows.
	}
}

async function withStateLock< T >( fn: () => Promise< T > ): Promise< T > {
	const lockPath = getRemoteSessionStateLockFilePath();
	await lockFileAsync( lockPath, {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );
	try {
		return await fn();
	} finally {
		await unlockFileAsync( lockPath );
	}
}

/**
 * Read the persisted state (if any) for the given chat. Returns null when there is no
 * state on disk, or when the stored state is for a different chat (stale binding).
 */
export async function readStateForChat( chatId: number ): Promise< RemoteSessionState | null > {
	return withStateLock( async () => {
		const state = await readStateUnlocked();
		if ( ! state || state.chat_id !== chatId ) {
			return null;
		}
		return state;
	} );
}

/**
 * Persist the session id for the given chat, under a lock.
 */
export async function writeSessionId( chatId: number, sessionId: string ): Promise< void > {
	await withStateLock( async () => {
		const next: RemoteSessionState = {
			chat_id: chatId,
			session_id: sessionId,
			updated_at: new Date().toISOString(),
		};
		await writeStateUnlocked( next );
	} );
}

/**
 * Clear the session id for the given chat (keeps the chat_id binding on disk).
 */
export async function clearSessionId( chatId: number ): Promise< void > {
	await withStateLock( async () => {
		const next: RemoteSessionState = {
			chat_id: chatId,
			updated_at: new Date().toISOString(),
		};
		await writeStateUnlocked( next );
	} );
}
