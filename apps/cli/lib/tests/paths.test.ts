import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_HOME = process.env.STUDIO_PROCESS_MANAGER_HOME;

async function loadPaths( daemonHome?: string ) {
	vi.resetModules();
	if ( daemonHome === undefined ) {
		delete process.env.STUDIO_PROCESS_MANAGER_HOME;
	} else {
		process.env.STUDIO_PROCESS_MANAGER_HOME = daemonHome;
	}
	return import( '../paths' );
}

describe( 'process manager socket paths on Windows', () => {
	beforeEach( () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
	} );

	afterEach( () => {
		Object.defineProperty( process, 'platform', { value: ORIGINAL_PLATFORM } );
		if ( ORIGINAL_HOME === undefined ) {
			delete process.env.STUDIO_PROCESS_MANAGER_HOME;
		} else {
			process.env.STUDIO_PROCESS_MANAGER_HOME = ORIGINAL_HOME;
		}
		vi.resetModules();
	} );

	it( 'keeps the historical pipe names for the default daemon home', async () => {
		const paths = await loadPaths();

		expect( paths.PROCESS_MANAGER_CONTROL_SOCKET_PATH ).toBe( '\\\\.\\pipe\\studio-daemon.sock' );
		expect( paths.PROCESS_MANAGER_EVENTS_SOCKET_PATH ).toBe(
			'\\\\.\\pipe\\studio-daemon-events.sock'
		);
		expect( paths.getWindowsPipePath( 'studio-events' ) ).toBe( '\\\\.\\pipe\\studio-events.sock' );
	} );

	it( 'gives a custom daemon home its own pipe names', async () => {
		const paths = await loadPaths( 'C:\\tmp\\scd-1234abcd' );

		expect( paths.PROCESS_MANAGER_CONTROL_SOCKET_PATH ).toMatch(
			/^\\\\\.\\pipe\\studio-daemon-[0-9a-f]{8}\.sock$/
		);
		expect( paths.PROCESS_MANAGER_EVENTS_SOCKET_PATH ).toMatch(
			/^\\\\\.\\pipe\\studio-daemon-events-[0-9a-f]{8}\.sock$/
		);
		expect( paths.getWindowsPipePath( 'studio-events' ) ).toMatch(
			/^\\\\\.\\pipe\\studio-events-[0-9a-f]{8}\.sock$/
		);
	} );

	it( 'derives the names deterministically and distinctly per home', async () => {
		const first = await loadPaths( 'C:\\tmp\\scd-first' );
		const firstAgain = await loadPaths( 'C:\\tmp\\scd-first' );
		const second = await loadPaths( 'C:\\tmp\\scd-second' );

		expect( firstAgain.PROCESS_MANAGER_CONTROL_SOCKET_PATH ).toBe(
			first.PROCESS_MANAGER_CONTROL_SOCKET_PATH
		);
		expect( second.PROCESS_MANAGER_CONTROL_SOCKET_PATH ).not.toBe(
			first.PROCESS_MANAGER_CONTROL_SOCKET_PATH
		);
	} );
} );
