/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

async function loadPathsOnWindows( processManagerHome?: string ) {
	vi.resetModules();
	Object.defineProperty( process, 'platform', { value: 'win32' } );
	if ( processManagerHome ) {
		vi.stubEnv( 'STUDIO_PROCESS_MANAGER_HOME', processManagerHome );
	} else {
		delete process.env.STUDIO_PROCESS_MANAGER_HOME;
	}
	return import( '../paths' );
}

describe( 'process manager pipes on Windows', () => {
	afterEach( () => {
		Object.defineProperty( process, 'platform', { value: originalPlatform } );
		vi.unstubAllEnvs();
	} );

	it( 'keeps the original pipe names for the default daemon home', async () => {
		const paths = await loadPathsOnWindows();

		expect( paths.PROCESS_MANAGER_CONTROL_SOCKET_PATH ).toBe( '\\\\.\\pipe\\studio-daemon.sock' );
		expect( paths.PROCESS_MANAGER_EVENTS_SOCKET_PATH ).toBe(
			'\\\\.\\pipe\\studio-daemon-events.sock'
		);
	} );

	it( 'gives daemons with different homes different pipes', async () => {
		const first = await loadPathsOnWindows( 'C:\\Temp\\daemon-a' );
		const second = await loadPathsOnWindows( 'C:\\Temp\\daemon-b' );
		const again = await loadPathsOnWindows( 'C:\\Temp\\daemon-a' );

		expect( first.PROCESS_MANAGER_CONTROL_SOCKET_PATH ).not.toBe(
			second.PROCESS_MANAGER_CONTROL_SOCKET_PATH
		);
		expect( first.PROCESS_MANAGER_EVENTS_SOCKET_PATH ).not.toBe(
			second.PROCESS_MANAGER_EVENTS_SOCKET_PATH
		);
		expect( first.PROCESS_MANAGER_CONTROL_SOCKET_PATH ).not.toBe(
			'\\\\.\\pipe\\studio-daemon.sock'
		);
		expect( again.PROCESS_MANAGER_CONTROL_SOCKET_PATH ).toBe(
			first.PROCESS_MANAGER_CONTROL_SOCKET_PATH
		);
	} );
} );
