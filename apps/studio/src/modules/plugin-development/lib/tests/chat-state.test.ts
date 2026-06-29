/**
 * @vitest-environment node
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
	getDevelopmentChatStateDirectory,
	getDevelopmentChatStatePath,
} from '@studio/common/lib/well-known-paths';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDevelopmentProjectChatState, saveDevelopmentProjectChatState } from '../chat-state';
import type { DevelopmentProjectChatMessage } from '@studio/common/types/publishing';

vi.mock( 'atomically', async () => {
	const fsPromises = await import( 'fs/promises' );
	return {
		readFile: fsPromises.readFile,
		writeFile: fsPromises.writeFile,
	};
} );

let configDir: string;

function createMessage(
	id: string,
	role: DevelopmentProjectChatMessage[ 'role' ] = 'user'
): DevelopmentProjectChatMessage {
	return {
		id,
		role,
		content: `Message ${ id }`,
	};
}

describe( 'development project chat state', () => {
	beforeEach( async () => {
		configDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-development-chat-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	} );

	afterEach( async () => {
		vi.unstubAllEnvs();
		await fs.rm( configDir, { force: true, recursive: true } );
	} );

	it( 'loads empty chat state when no chat file exists', async () => {
		await expect( loadDevelopmentProjectChatState( 'project-a' ) ).resolves.toEqual( {
			projectId: 'project-a',
			messages: [],
			updatedAt: undefined,
		} );
	} );

	it( 'saves chat messages by development project id', async () => {
		await saveDevelopmentProjectChatState( 'project-a', [
			createMessage( '1', 'user' ),
			createMessage( '2', 'assistant' ),
		] );
		await saveDevelopmentProjectChatState( 'project-b', [ createMessage( '3', 'user' ) ] );

		await expect( loadDevelopmentProjectChatState( 'project-a' ) ).resolves.toMatchObject( {
			projectId: 'project-a',
			messages: [ createMessage( '1', 'user' ), createMessage( '2', 'assistant' ) ],
		} );
		await expect( loadDevelopmentProjectChatState( 'project-b' ) ).resolves.toMatchObject( {
			projectId: 'project-b',
			messages: [ createMessage( '3', 'user' ) ],
		} );

		const chatStateFiles = await fs.readdir( getDevelopmentChatStateDirectory() );
		expect( chatStateFiles.sort() ).toEqual( [
			'project-project-a.json',
			'project-project-b.json',
		] );

		const storedChat = JSON.parse(
			await fs.readFile( getDevelopmentChatStatePath( 'project-a' ), 'utf8' )
		);
		expect( storedChat ).toMatchObject( {
			projectId: 'project-a',
			messages: [ createMessage( '1', 'user' ), createMessage( '2', 'assistant' ) ],
		} );
	} );

	it( 'keeps the latest stored messages for each project', async () => {
		const messages = Array.from( { length: 105 }, ( _unused, index ) =>
			createMessage( String( index + 1 ) )
		);

		const state = await saveDevelopmentProjectChatState( 'project-a', messages );

		expect( state.messages ).toHaveLength( 100 );
		expect( state.messages[ 0 ].id ).toBe( '6' );
		expect( state.messages[ 99 ].id ).toBe( '105' );
	} );
} );
