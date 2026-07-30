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

	it( 'reads token from the config file (bot + chat_id are optional)', async () => {
		fs.writeFileSync(
			path.join( tmpDir, 'remote-session.json' ),
			JSON.stringify( { token: 't' } )
		);
		const config = await loadRemoteSessionConfig();
		expect( config.token ).toBe( 't' );
		expect( config.bot ).toBeUndefined();
		expect( config.chat_id ).toBeUndefined();
		expect( config.base_url ).toMatch( /telegram-bot$/ );
		expect( config.poll_interval_seconds ).toBe( 2 );
	} );

	it( 'reads optional bot + chat_id when provided in the file', async () => {
		fs.writeFileSync(
			path.join( tmpDir, 'remote-session.json' ),
			JSON.stringify( { token: 't', bot: 'b', chat_id: 1 } )
		);
		const config = await loadRemoteSessionConfig();
		expect( config.bot ).toBe( 'b' );
		expect( config.chat_id ).toBe( 1 );
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

	it( 'throws RemoteSessionConfigError when no token is available anywhere', async () => {
		await expect( loadRemoteSessionConfig() ).rejects.toBeInstanceOf( RemoteSessionConfigError );
		try {
			await loadRemoteSessionConfig();
		} catch ( error ) {
			const e = error as RemoteSessionConfigError;
			expect( e.missingFields ).toEqual( [ 'token' ] );
		}
	} );

	it( 'falls back to the WordPress.com OAuth token when no token is provided', async () => {
		// Drop a shared.json with a non-expired token; this is what `studio code` /login writes.
		fs.writeFileSync(
			path.join( tmpDir, 'shared.json' ),
			JSON.stringify( {
				version: 1,
				authToken: {
					accessToken: 'wpcom-token-from-login',
					expiresIn: 1209600,
					expirationTime: Date.now() + 60_000,
					id: 1,
					email: 'a@b.test',
					displayName: 'a',
				},
			} )
		);
		// No CLI overrides at all — token comes from the shared.json fallback,
		// bot + chat_id stay undefined (the controller derives them per-message).
		const config = await loadRemoteSessionConfig();
		expect( config.token ).toBe( 'wpcom-token-from-login' );
		expect( config.bot ).toBeUndefined();
		expect( config.chat_id ).toBeUndefined();
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
