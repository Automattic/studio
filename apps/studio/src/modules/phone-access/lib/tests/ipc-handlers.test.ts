import { describe, expect, it, vi } from 'vitest';
import { phoneAccess } from 'src/modules/phone-access/lib/app-phone-access';
import { getPhonePairingCode, setPhoneAccess } from 'src/modules/phone-access/lib/ipc-handlers';
import { createPhonePairingCode } from 'src/modules/phone-access/lib/pairing-code';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'src/modules/phone-access/lib/app-phone-access', () => ( {
	phoneAccess: { getState: vi.fn(), turnOn: vi.fn(), turnOff: vi.fn() },
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
} );
