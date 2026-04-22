import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	RemoteSessionConfigError,
	loadRemoteSessionConfig,
	saveRemoteSessionConfig,
} from 'cli/remote-session/config';

describe( 'remote-session config', () => {
	let tmpDir: string;
	const originalEnv = { ...process.env };

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-remote-cfg-' ) );
		process.env = {
			...originalEnv,
			DEV_CONFIG_DIR: tmpDir,
			STUDIO_REMOTE_BASE_URL: undefined,
			STUDIO_REMOTE_TOKEN: undefined,
			STUDIO_REMOTE_BOT: undefined,
			STUDIO_REMOTE_CHAT_ID: undefined,
		} as NodeJS.ProcessEnv;
	} );

	afterEach( () => {
		process.env = originalEnv;
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'reads required fields from the config file', async () => {
		fs.writeFileSync(
			path.join( tmpDir, 'remote-session.json' ),
			JSON.stringify( { token: 't', bot: 'b', chat_id: 1 } )
		);
		const config = await loadRemoteSessionConfig();
		expect( config.token ).toBe( 't' );
		expect( config.bot ).toBe( 'b' );
		expect( config.chat_id ).toBe( 1 );
		expect( config.base_url ).toMatch( /telegram-bot$/ );
		expect( config.poll_interval_seconds ).toBe( 2 );
	} );

	it( 'lets env vars override file values', async () => {
		fs.writeFileSync(
			path.join( tmpDir, 'remote-session.json' ),
			JSON.stringify( { token: 'file-token', bot: 'file-bot', chat_id: 1 } )
		);
		process.env.STUDIO_REMOTE_TOKEN = 'env-token';
		process.env.STUDIO_REMOTE_CHAT_ID = '42';
		const config = await loadRemoteSessionConfig();
		expect( config.token ).toBe( 'env-token' );
		expect( config.chat_id ).toBe( 42 );
		expect( config.bot ).toBe( 'file-bot' );
	} );

	it( 'lets CLI overrides win over env vars', async () => {
		process.env.STUDIO_REMOTE_TOKEN = 'env';
		process.env.STUDIO_REMOTE_BOT = 'env-bot';
		process.env.STUDIO_REMOTE_CHAT_ID = '1';
		const config = await loadRemoteSessionConfig( { token: 'cli', bot: 'cli-bot', chat_id: 99 } );
		expect( config.token ).toBe( 'cli' );
		expect( config.bot ).toBe( 'cli-bot' );
		expect( config.chat_id ).toBe( 99 );
	} );

	it( 'throws RemoteSessionConfigError listing missing required fields', async () => {
		await expect( loadRemoteSessionConfig() ).rejects.toBeInstanceOf( RemoteSessionConfigError );
		try {
			await loadRemoteSessionConfig();
		} catch ( error ) {
			const e = error as RemoteSessionConfigError;
			expect( e.missingFields ).toEqual( expect.arrayContaining( [ 'token', 'bot', 'chat_id' ] ) );
		}
	} );

	it( 'saves the config file with mode 0600', async () => {
		await saveRemoteSessionConfig( {
			base_url: 'https://example.test/x',
			token: 't',
			bot: 'b',
			chat_id: 1,
			poll_interval_seconds: 2,
			long_poll_timeout_seconds: 25,
			max_message_chars: 3800,
			turn_timeout_seconds: 300,
		} );
		const stat = fs.statSync( path.join( tmpDir, 'remote-session.json' ) );
		// On posix, mask off the type bits and check the mode.
		if ( process.platform !== 'win32' ) {
			expect( stat.mode & 0o777 ).toBe( 0o600 );
		}
	} );
} );
