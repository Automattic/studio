import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { ShareDialog } from './index';
import type { Connector, SiteDetails, Snapshot } from '@/data/core';

// Sync activity outlives a render, so every test shares its own site.
let siteCount = 0;

function renderDialog(
	previews: Partial< Snapshot >[] = [],
	overrides: Partial< Connector > = {}
) {
	const site: SiteDetails = {
		id: `site-${ ++siteCount }`,
		name: 'Ada Portfolio',
		path: '/tmp/ada',
		port: 8881,
		running: true,
		phpVersion: '8.3',
	};
	const connector = {
		capabilities: {},
		getAuthUser: vi
			.fn()
			.mockResolvedValue( { id: 1, email: 'ada@example.com', displayName: 'Ada' } ),
		getUserPreferences: vi.fn().mockResolvedValue( {} ),
		getSnapshots: vi.fn().mockResolvedValue(
			previews.map( ( preview, index ) => ( {
				url: `ada-${ index }.wp.build`,
				atomicSiteId: index + 1,
				localSiteId: site.id,
				date: Date.now() - index,
				userId: 1,
				...preview,
			} ) )
		),
		getSnapshotUsage: vi.fn().mockResolvedValue( {
			siteCount: previews.length,
			siteLimit: 10,
			siteCreationBlocked: false,
		} ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		getSiteThumbnail: vi.fn().mockResolvedValue( null ),
		getPublishCheckoutUrl: vi.fn().mockReturnValue( undefined ),
		publishPreviewSite: vi.fn( () => new Promise( () => {} ) ),
		renameSnapshot: vi.fn().mockResolvedValue( undefined ),
		copyText: vi.fn().mockResolvedValue( undefined ),
		trackEvent: vi.fn(),
		...overrides,
	} as unknown as Connector;
	const onOpenChange = vi.fn();
	const queryClient = new QueryClient( { defaultOptions: { queries: { retry: false } } } );
	render(
		<QueryClientProvider client={ queryClient }>
			<ConnectorProvider connector={ connector }>
				<ShareDialog site={ site } open onOpenChange={ onOpenChange } />
			</ConnectorProvider>
		</QueryClientProvider>
	);
	return { connector, site, onOpenChange };
}

describe( 'ShareDialog', () => {
	it( 'publishes a preview only when asked to', async () => {
		const { connector, site } = renderDialog();

		await userEvent.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
		expect( connector.publishPreviewSite ).toHaveBeenCalledOnce();
		expect( connector.publishPreviewSite ).toHaveBeenCalledWith( site.id, undefined, undefined );
	} );

	it( 'watches for the return from checkout before opening it, and keeps a failure to open it', async () => {
		const { connector, site, onOpenChange } = renderDialog( [ {} ], {
			getPublishCheckoutUrl: vi.fn().mockReturnValue( 'https://wordpress.com/checkout' ),
			watchForPublishedSite: vi.fn().mockResolvedValue( undefined ),
			openExternalUrl: vi
				.fn()
				.mockRejectedValueOnce( new Error( 'Unable to open checkout' ) )
				.mockResolvedValue( undefined ),
		} );
		const watch = vi.mocked( connector.watchForPublishedSite! );
		const open = vi.mocked( connector.openExternalUrl );

		await userEvent.click( await screen.findByRole( 'button', { name: 'Choose a plan' } ) );

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Unable to open checkout' );
		expect( watch ).toHaveBeenCalledWith( site.id );
		expect( watch.mock.invocationCallOrder[ 0 ] ).toBeLessThan(
			open.mock.invocationCallOrder[ 0 ]
		);
		expect( onOpenChange ).not.toHaveBeenCalled();

		await userEvent.click( screen.getByRole( 'button', { name: 'Choose a plan' } ) );

		await waitFor( () => expect( onOpenChange ).toHaveBeenCalledWith( false ) );
	} );

	it( 'copies the link and updates the preview it shows', async () => {
		const { connector, site } = renderDialog( [ { name: 'Ada Portfolio' } ] );

		await userEvent.click( await screen.findByRole( 'button', { name: 'Copy link' } ) );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://ada-0.wp.build' );

		await userEvent.click( screen.getByRole( 'button', { name: 'Update preview' } ) );
		expect( connector.publishPreviewSite ).toHaveBeenCalledWith(
			site.id,
			'ada-0.wp.build',
			undefined
		);
	} );

	it( 'renames a preview, and shows a new one publishing from the preview actions', async () => {
		const { connector, site } = renderDialog( [ { name: 'Ada Portfolio' } ] );

		await userEvent.click( await screen.findByRole( 'button', { name: 'Preview actions' } ) );
		await userEvent.click( await screen.findByRole( 'menuitem', { name: 'Rename…' } ) );
		const name = screen.getByLabelText( 'Preview name' );
		await userEvent.clear( name );
		await userEvent.type( name, 'Homepage draft{Enter}' );
		expect( connector.renameSnapshot ).toHaveBeenCalledWith( 'ada-0.wp.build', 'Homepage draft' );

		await userEvent.click( screen.getByRole( 'button', { name: 'Preview actions' } ) );
		await userEvent.click( await screen.findByRole( 'menuitem', { name: 'New preview' } ) );
		expect( connector.publishPreviewSite ).toHaveBeenCalledWith( site.id, undefined, undefined );
		expect( await screen.findByRole( 'button', { name: 'Publishing preview…' } ) ).toBeVisible();

		// The new preview stays one pick away while another is shown.
		await userEvent.click( screen.getByRole( 'combobox', { name: 'Select preview' } ) );
		expect(
			await screen.findByRole( 'option', { name: 'New preview · Publishing…' } )
		).toBeInTheDocument();
		await userEvent.click( screen.getByRole( 'option', { name: 'Ada Portfolio' } ) );
		expect( await screen.findByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
		expect( screen.getByRole( 'combobox', { name: 'Select preview' } ) ).toBeInTheDocument();
	} );
} );
