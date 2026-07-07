import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSessionId, readStateForChat, writeSessionId } from 'cli/remote-session/state';

describe( 'remote-session state', () => {
	let tmpDir: string;
	const originalEnv = { ...process.env };

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-remote-state-' ) );
		process.env = { ...originalEnv, DEV_CONFIG_DIR: tmpDir } as NodeJS.ProcessEnv;
	} );

	afterEach( () => {
		process.env = originalEnv;
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'returns null when no state file exists', async () => {
		expect( await readStateForChat( 1 ) ).toBeNull();
	} );

	it( 'persists and reads back a session id', async () => {
		await writeSessionId( 1, 'sess-abc' );
		const state = await readStateForChat( 1 );
		expect( state?.session_id ).toBe( 'sess-abc' );
		expect( state?.chat_id ).toBe( 1 );
		expect( state?.updated_at ).toBeTypeOf( 'string' );
	} );

	it( 'returns null when stored state is for a different chat', async () => {
		await writeSessionId( 1, 'sess-1' );
		expect( await readStateForChat( 2 ) ).toBeNull();
	} );

	it( 'clears the session id', async () => {
		await writeSessionId( 5, 'sess-5' );
		await clearSessionId( 5 );
		const state = await readStateForChat( 5 );
		expect( state?.session_id ).toBeUndefined();
		expect( state?.chat_id ).toBe( 5 );
	} );

	it( 'writes the state file with mode 0600 on posix', async () => {
		if ( process.platform === 'win32' ) {
			return;
		}
		await writeSessionId( 1, 'sess' );
		const stat = fs.statSync( path.join( tmpDir, 'remote-session-state.json' ) );
		expect( stat.mode & 0o777 ).toBe( 0o600 );
	} );
} );
