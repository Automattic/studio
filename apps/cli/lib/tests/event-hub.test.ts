import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinEventHub } from '../event-hub';
import { SocketRequestClient } from '../socket';

const endpoint =
	process.platform === 'win32'
		? `\\\\.\\pipe\\studio-event-hub-test-${ process.pid }`
		: path.join( os.tmpdir(), `eh-${ process.pid }.sock` );

describe( 'joinEventHub', () => {
	const leaves: ( () => Promise< void > )[] = [];

	afterEach( async () => {
		await Promise.all( leaves.splice( 0 ).map( ( leave ) => leave() ) );
	} );

	async function join() {
		const received: unknown[] = [];
		const leave = await joinEventHub( endpoint, ( message ) => received.push( message ) );
		leaves.push( leave );
		return { received, leave };
	}

	it( 'delivers each published event to every member', async () => {
		const hub = await join();
		const follower = await join();

		await new SocketRequestClient( endpoint ).send( { event: 'one' } );

		await vi.waitFor( () => {
			expect( hub.received ).toEqual( [ { event: 'one' } ] );
			expect( follower.received ).toEqual( [ { event: 'one' } ] );
		} );
	} );

	it( 'hands the hub over to a follower when the hub leaves', async () => {
		const hub = await join();
		const follower = await join();

		await hub.leave();
		await vi.waitFor( () => new SocketRequestClient( endpoint ).send( { event: 'two' } ) );

		await vi.waitFor( () => expect( follower.received ).toEqual( [ { event: 'two' } ] ) );
	} );
} );
