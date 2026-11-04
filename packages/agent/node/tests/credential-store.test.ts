import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCredentialStore, getOrCreateDeviceId } from '@studio/agent/node/credential-store';
import type { Credential } from '@earendil-works/pi-ai';

describe( 'FileCredentialStore', () => {
	let configDir: string;
	let previousDevConfigDir: string | undefined;
	const credentialsPath = () => path.join( configDir, 'ai-credentials.json' );
	const oauth: Credential = { type: 'oauth', access: 'access', refresh: 'refresh', expires: 1 };

	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-credentials-' ) );
		previousDevConfigDir = process.env.DEV_CONFIG_DIR;
		process.env.DEV_CONFIG_DIR = configDir;
	} );

	afterEach( () => {
		if ( previousDevConfigDir === undefined ) {
			delete process.env.DEV_CONFIG_DIR;
		} else {
			process.env.DEV_CONFIG_DIR = previousDevConfigDir;
		}
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'reads nothing before anything is stored', async () => {
		const store = new FileCredentialStore();
		await expect( store.read( 'openai' ) ).resolves.toBeUndefined();
		await expect( store.list() ).resolves.toEqual( [] );
	} );

	it( 'persists a credential to an owner-only file', async () => {
		const store = new FileCredentialStore();
		await expect( store.modify( 'openai', async () => oauth ) ).resolves.toEqual( oauth );

		await expect( new FileCredentialStore().read( 'openai' ) ).resolves.toEqual( oauth );
		await expect( store.list() ).resolves.toEqual( [ { providerId: 'openai', type: 'oauth' } ] );
		if ( process.platform !== 'win32' ) {
			expect( fs.statSync( credentialsPath() ).mode & 0o777 ).toBe( 0o600 );
		}
	} );

	it( 'leaves the credential unchanged when the update returns nothing', async () => {
		const store = new FileCredentialStore();
		await store.modify( 'openai', async () => oauth );

		await expect( store.modify( 'openai', async () => undefined ) ).resolves.toEqual( oauth );
		await expect( store.read( 'openai' ) ).resolves.toEqual( oauth );
	} );

	it( 'serializes concurrent updates', async () => {
		const store = new FileCredentialStore();
		await store.modify( 'openai', async () => ( { ...oauth, expires: 0 } ) );
		const bump = () =>
			store.modify( 'openai', async ( current ) => ( {
				...oauth,
				expires: ( current as typeof oauth ).expires + 1,
			} ) );

		await Promise.all( [ bump(), bump(), bump() ] );

		await expect( store.read( 'openai' ) ).resolves.toMatchObject( { expires: 3 } );
	} );

	it( 'deletes one provider and keeps the rest of the file', async () => {
		const store = new FileCredentialStore();
		const deviceId = await getOrCreateDeviceId();
		await store.modify( 'openai', async () => oauth );
		await store.modify( 'openrouter', async () => ( { type: 'api_key', key: 'sk-or' } ) );

		await store.delete( 'openai' );

		await expect( store.read( 'openai' ) ).resolves.toBeUndefined();
		await expect( store.read( 'openrouter' ) ).resolves.toEqual( {
			type: 'api_key',
			key: 'sk-or',
		} );
		await expect( getOrCreateDeviceId() ).resolves.toBe( deviceId );
	} );

	it( 'creates the device id once', async () => {
		const deviceId = await getOrCreateDeviceId();

		expect( deviceId ).toMatch( /^[0-9a-f-]{36}$/ );
		await expect( getOrCreateDeviceId() ).resolves.toBe( deviceId );
	} );
} );
