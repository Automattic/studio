import { signToken, verifyToken } from '@studio/common/lib/signed-token';

const inAnHour = () => Math.floor( Date.now() / 1000 ) + 3600;

describe( 'signed tokens', () => {
	it( 'returns the claims of a token signed with the same secret and purpose', async () => {
		const token = await signToken( { purpose: 'session', sub: '42', exp: inAnHour() }, 'secret' );
		await expect( verifyToken( token, 'secret', 'session' ) ).resolves.toMatchObject( {
			sub: '42',
		} );
	} );

	it( 'rejects another secret, another purpose, an expired token and a tampered one', async () => {
		const token = await signToken( { purpose: 'session', sub: '42', exp: inAnHour() }, 'secret' );
		const expired = await signToken( { purpose: 'session', exp: 1 }, 'secret' );
		const [ header, , signature ] = token.split( '.' );
		const forged = `${ header }.${ btoa(
			JSON.stringify( { purpose: 'session', sub: '1', exp: inAnHour() } )
		) }.${ signature }`;

		await expect( verifyToken( token, 'other', 'session' ) ).resolves.toBeNull();
		await expect( verifyToken( token, 'secret', 'site' ) ).resolves.toBeNull();
		await expect( verifyToken( expired, 'secret', 'session' ) ).resolves.toBeNull();
		await expect( verifyToken( forged, 'secret', 'session' ) ).resolves.toBeNull();
	} );
} );
