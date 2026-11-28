import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	pairDevice,
	request,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

const capturePreview = vi.fn( async () => Buffer.from( 'jpeg' ) );
let test: TestRemoteServer;
let token: string;

beforeAll( async () => {
	test = await startRemoteTestServer( {
		cliBinary: path.join( import.meta.dirname, 'fixtures', 'fake-cli.mjs' ),
		capturePreview,
	} );
	( { token } = await pairDevice( test.server.port ) );
} );

afterAll( async () => {
	await test.stop();
} );

describe( "a paired phone's site preview", () => {
	it( 'gets a fresh screenshot of a running site', async () => {
		const reply = await request( test.server.port, {
			method: 'POST',
			path: '/api/sites/s1/screenshot',
			token,
			body: { layout: 'phone' },
		} );

		expect( reply.status ).toBe( 200 );
		expect( reply.json ).toEqual( {
			image: `data:image/jpeg;base64,${ Buffer.from( 'jpeg' ).toString( 'base64' ) }`,
			takenAt: expect.any( Number ),
		} );
		expect( capturePreview ).toHaveBeenCalledWith( 'http://localhost:8881', {
			width: 393,
			height: 852,
			scale: 3,
			format: 'jpeg',
		} );
	} );

	it( 'gets the stored screenshot, none here', async () => {
		const reply = await request( test.server.port, {
			path: '/api/sites/s1/thumbnail',
			token,
		} );

		expect( reply.status ).toBe( 200 );
		expect( reply.json ).toEqual( { thumbnail: null } );
	} );

	it( 'refuses a layout it does not know, a site it does not list, and a phone with no token', async () => {
		const shot = ( id: string, body: unknown, withToken = true ) =>
			request( test.server.port, {
				method: 'POST',
				path: `/api/sites/${ id }/screenshot`,
				token: withToken ? token : undefined,
				body,
			} );

		expect( ( await shot( 's1', { layout: 'tablet' } ) ).status ).toBe( 400 );
		expect( ( await shot( 'nope', { layout: 'phone' } ) ).status ).toBe( 404 );
		expect( ( await shot( 's1', { layout: 'phone' }, false ) ).status ).toBe( 401 );
	} );

	it( 'still blocks the capture that stores the screenshot', async () => {
		const reply = await request( test.server.port, {
			method: 'POST',
			path: '/api/sites/s1/capture-preview',
			token,
			body: { path: '/', width: 800, height: 600 },
		} );

		expect( reply.status ).toBe( 403 );
	} );
} );
