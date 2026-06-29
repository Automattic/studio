import fs from 'fs';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { hideDirectoryOnWindows } from '@studio/common/lib/hide-dir-windows';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import {
	getConfigDirectory,
	getDevelopmentChatStateDirectory,
	getDevelopmentChatStateLockFilePath,
	getDevelopmentChatStatePath,
} from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import type {
	DevelopmentProjectChatMessage,
	DevelopmentProjectChatState,
} from '@studio/common/types/publishing';

const CHAT_STATE_VERSION = 1;
const MAX_STORED_CHAT_MESSAGES = 100;

const chatMessageSchema = z.object( {
	id: z.string(),
	role: z.enum( [ 'user', 'assistant' ] ),
	content: z.string(),
} );

const projectChatStateSchema = z
	.object( {
		version: z.literal( CHAT_STATE_VERSION ),
		projectId: z.string(),
		messages: z.array( chatMessageSchema ).default( [] ),
		updatedAt: z.string().optional(),
	} )
	.loose();

type StoredProjectChatState = z.infer< typeof projectChatStateSchema >;

function createDefaultChatState( projectId: string ): StoredProjectChatState {
	return {
		version: CHAT_STATE_VERSION,
		projectId,
		messages: [],
	};
}

async function ensureDevelopmentChatStateDirectory(): Promise< void > {
	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
		await hideDirectoryOnWindows( configDir );
	}

	const chatStateDir = getDevelopmentChatStateDirectory();
	if ( ! fs.existsSync( chatStateDir ) ) {
		fs.mkdirSync( chatStateDir, { recursive: true } );
	}
}

async function lockDevelopmentChatState( projectId: string ): Promise< void > {
	await ensureDevelopmentChatStateDirectory();
	await lockFileAsync( getDevelopmentChatStateLockFilePath( projectId ), {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );
}

async function unlockDevelopmentChatState( projectId: string ): Promise< void > {
	await unlockFileAsync( getDevelopmentChatStateLockFilePath( projectId ) );
}

async function readStoredChatState( projectId: string ): Promise< StoredProjectChatState > {
	try {
		const content = await readFile( getDevelopmentChatStatePath( projectId ), 'utf8' );
		return projectChatStateSchema.parse( JSON.parse( content ) );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return createDefaultChatState( projectId );
		}
		throw error;
	}
}

async function saveStoredChatState(
	projectId: string,
	state: StoredProjectChatState
): Promise< void > {
	await ensureDevelopmentChatStateDirectory();
	await writeFile(
		getDevelopmentChatStatePath( projectId ),
		`${ JSON.stringify( { ...state, version: CHAT_STATE_VERSION }, null, 2 ) }\n`,
		'utf8'
	);
}

function normalizeMessages(
	messages: DevelopmentProjectChatMessage[]
): DevelopmentProjectChatMessage[] {
	return messages
		.filter(
			( message ) =>
				typeof message.id === 'string' &&
				( message.role === 'user' || message.role === 'assistant' ) &&
				typeof message.content === 'string'
		)
		.slice( -MAX_STORED_CHAT_MESSAGES );
}

export async function loadDevelopmentProjectChatState(
	projectId: string
): Promise< DevelopmentProjectChatState > {
	const projectState = await readStoredChatState( projectId );
	return {
		projectId,
		messages: projectState.messages,
		updatedAt: projectState.updatedAt,
	};
}

export async function saveDevelopmentProjectChatState(
	projectId: string,
	messages: DevelopmentProjectChatMessage[]
): Promise< DevelopmentProjectChatState > {
	const normalizedMessages = normalizeMessages( messages );
	const updatedAt = new Date().toISOString();
	let isLocked = false;

	try {
		await lockDevelopmentChatState( projectId );
		isLocked = true;
		const state: StoredProjectChatState = {
			...( await readStoredChatState( projectId ) ),
			version: CHAT_STATE_VERSION,
			projectId,
			messages: normalizedMessages,
			updatedAt,
		};
		await saveStoredChatState( projectId, state );
	} finally {
		if ( isLocked ) {
			await unlockDevelopmentChatState( projectId );
		}
	}

	return {
		projectId,
		messages: normalizedMessages,
		updatedAt,
	};
}
