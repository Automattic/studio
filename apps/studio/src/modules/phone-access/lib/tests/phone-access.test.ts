import { describe, expect, it, vi } from 'vitest';
import { createPhoneAccess } from 'src/modules/phone-access/lib/phone-access';
import type {
	RemoteConnectionKind,
	RemoteConnectionRequest,
} from '@studio/common/lib/remote-connection';
import type { PhoneAccessParts, RemoteChild } from 'src/modules/phone-access/lib/phone-access';

// Where a fake `studio remote` listens over each connection; Automatic takes
// the local network here.
function addressOf( connection: RemoteConnectionKind, port: number ) {
	return {
		https: `https://my-mac.tail1234.ts.net:${ port }`,
		tailnet: `http://100.101.102.103:${ port }`,
		local: `http://192.168.1.20:${ port }`,
	}[ connection ];
}

// A fake `studio remote`: writes the running server's record once it has
// started, and can stop or fail like the real one. With `slowStop`, it ends a
// moment after it is asked to, as the real one does.
function setup(
	options: {
		remembered?: number;
		enabled?: boolean;
		busy?: number[];
		slowStop?: boolean;
		connection?: RemoteConnectionRequest;
		lastUrl?: string;
		fallbackReason?: string;
	} = {}
) {
	let record:
		| { url: string; pid: number; connection?: RemoteConnectionKind; fallbackReason?: string }
		| undefined;
	const alive = new Set< number >();
	const settings = {
		enabled: options.enabled ?? false,
		port: options.remembered,
		connection: options.connection ?? ( 'auto' as RemoteConnectionRequest ),
		url: options.lastUrl,
	};
	const children: Array< {
		port: number;
		connection: RemoteConnectionRequest;
		child: RemoteChild;
		exit: ( message?: string ) => void;
	} > = [];
	let nextPid = 100;

	const parts: PhoneAccessParts = {
		readServer: vi.fn( async () => record ),
		isAlive: ( pid ) => alive.has( pid ),
		isPortFree: vi.fn( async ( port: number ) => ! ( options.busy ?? [] ).includes( port ) ),
		startRemote: vi.fn( ( port: number, connection: RemoteConnectionRequest ) => {
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
			children.push( { port, connection, child, exit } );
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
				const connection = latest.connection === 'auto' ? 'local' : latest.connection;
				record = {
					url: addressOf( connection, latest.port ),
					pid: latest.child.pid ?? -1,
					connection,
					fallbackReason: options.fallbackReason,
				};
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
			connection: 'local',
			portChanged: false,
		} );
		expect( parts.startRemote ).toHaveBeenCalledWith( 8083, 'auto' );
		expect( settings ).toEqual( {
			enabled: true,
			port: 8083,
			connection: 'auto',
			url: 'http://192.168.1.20:8083',
		} );
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
			connection: 'local',
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
			connection: undefined,
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

	// Turning off reports a failed save, so the switch does not look off while
	// the config still has it on; the other saves do not stop remote mode.
	it( 'reports a switch it could not save as off, after stopping remote mode', async () => {
		const { access, children, parts } = setup();
		await access.turnOn();
		vi.mocked( parts.saveSettings ).mockRejectedValue( new Error( 'Config lock timed out' ) );

		await expect( access.turnOff() ).rejects.toThrow( 'Config lock timed out' );

		expect( children[ 0 ].child.stop ).toHaveBeenCalled();
		expect( await access.getState() ).toEqual( { status: 'off' } );
	} );

	// A plain function, not a mock: a mock's promise always has a handler, so its
	// rejection would never count as unhandled.
	const failingSave = async () => {
		throw new Error( 'Config lock timed out' );
	};

	it( 'runs remote mode even when the switch cannot be saved as on', async () => {
		const { access, parts } = setup();
		parts.saveSettings = failingSave;

		expect( await access.turnOn() ).toMatchObject( { status: 'on' } );
	} );

	it( 'turns the switch off with the reason even when the switch cannot be saved', async () => {
		const { access, children, parts } = setup();
		await access.turnOn();
		parts.saveSettings = failingSave;

		const unhandled = vi.fn();
		process.on( 'unhandledRejection', unhandled );
		try {
			children[ 0 ].exit();
			await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );
		} finally {
			process.off( 'unhandledRejection', unhandled );
		}

		expect( unhandled ).not.toHaveBeenCalled();
		expect( await access.getState() ).toEqual( {
			status: 'error',
			message: 'Remote mode stopped.',
		} );
	} );

	it( 'gives up when remote mode does not start in time, and stops it', async () => {
		const { access, parts, children } = setup( { connection: 'local' } );
		vi.mocked( parts.sleep ).mockImplementation( async () => undefined );

		expect( await access.turnOn() ).toEqual( {
			status: 'error',
			message: 'Remote mode did not start within 15 seconds.',
		} );
		expect( children[ 0 ].child.stop ).toHaveBeenCalled();
	} );

	it( 'waits longer when the connection can be Tailscale HTTPS, which checks its own address first', async () => {
		for ( const connection of [ 'auto', 'https', 'tailnet' ] as const ) {
			const { access, parts } = setup( { connection } );
			vi.mocked( parts.sleep ).mockImplementation( async () => undefined );

			expect( await access.turnOn() ).toEqual( {
				status: 'error',
				message: 'Remote mode did not start within 90 seconds.',
			} );
		}
	} );

	it( 'starts over the saved connection and shows the one remote mode runs on', async () => {
		const { access, parts } = setup( { connection: 'https' } );

		expect( await access.turnOn() ).toMatchObject( {
			status: 'on',
			url: 'https://my-mac.tail1234.ts.net:8082',
			connection: 'https',
		} );
		expect( parts.startRemote ).toHaveBeenCalledWith( 8082, 'https' );
	} );

	it( 'saves a new connection, and starts a running remote mode again on it', async () => {
		const { access, parts, children, settings } = setup();
		await access.turnOn();

		const state = await access.setConnection( 'tailnet' );

		expect( children[ 0 ].child.stop ).toHaveBeenCalled();
		expect( parts.startRemote ).toHaveBeenLastCalledWith( 8082, 'tailnet' );
		expect( settings.connection ).toBe( 'tailnet' );
		// Another address: phones paired at the old one must pair again.
		expect( state ).toEqual( {
			status: 'on',
			url: 'http://100.101.102.103:8082',
			connection: 'tailnet',
			portChanged: false,
			movedFrom: 'http://192.168.1.20:8082',
		} );
		expect( await access.getConnection() ).toBe( 'tailnet' );
	} );

	it( 'says nothing when a new connection keeps the address', async () => {
		const { access } = setup();
		await access.turnOn();

		expect( await access.setConnection( 'local' ) ).toMatchObject( {
			status: 'on',
			url: 'http://192.168.1.20:8082',
			movedFrom: undefined,
		} );
	} );

	it( 'says phones must pair again when remote mode starts at another address than last time', async () => {
		const { access } = setup( { connection: 'tailnet', lastUrl: 'http://192.168.1.20:8082' } );

		expect( await access.turnOn() ).toMatchObject( {
			url: 'http://100.101.102.103:8082',
			movedFrom: 'http://192.168.1.20:8082',
		} );
	} );

	it( 'reads "starting" while a new connection restarts remote mode, and a turn-off then wins', async () => {
		const { access, settings, children } = setup( { slowStop: true } );
		await access.turnOn();

		const changing = access.setConnection( 'tailnet' );
		// While the old child stops: the window a turn-off used to slip through.
		await vi.waitFor( () => expect( children[ 0 ].child.stop ).toHaveBeenCalled(), {
			interval: 1,
		} );
		expect( await access.getState() ).toEqual( { status: 'starting' } );
		const off = await access.turnOff();
		await changing;

		expect( off ).toEqual( { status: 'off' } );
		expect( settings.enabled ).toBe( false );
		expect( children.at( -1 )?.child.stop ).toHaveBeenCalled();
		expect( await access.getState() ).toEqual( { status: 'off' } );
	} );

	it( 'passes on why Automatic did not take a safer connection', async () => {
		const reason = 'Tailscale HTTPS did not start. error enabling https feature: access denied';
		const { access } = setup( { fallbackReason: reason } );

		expect( await access.turnOn() ).toMatchObject( { status: 'on', fallbackReason: reason } );
	} );

	it( 'only saves a new connection while remote mode is off', async () => {
		const { access, parts, settings } = setup();

		expect( await access.setConnection( 'local' ) ).toEqual( { status: 'off' } );

		expect( settings.connection ).toBe( 'local' );
		expect( parts.startRemote ).not.toHaveBeenCalled();
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
		expect( on.parts.startRemote ).toHaveBeenCalledWith( 8098, 'auto' );

		on.access.stop();
		expect( on.children[ 0 ].child.stop ).toHaveBeenCalled();
		expect( on.settings.enabled ).toBe( true );
		expect( await on.access.getState() ).toEqual( { status: 'off' } );
	} );
} );
