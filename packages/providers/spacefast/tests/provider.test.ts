import { afterEach, expect, it, vi } from 'vitest';
import { ConnectError, NotConnectedError } from '../../errors';
import { spacefastServices } from '../services';

afterEach( () => {
	vi.unstubAllGlobals();
} );

it( 'says when the user declined the sign-in', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn( async () => new Response( JSON.stringify( { data: { status: 'denied' } } ) ) )
	);

	await expect(
		spacefastServices.account.connect( 'sign-in', {
			deviceCode: 'dev_1',
			interval: '1',
			expiresAt: new Date( Date.now() + 60_000 ).toISOString(),
		} )
	).rejects.toEqual( new ConnectError( 'Spacefast sign-in was declined.', 'denied' ) );
} );

it( 'asks to connect again when the key no longer works', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () => new Response( JSON.stringify( { title: 'Unauthorized' } ), { status: 401 } )
		)
	);

	await expect( spacefastServices.sites!.list( { apiKey: 'sfa_old' } ) ).rejects.toBeInstanceOf(
		NotConnectedError
	);
} );
