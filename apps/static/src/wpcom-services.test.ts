import { getProviderServices } from '@studio/providers/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaticSites } from './sites';
import { WpcomAuth } from './wpcom-auth';
import { WpcomServices } from './wpcom-services';

describe( 'WordPress.com visibility on the web', () => {
	const auth = new WpcomAuth();
	const services = new WpcomServices( auth, new StaticSites( async () => false ) );
	const visibility = getProviderServices( 'wpcom' ).sites!.visibility!;
	const details = {
		visibility: 'private' as const,
		url: 'https://example.blog',
		availableValues: [ 'private' as const ],
		message: 'Restricted by the provider.',
	};

	beforeEach( () => {
		vi.spyOn( auth, 'token' ).mockResolvedValue( {
			accessToken: 'web-token',
			id: 1,
			email: 'demo@example.com',
			displayName: 'Demo',
		} );
		vi.spyOn( visibility, 'get' ).mockResolvedValue( details );
		vi.spyOn( visibility, 'set' ).mockResolvedValue( details );
	} );

	afterEach( () => vi.restoreAllMocks() );

	it( 'reads and saves through the same provider as desktop, retaining access restrictions', async () => {
		await expect( services.getSiteVisibility( 42 ) ).resolves.toEqual( details );
		await expect( services.setSiteVisibility( 42, 'private' ) ).resolves.toEqual( details );
		expect( visibility.get ).toHaveBeenCalledWith( { token: 'web-token' }, 42 );
		expect( visibility.set ).toHaveBeenCalledWith( { token: 'web-token' }, 42, 'private' );
	} );

	it( 'requires sign-in before reading or changing access', async () => {
		vi.mocked( auth.token ).mockResolvedValue( null );
		await expect( services.getSiteVisibility( 42 ) ).rejects.toThrow( 'Sign in' );
		await expect( services.setSiteVisibility( 42, 'public' ) ).rejects.toThrow( 'Sign in' );
		expect( visibility.get ).not.toHaveBeenCalled();
		expect( visibility.set ).not.toHaveBeenCalled();
	} );
} );
