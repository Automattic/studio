import {
	createPairingCode,
	getRemoteInstanceId,
	revokePairingCode,
} from '@studio/common/lib/remote-access';
import { toString as renderQrCode } from 'qrcode';
import { expect, it, vi } from 'vitest';
import { createPhonePairingCode } from 'src/modules/phone-access/lib/pairing-code';

vi.mock( '@studio/common/lib/remote-access', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/remote-access') >() ),
	createPairingCode: vi.fn(),
	getRemoteInstanceId: vi.fn(),
	revokePairingCode: vi.fn(),
} ) );

it( 'gives the code to type and the QR code of the pairing link', async () => {
	vi.mocked( createPairingCode ).mockResolvedValue( { code: 'ABCD2345EFGH', expiresAt: 1000 } );
	vi.mocked( getRemoteInstanceId ).mockResolvedValue( 'instance-1' );

	const pairing = await createPhonePairingCode( 'http://192.168.1.20:8082' );

	const link =
		'studio-remote://pair?url=http%3A%2F%2F192.168.1.20%3A8082&code=ABCD2345EFGH&id=instance-1';
	expect( pairing ).toEqual( {
		address: 'http://192.168.1.20:8082',
		code: 'ABCD-2345-EFGH',
		expiresAt: 1000,
		qrSvg: await renderQrCode( link, { type: 'svg', margin: 4 } ),
	} );
	expect( pairing.qrSvg ).toMatch( /^<svg / );
} );

it( 'revokes the code it showed before when it makes a new one', async () => {
	vi.mocked( getRemoteInstanceId ).mockResolvedValue( 'instance-1' );
	vi.mocked( createPairingCode )
		.mockResolvedValueOnce( { code: 'AAAA2345EFGH', expiresAt: 1000 } )
		.mockResolvedValueOnce( { code: 'BBBB2345EFGH', expiresAt: 2000 } );

	await createPhonePairingCode( 'http://192.168.1.20:8082' );
	await createPhonePairingCode( 'http://192.168.1.20:8082' );

	expect( revokePairingCode ).toHaveBeenLastCalledWith( 'AAAA2345EFGH' );
} );

it( 'makes one code at a time, so each one replaces the one before', async () => {
	vi.mocked( getRemoteInstanceId ).mockResolvedValue( 'instance-1' );
	vi.mocked( createPairingCode )
		.mockResolvedValueOnce( { code: 'CCCC2345EFGH', expiresAt: 3000 } )
		.mockResolvedValueOnce( { code: 'DDDD2345EFGH', expiresAt: 4000 } );
	vi.mocked( revokePairingCode ).mockClear();

	await Promise.all( [
		createPhonePairingCode( 'http://192.168.1.20:8082' ),
		createPhonePairingCode( 'http://192.168.1.20:8082' ),
	] );

	expect( vi.mocked( revokePairingCode ).mock.calls ).toEqual( [
		[ 'BBBB2345EFGH' ],
		[ 'CCCC2345EFGH' ],
	] );
} );
