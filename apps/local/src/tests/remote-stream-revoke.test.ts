import { mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { revokeRemoteDevice } from '@studio/common/lib/remote-access';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	openStream,
	pairDevice,
	request,
	settlesWithin,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

let test: TestRemoteServer;

beforeAll( async () => {
	test = await startRemoteTestServer( {
		remote: { label: 'Test Mac', studioVersion: '0.0.0-test', streamRecheckMs: 100 },
	} );
} );

afterAll( async () => {
	await test.stop();
} );

describe( 'event streams of revoked devices', () => {
	it( 'ends a stream when its device forgets the computer', async () => {
		const { token } = await pairDevice( test.server.port );
		const stream = await openStream( test.server.port, token );
		expect( stream.status ).toBe( 200 );
		try {
			const reply = await request( test.server.port, {
				method: 'DELETE',
				path: '/api/remote/devices/current',
				token,
			} );
			expect( reply.status ).toBe( 204 );
			expect( await settlesWithin( stream.ended, 1000 ) ).toBe( true );
		} finally {
			stream.destroy();
		}
	} );

	it( 'ends a stream when another process revokes the device', async () => {
		const { token, deviceId } = await pairDevice( test.server.port );
		const stream = await openStream( test.server.port, token );
		expect( stream.status ).toBe( 200 );
		try {
			await revokeRemoteDevice( deviceId );
			expect( await settlesWithin( stream.ended, 1000 ) ).toBe( true );
		} finally {
			stream.destroy();
		}
	} );

	it( 'keeps the stream of a device that was not revoked', async () => {
		const first = await pairDevice( test.server.port );
		const second = await pairDevice( test.server.port );
		const firstStream = await openStream( test.server.port, first.token );
		const secondStream = await openStream( test.server.port, second.token );
		try {
			await revokeRemoteDevice( first.deviceId );
			expect( await settlesWithin( firstStream.ended, 1000 ) ).toBe( true );
			expect( await settlesWithin( secondStream.ended, 400 ) ).toBe( false );
		} finally {
			firstStream.destroy();
			secondStream.destroy();
		}
	} );

	it( 'closes every stream when the store cannot be read', async () => {
		const { token } = await pairDevice( test.server.port );
		const stream = await openStream( test.server.port, token );
		expect( stream.status ).toBe( 200 );
		const storePath = path.join( test.configDir, 'remote.json' );
		const movedAside = `${ storePath }.aside`;
		renameSync( storePath, movedAside );
		// A directory where the file should be makes every read fail with EISDIR.
		mkdirSync( storePath );
		try {
			expect( await settlesWithin( stream.ended, 1000 ) ).toBe( true );
		} finally {
			rmSync( storePath, { recursive: true, force: true } );
			renameSync( movedAside, storePath );
			stream.destroy();
		}
	} );
} );
