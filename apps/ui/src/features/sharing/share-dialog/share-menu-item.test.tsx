import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { subscribeHeaderPanelRequest } from '@/data/use-open-header-panel';
import { SessionUIProvider } from '@/data/use-session-ui';
import { Menu } from '@/lib/ui';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteShareMenuItem } from './share-menu-item';

it( 'recovers from a failed preview copy and keeps the sharing dialog accessible', async () => {
	const site = makeSite( { id: 'share-menu' } );
	const copyText = vi
		.fn( async () => {} )
		.mockRejectedValueOnce( new Error( 'Clipboard unavailable' ) );
	const openExternalUrl = vi.fn( async () => {} );
	const publishPreviewSite = vi.fn( async () => ( { url: 'https://new.example.com' } ) );
	const preview = {
		atomicSiteId: 1,
		localSiteId: site.id,
		userId: TEST_USER.id,
		url: 'review.example.com',
		shareUrl: 'https://review.example.com/?share=review-token',
		name: 'Design review',
		date: Date.now(),
	};
	const connector = createFakeConnector(
		{ sites: [ site ], user: TEST_USER },
		{
			publishPreviewSite,
			copyText,
			openExternalUrl,
			getSnapshots: async () => [
				preview,
				{ ...preview, atomicSiteId: 2, name: 'Expired', date: 0 },
				{ ...preview, atomicSiteId: 3, localSiteId: 'other', name: 'Other site' },
			],
		}
	);
	const requested = vi.fn();
	const unsubscribe = subscribeHeaderPanelRequest( site.id, 'share', requested );
	try {
		renderWithProviders(
			<SessionUIProvider>
				<Menu.Root>
					<Menu.Trigger>Actions</Menu.Trigger>
					<Menu.Popup>
						<SiteShareMenuItem site={ site } disabled={ false } />
					</Menu.Popup>
				</Menu.Root>
			</SessionUIProvider>,
			{ connector }
		);
		const open = async () => {
			fireEvent.click( await screen.findByRole( 'button', { name: 'Actions' } ) );
			await waitFor( () =>
				expect( screen.getByRole( 'menuitem', { name: 'Share' } ) ).toHaveAttribute(
					'aria-haspopup',
					'menu'
				)
			);
			const share = screen.getByRole( 'menuitem', { name: 'Share' } );
			fireEvent.keyDown( share, { key: 'ArrowRight' } );
		};
		await open();
		fireEvent.keyDown( await screen.findByRole( 'menuitem', { name: 'Copy links' } ), {
			key: 'ArrowRight',
		} );
		expect( screen.queryByRole( 'menuitem', { name: 'Expired' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'menuitem', { name: 'Other site' } ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Design review' } ) );
		await waitFor( () => expect( copyText ).toHaveBeenCalledWith( preview.shareUrl ) );
		await waitFor( () =>
			expect( getVisibleToasts().some( ( notice ) => notice.title === 'Could not copy' ) ).toBe(
				true
			)
		);
		await open();
		fireEvent.keyDown( await screen.findByRole( 'menuitem', { name: 'Copy links' } ), {
			key: 'ArrowRight',
		} );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Design review' } ) );
		await waitFor( () =>
			expect( getVisibleToasts().some( ( notice ) => notice.title === 'Link copied' ) ).toBe( true )
		);
		expect(
			getVisibleToasts().some( ( notice ) => notice.title === 'Could not copy' && ! notice.leaving )
		).toBe( false );
		await open();
		fireEvent.keyDown( await screen.findByRole( 'menuitem', { name: 'Visit previews' } ), {
			key: 'ArrowRight',
		} );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Design review' } ) );
		await waitFor( () => expect( openExternalUrl ).toHaveBeenCalledWith( preview.shareUrl ) );
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Create preview' } ) );
		await waitFor( () =>
			expect( publishPreviewSite ).toHaveBeenCalledWith( site.id, undefined, undefined )
		);
		expect( requested ).not.toHaveBeenCalled();
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Manage sharing' } ) );
		expect( requested ).toHaveBeenCalledWith( { panel: 'share', siteId: site.id } );
	} finally {
		unsubscribe();
	}
} );

it.each( [ 'signed out', 'at the preview limit', 'blocked', 'offline', 'busy' ] )(
	'prevents creation when %s',
	async ( condition ) => {
		const site = makeSite( { id: `creation-${ condition }` } );
		const originalOnline = Object.getOwnPropertyDescriptor( window.navigator, 'onLine' );
		if ( condition === 'offline' ) {
			Object.defineProperty( window.navigator, 'onLine', { configurable: true, value: false } );
		}
		const connector = createFakeConnector(
			{ sites: [ site ], user: condition === 'signed out' ? null : TEST_USER },
			{
				getSnapshotUsage: async () => ( {
					siteCount: condition === 'at the preview limit' ? 5 : 0,
					siteLimit: 5,
					siteCreationBlocked: condition === 'blocked',
				} ),
			}
		);
		try {
			renderWithProviders(
				<SessionUIProvider>
					<Menu.Root>
						<Menu.Trigger>Actions</Menu.Trigger>
						<Menu.Popup>
							<SiteShareMenuItem site={ site } disabled={ condition === 'busy' } />
						</Menu.Popup>
					</Menu.Root>
				</SessionUIProvider>,
				{ connector }
			);
			fireEvent.click( await screen.findByRole( 'button', { name: 'Actions' } ) );
			const share = await screen.findByRole( 'menuitem', { name: 'Share' } );
			if ( condition === 'busy' ) {
				expect( share ).toHaveAttribute( 'aria-disabled', 'true' );
				return;
			}
			fireEvent.keyDown( share, { key: 'ArrowRight' } );
			expect( await screen.findByRole( 'menuitem', { name: 'Create preview' } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			);
			expect( screen.getByRole( 'menuitem', { name: 'Manage sharing' } ) ).not.toHaveAttribute(
				'aria-disabled',
				'true'
			);
			expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		} finally {
			if ( condition === 'offline' ) {
				if ( originalOnline ) Object.defineProperty( window.navigator, 'onLine', originalOnline );
				else Reflect.deleteProperty( window.navigator, 'onLine' );
			}
		}
	}
);
