import { describe, expect, it } from 'vitest';
import { DEFAULT_PROCESS_MANAGER_HOME, daemonPipePath } from '../lib/paths';

describe( 'daemonPipePath (Windows daemon socket isolation)', () => {
	it( 'keeps the original fixed pipe name for the default home (desktop/CLI still share one daemon)', () => {
		expect( daemonPipePath( 'studio-daemon', DEFAULT_PROCESS_MANAGER_HOME ) ).toBe(
			'\\\\.\\pipe\\studio-daemon.sock'
		);
		expect( daemonPipePath( 'studio-daemon-events', DEFAULT_PROCESS_MANAGER_HOME ) ).toBe(
			'\\\\.\\pipe\\studio-daemon-events.sock'
		);
	} );

	it( 'derives a per-home pipe name for a custom home so runs are isolated on Windows', () => {
		const a = daemonPipePath( 'studio-daemon', 'C:\\Temp\\home-a' );
		const b = daemonPipePath( 'studio-daemon', 'C:\\Temp\\home-b' );

		expect( a ).toMatch( /^\\\\\.\\pipe\\studio-daemon-[0-9a-f]{12}\.sock$/ );
		expect( a ).not.toBe( b );
		// Two custom homes must not collide with the default fixed pipe either.
		expect( a ).not.toBe( '\\\\.\\pipe\\studio-daemon.sock' );
	} );

	it( 'is deterministic for a given home so repeated CLI invocations reach the same daemon', () => {
		expect( daemonPipePath( 'studio-daemon', 'C:\\Temp\\home-a' ) ).toBe(
			daemonPipePath( 'studio-daemon', 'C:\\Temp\\home-a' )
		);
	} );

	it( 'namespaces distinct sockets so control/events/site-events do not collide for the same home', () => {
		const home = 'C:\\Temp\\home-a';
		const names = new Set( [
			daemonPipePath( 'studio-daemon', home ),
			daemonPipePath( 'studio-daemon-events', home ),
			daemonPipePath( 'studio-events', home ),
		] );
		expect( names.size ).toBe( 3 );
	} );
} );
