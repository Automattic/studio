import {
	buildPairingUrl,
	createPairingCode,
	formatPairingCode,
	getRemoteInstanceId,
} from '@studio/common/lib/remote-access';
import { __, sprintf } from '@wordpress/i18n';
import { toString as renderQrCode } from 'qrcode';

// Mints a one-time code for the server at `serverUrl` and prints it as a QR
// code, with the address and code in text for typing by hand.
export async function printPairingCode( serverUrl: string ): Promise< void > {
	const instanceId = await getRemoteInstanceId();
	const { code } = await createPairingCode();
	const pairingUrl = buildPairingUrl( { url: serverUrl, code, instanceId } );

	console.log( await renderQrCode( pairingUrl, { type: 'terminal', small: true } ) );
	console.log( sprintf( __( 'Address: %s' ), serverUrl ) );
	console.log( sprintf( __( 'Pairing code: %s' ), formatPairingCode( code ) ) );
	console.log( __( 'The code works once and expires in 5 minutes.' ) );
}
