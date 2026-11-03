import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { subscribeHeaderPanelRequest } from '@/data/use-open-header-panel';
import { SessionUIProvider } from '@/data/use-session-ui';
import { Menu } from '@/lib/ui';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteShareMenuItem } from './share-menu-item';

it( 'copies an active preview and keeps the sharing dialog accessible', async () => {
	const site = makeSite( { id: 'share-menu' } );
	const copyText = vi.fn( async () => {} );
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
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Design review' } ) );
		await waitFor( () => expect( copyText ).toHaveBeenCalledWith( preview.shareUrl ) );
		await open();
		fireEvent.keyDown( await screen.findByRole( 'menuitem', { name: 'Visit previews' } ), {
			key: 'ArrowRight',
		} );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Design review' } ) );
		await waitFor( () =>
			expect( openExternalUrl ).toHaveBeenCalledWith(
				'https://review.example.com/wp-login.php?redirect_to=https%3A%2F%2Freview.example.com%2F'
			)
		);
		await open();
		expect( screen.queryByRole( 'menuitem', { name: 'Expired' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'menuitem', { name: 'Other site' } ) ).not.toBeInTheDocument();
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
