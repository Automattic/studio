import {
	buildPairingUrl,
	createPairingCode,
	formatPairingCode,
	getRemoteInstanceId,
	revokePairingCode,
} from '@studio/common/lib/remote-access';
import { toString as renderQrCode } from 'qrcode';

// A one-time pairing code for the Studio phone app: the address and the code
// to type by hand, when the code expires, and the QR code of the pairing link
// as SVG, which holds all three.
export interface PhonePairingCode {
	address: string;
	code: string;
	expiresAt: number;
	qrSvg: string;
}

// The last code this app showed. A new code replaces it on screen, so the old
// one stops working then instead of at its expiry.
let shown: string | undefined;
// One code at a time, so two requests at once cannot both replace the same one.
let previous: Promise< unknown > = Promise.resolve();

// For the remote mode running at `url`. Like `studio remote pair`, it writes
// the code to Studio's config, where that server reads it.
export function createPhonePairingCode( url: string ): Promise< PhonePairingCode > {
	const next = previous.then( () => makePairingCode( url ) );
	previous = next.catch( () => undefined );
	return next;
}

async function makePairingCode( url: string ): Promise< PhonePairingCode > {
	if ( shown ) {
		await revokePairingCode( shown );
		shown = undefined;
	}
	const instanceId = await getRemoteInstanceId();
	const { code, expiresAt } = await createPairingCode();
	shown = code;
	const link = buildPairingUrl( { url, code, instanceId } );
	return {
		address: url,
		code: formatPairingCode( code ),
		expiresAt,
		// A quiet zone of four modules, as the QR code standard asks.
		qrSvg: await renderQrCode( link, { type: 'svg', margin: 4 } ),
	};
}
