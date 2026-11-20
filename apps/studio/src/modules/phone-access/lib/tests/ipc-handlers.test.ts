import { readTailscaleState } from '@studio/common/lib/tailscale';
import { describe, expect, it, vi } from 'vitest';
import { phoneAccess } from 'src/modules/phone-access/lib/app-phone-access';
import {
	getPhoneConnections,
	getPhonePairingCode,
	setPhoneAccess,
	setPhoneConnection,
} from 'src/modules/phone-access/lib/ipc-handlers';
import { createPhonePairingCode } from 'src/modules/phone-access/lib/pairing-code';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'src/modules/phone-access/lib/app-phone-access', () => ( {
	phoneAccess: {
		getState: vi.fn(),
		turnOn: vi.fn(),
		turnOff: vi.fn(),
		getConnection: vi.fn(),
		setConnection: vi.fn(),
	},
} ) );
vi.mock( '@studio/common/lib/tailscale', () => ( { readTailscaleState: vi.fn() } ) );
vi.mock( '@studio/common/lib/network-address', () => ( {
	getDefaultLanAddress: () => '192.168.1.20',
} ) );
vi.mock( 'src/modules/phone-access/lib/pairing-code', () => ( {
	createPhonePairingCode: vi.fn(),
} ) );

const event = {} as IpcMainInvokeEvent;

describe( 'phone access IPC handlers', () => {
	it( 'turns remote mode on and off', async () => {
		await setPhoneAccess( event, true );
		expect( phoneAccess.turnOn ).toHaveBeenCalled();
		await setPhoneAccess( event, false );
		expect( phoneAccess.turnOff ).toHaveBeenCalled();
	} );

	it( 'makes a code for the running remote mode, and none when it is off', async () => {
		vi.mocked( phoneAccess.getState ).mockResolvedValueOnce( {
			status: 'terminal',
			url: 'http://192.168.1.20:8098',
		} );
		await getPhonePairingCode( event );
		expect( createPhonePairingCode ).toHaveBeenCalledWith( 'http://192.168.1.20:8098' );

		vi.mocked( phoneAccess.getState ).mockResolvedValueOnce( { status: 'off' } );
		await expect( getPhonePairingCode( event ) ).rejects.toThrow( 'Remote mode is not running.' );
	} );

	it( "lists the connections with what each still needs, from Tailscale's state", async () => {
		vi.mocked( phoneAccess.getConnection ).mockResolvedValueOnce( 'auto' );
		vi.mocked( readTailscaleState ).mockResolvedValueOnce( {
			installed: true,
			running: true,
			ipv4: '100.101.102.103',
			dnsName: 'my-mac.tail1234.ts.net',
			httpsReady: false,
		} );

		expect( await getPhoneConnections( event ) ).toEqual( {
			request: 'auto',
			automatic: 'tailnet',
			options: [
				{ kind: 'https', missing: 'tailscale-https' },
				{ kind: 'tailnet', missing: undefined },
				{ kind: 'local', missing: undefined },
			],
		} );
	} );

	it( 'sets a known connection only', async () => {
		await setPhoneConnection( event, 'tailnet' );
		expect( phoneAccess.setConnection ).toHaveBeenCalledWith( 'tailnet' );

		expect( () =>
			setPhoneConnection( event, 'funnel' as Parameters< typeof setPhoneConnection >[ 1 ] )
		).toThrow( 'Unknown connection.' );
	} );
} );
