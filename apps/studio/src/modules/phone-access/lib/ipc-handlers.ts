import { listRemoteDevices, revokeRemoteDevice } from '@studio/common/lib/remote-access';
import { phoneAccess } from 'src/modules/phone-access/lib/app-phone-access';
import { createPhonePairingCode } from 'src/modules/phone-access/lib/pairing-code';
import type { RemoteDevice } from '@studio/common/lib/remote-access';
import type { IpcMainInvokeEvent } from 'electron';
import type { PhonePairingCode } from 'src/modules/phone-access/lib/pairing-code';
import type { PhoneAccessState } from 'src/modules/phone-access/lib/phone-access';

export function getPhoneAccess( _event: IpcMainInvokeEvent ): Promise< PhoneAccessState > {
	return phoneAccess.getState();
}

export function setPhoneAccess(
	_event: IpcMainInvokeEvent,
	on: boolean
): Promise< PhoneAccessState > {
	return on ? phoneAccess.turnOn() : phoneAccess.turnOff();
}

// A code only for a remote mode that runs: the app's own or a terminal's.
export async function getPhonePairingCode(
	_event: IpcMainInvokeEvent
): Promise< PhonePairingCode > {
	const state = await phoneAccess.getState();
	if ( state.status !== 'on' && state.status !== 'terminal' ) {
		throw new Error( 'Remote mode is not running.' );
	}
	return createPhonePairingCode( state.url );
}

export function getPairedPhones( _event: IpcMainInvokeEvent ): Promise< RemoteDevice[] > {
	return listRemoteDevices();
}

export async function removePairedPhone( _event: IpcMainInvokeEvent, id: string ): Promise< void > {
	await revokeRemoteDevice( id );
}
