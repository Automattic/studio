import { describe, expect, it, vi } from 'vitest';
import { createPhoneAccess } from 'src/modules/phone-access/lib/phone-access';
import type { PhoneAccessParts, RemoteChild } from 'src/modules/phone-access/lib/phone-access';

// A fake `studio remote`: writes the running server's record once it has
// started, and can stop or fail like the real one. With `slowStop`, it ends a
// moment after it is asked to, as the real one does.
function setup(
	options: { remembered?: number; enabled?: boolean; busy?: number[]; slowStop?: boolean } = {}
) {
	let record: { url: string; pid: number } | undefined;
	const alive = new Set< number >();
	const settings = { enabled: options.enabled ?? false, port: options.remembered };
	const children: Array< {
		port: number;
		child: RemoteChild;
		exit: ( message?: string ) => void;
	} > = [];
	let nextPid = 100;

	const parts: PhoneAccessParts = {
		readServer: vi.fn( async () => record ),
		isAlive: ( pid ) => alive.has( pid ),
		isPortFree: vi.fn( async ( port: number ) => ! ( options.busy ?? [] ).includes( port ) ),
		startRemote: vi.fn( ( port: number ) => {
			const pid = nextPid++;
			let listener: ( ( message?: string ) => void ) | undefined;
			const exit = ( message?: string ) => {
				alive.delete( pid );
				if ( record?.pid === pid ) {
					record = undefined;
				}
				listener?.( message );
			};
			const child: RemoteChild = {
				pid,
				onExit: ( callback ) => {
					listener = callback;
				},
				stop: vi.fn( () => {
					if ( options.slowStop ) {
						setTimeout( () => exit(), 5 );
					} else {
						exit();
					}
				} ),
			};
			children.push( { port, child, exit } );
			alive.add( pid );
			return child;
		} ),
		loadSettings: vi.fn( async () => ( { ...settings } ) ),
		saveSettings: vi.fn( async ( update ) => {
			Object.assign( settings, update );
		} ),
		// Each wait lets the latest child finish starting.
		sleep: vi.fn( async () => {
			const latest = children.at( -1 );
			if ( latest && alive.has( latest.child.pid ?? -1 ) && ! record ) {
				record = { url: `http://192.168.1.20:${ latest.port }`, pid: latest.child.pid ?? -1 };
			}
		} ),
	};
	return {
		parts,
		settings,
		children,
		access: createPhoneAccess( parts ),
		// A `studio remote` started in a terminal.
		startInTerminal: ( url: string, pid = 50 ) => {
			alive.add( pid );
			record = { url, pid };
		},
	};
}

describe( 'createPhoneAccess', () => {
	it( 'starts remote mode on the first free port from 8082, and remembers the switch and the port', async () => {
		const { access, parts, settings } = setup( { busy: [ 8082 ] } );

		expect( await access.getState() ).toEqual( { status: 'off' } );
		const state = await access.turnOn();

		expect( state ).toEqual( {
			status: 'on',
			url: 'http://192.168.1.20:8083',
			portChanged: false,
		} );
		expect( parts.startRemote ).toHaveBeenCalledWith( 8083 );
		expect( settings ).toEqual( { enabled: true, port: 8083 } );
		expect( await access.getState() ).toEqual( state );
	} );

	it( 'keeps the remembered port, and says so when it had to take another one', async () => {
		const same = setup( { remembered: 8098 } );
		expect( await same.access.turnOn() ).toMatchObject( {
			url: 'http://192.168.1.20:8098',
			portChanged: false,
		} );

		const moved = setup( { remembered: 8098, busy: [ 8098 ] } );
		expect( await moved.access.turnOn() ).toEqual( {
			status: 'on',
			url: 'http://192.168.1.20:8082',
			portChanged: true,
		} );
		expect( moved.settings.port ).toBe( 8082 );
	} );

	it( 'stops its remote mode when turned off, and forgets the switch', async () => {
		const { access, children, settings } = setup();
		await access.turnOn();

		expect( await access.turnOff() ).toEqual( { status: 'off' } );

		expect( children[ 0 ].child.stop ).toHaveBeenCalled();
		expect( settings.enabled ).toBe( false );
		expect( await access.getState() ).toEqual( { status: 'off' } );
	} );

	it( 'uses a remote mode started in a terminal, and leaves it alone', async () => {
		const { access, parts, settings, startInTerminal } = setup();
		startInTerminal( 'http://192.168.1.20:8098' );

		expect( await access.getState() ).toEqual( {
			status: 'terminal',
			url: 'http://192.168.1.20:8098',
		} );
		expect( await access.turnOn() ).toEqual( {
			status: 'terminal',
			url: 'http://192.168.1.20:8098',
		} );
		expect( await access.turnOff() ).toEqual( {
			status: 'terminal',
			url: 'http://192.168.1.20:8098',
		} );
		expect( parts.startRemote ).not.toHaveBeenCalled();
		// Nothing ran, so nothing comes back by itself at the next launch.
		expect( settings.enabled ).toBe( false );
	} );

	it( 'turns the switch off with the reason when remote mode fails or stops by itself', async () => {
		const failing = setup();
		vi.mocked( failing.parts.sleep ).mockImplementationOnce( async () => {
			failing.children[ 0 ].exit( 'No network address found. Pass one with --host.' );
		} );
		expect( await failing.access.turnOn() ).toEqual( {
			status: 'error',
			message: 'No network address found. Pass one with --host.',
		} );
		expect( failing.settings.enabled ).toBe( false );

		const stopping = setup();
		await stopping.access.turnOn();
		stopping.children[ 0 ].exit();
		expect( await stopping.access.getState() ).toEqual( {
			status: 'error',
			message: 'Remote mode stopped.',
		} );
		expect( stopping.settings.enabled ).toBe( false );

		// Turning it on again tries again.
		expect( await stopping.access.turnOn() ).toMatchObject( { status: 'on' } );
	} );

	it( 'gives up when remote mode does not start in time, and stops it', async () => {
		const { access, parts, children } = setup();
		vi.mocked( parts.sleep ).mockImplementation( async () => undefined );

		expect( await access.turnOn() ).toEqual( {
			status: 'error',
			message: 'Remote mode did not start within 15 seconds.',
		} );
		expect( children[ 0 ].child.stop ).toHaveBeenCalled();
	} );

	it( 'waits for its own remote mode to end before it can start again', async () => {
		const { access, parts } = setup( { slowStop: true } );
		await access.turnOn();

		expect( await access.turnOff() ).toEqual( { status: 'off' } );
		expect( await access.turnOn() ).toMatchObject( { status: 'on' } );

		expect( parts.startRemote ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'does not take its own remote mode for a terminal one while it stops', async () => {
		const { access } = setup( { slowStop: true } );
		await access.turnOn();

		const turningOff = access.turnOff();

		expect( await access.getState() ).toEqual( { status: 'off' } );
		await turningOff;
	} );

	it( 'turns the switch off when remote mode ends while the switch is saved on', async () => {
		const { access, parts, settings, children } = setup();
		vi.mocked( parts.saveSettings ).mockImplementationOnce( async ( update ) => {
			Object.assign( settings, update );
			children[ 0 ].exit( 'Address already in use.' );
		} );

		expect( await access.turnOn() ).toEqual( {
			status: 'error',
			message: 'Address already in use.',
		} );
		expect( settings.enabled ).toBe( false );
	} );

	it( 'starts nothing once the app quits', async () => {
		const { access, parts } = setup( { enabled: true } );

		access.stop();
		await access.startIfEnabled();

		expect( parts.startRemote ).not.toHaveBeenCalled();
	} );

	it( 'keeps the switch when the app quits while remote mode starts', async () => {
		const { access, parts, settings, children } = setup( { enabled: true, remembered: 8098 } );
		vi.mocked( parts.sleep ).mockImplementationOnce( async () => access.stop() );

		await access.startIfEnabled();

		expect( children[ 0 ].child.stop ).toHaveBeenCalled();
		expect( settings.enabled ).toBe( true );
		expect( parts.saveSettings ).not.toHaveBeenCalledWith( { enabled: false } );
		expect( await access.getState() ).toEqual( { status: 'off' } );
	} );

	it( 'starts once when turned on twice at the same time', async () => {
		const { access, parts } = setup();

		const [ first, second ] = await Promise.all( [ access.turnOn(), access.turnOn() ] );

		expect( first ).toEqual( second );
		expect( parts.startRemote ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'starts at launch only when the switch was on, and stops at quit without forgetting it', async () => {
		const off = setup();
		await off.access.startIfEnabled();
		expect( off.parts.startRemote ).not.toHaveBeenCalled();

		const on = setup( { enabled: true, remembered: 8098 } );
		await on.access.startIfEnabled();
		expect( on.parts.startRemote ).toHaveBeenCalledWith( 8098 );

		on.access.stop();
		expect( on.children[ 0 ].child.stop ).toHaveBeenCalled();
		expect( on.settings.enabled ).toBe( true );
		expect( await on.access.getState() ).toEqual( { status: 'off' } );
	} );
} );
