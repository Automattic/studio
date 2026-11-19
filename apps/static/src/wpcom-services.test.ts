import { getProviderServices } from '@studio/providers/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaticSites } from './sites';
import * as store from './store';
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

describe( 'preview launch links on the web', () => {
	const auth = new WpcomAuth();
	const services = new WpcomServices( auth, new StaticSites( async () => false ) );
	const snapshot = {
		atomicSiteId: 42,
		localSiteId: 'local',
		userId: 1,
		date: 1000,
		url: 'preview.wpcomstaging.com',
		launchUrl: 'https://wordpress.com/stale',
	};
	beforeEach( () => {
		vi.spyOn( auth, 'requireToken' ).mockResolvedValue( 'web-token' );
		vi.spyOn( auth, 'user' ).mockResolvedValue( {
			id: 1,
			email: 'demo@example.com',
			displayName: 'Demo',
		} );
		vi.spyOn( store, 'kvGet' ).mockResolvedValue( [ snapshot ] );
	} );
	afterEach( () => vi.restoreAllMocks() );
	it( 'refreshes the launch link and expiry from the same server data as desktop', async () => {
		const launchUrl =
			'https://wordpress.com/setup/launch-site?siteId=42&checkout_source=studio-preview-site';
		const request = vi
			.spyOn( getProviderServices( 'wpcom' ).sites!.previews!, 'list' )
			.mockResolvedValue( [
				{
					id: 42,
					name: 'Preview',
					url: 'https://preview.wpcomstaging.com',
					launchUrl,
					expiresAt: 9000000,
					shareUrl: 'https://preview.wpcomstaging.com/?share=link',
				},
			] );
		await expect( services.getSnapshots() ).resolves.toEqual( [
			{
				...snapshot,
				launchUrl,
				expiresAt: 9000000,
				liveSiteId: undefined,
				shareUrl: 'https://preview.wpcomstaging.com/?share=link',
			},
		] );
		expect( request ).toHaveBeenCalledExactlyOnceWith( { token: 'web-token' } );
	} );
	it.each( [ 'missing', 'linked', 'failed' ] )(
		'does not offer a stale upgrade URL when the server is %s',
		async ( state ) => {
			const request = vi.spyOn( getProviderServices( 'wpcom' ).sites!.previews!, 'list' );
			if ( state === 'failed' ) request.mockRejectedValue( new Error( 'Offline' ) );
			else
				request.mockResolvedValue(
					state === 'linked'
						? [
								{ id: 42, name: 'Preview', url: 'https://preview.wpcomstaging.com', liveSiteId: 7 },
						  ]
						: []
				);
			const snapshots = await services.getSnapshots();
			expect( snapshots ).toHaveLength( 1 );
			expect( snapshots[ 0 ] ).toMatchObject( {
				atomicSiteId: 42,
				url: snapshot.url,
				launchUrl: undefined,
			} );
		}
	);
	it( 'does not request launch links for legacy previews', async () => {
		const legacy = { ...snapshot, url: 'legacy.wp.build', launchUrl: undefined };
		vi.mocked( store.kvGet ).mockResolvedValue( [ legacy ] );
		const request = vi.spyOn( getProviderServices( 'wpcom' ).sites!.previews!, 'list' );
		await expect( services.getSnapshots() ).resolves.toEqual( [ legacy ] );
		expect( request ).not.toHaveBeenCalled();
	} );
} );
