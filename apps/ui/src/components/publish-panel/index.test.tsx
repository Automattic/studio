import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { PublishButton } from './index';
import type { Connector, SiteDetails, SyncSite } from '@/data/core';

// Sync activity outlives a render, so every test publishes its own site.
let siteCount = 0;

const site: SiteDetails = {
	id: 'site',
	name: 'Ada Portfolio',
	path: '/tmp/ada',
	port: 8881,
	running: true,
	phpVersion: '8.3',
};

const remote: SyncSite = {
	id: 101,
	localSiteId: 'site-1',
	name: 'Ada Portfolio',
	url: 'https://ada.wordpress.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'already-connected',
	lastPullTimestamp: null,
	lastPushTimestamp: '2026-10-21T07:40:00.000Z',
};

function renderButton( overrides: Partial< Connector > = {} ) {
	const testSite = { ...site, id: `site-${ ++siteCount }` };
	const connector = {
		capabilities: {},
		getAuthUser: vi
			.fn()
			.mockResolvedValue( { id: 1, email: 'ada@example.com', displayName: 'Ada' } ),
		getUserPreferences: vi.fn().mockResolvedValue( {} ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [ remote ] ),
		fetchSyncableWpcomSites: vi
			.fn()
			.mockResolvedValue( [ { ...remote, syncSupport: 'syncable' } ] ),
		listLocalFileTree: vi.fn().mockResolvedValue( [
			{
				name: 'plugins',
				isDirectory: true,
				path: 'wp-content/plugins',
				children: [
					{ name: 'akismet', isDirectory: true, path: 'wp-content/plugins/akismet' },
					{
						name: 'shared',
						isDirectory: true,
						isSymlink: true,
						path: 'wp-content/plugins/shared',
					},
				],
			},
		] ),
		getDirectorySize: vi.fn().mockResolvedValue( 1024 ),
		getFileSize: vi.fn().mockResolvedValue( 1 ),
		getIsMultisite: vi.fn().mockResolvedValue( false ),
		getWpVersion: vi.fn().mockResolvedValue( '6.8' ),
		getHostingPhpVersion: vi.fn().mockResolvedValue( '8.3' ),
		pushSiteToLive: vi.fn().mockResolvedValue( undefined ),
		trackEvent: vi.fn(),
		...overrides,
	} as unknown as Connector;
	const queryClient = new QueryClient( { defaultOptions: { queries: { retry: false } } } );
	render(
		<QueryClientProvider client={ queryClient }>
			<ConnectorProvider connector={ connector }>
				<PublishButton site={ testSite } />
			</ConnectorProvider>
		</QueryClientProvider>
	);
	return { connector, site: testSite };
}

describe( 'PublishButton', () => {
	it( 'publishes the whole site to the connected website', async () => {
		const { connector, site } = renderButton();

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		expect( await screen.findByText( 'ada.wordpress.com' ) ).toBeInTheDocument();
		await userEvent.click( await screen.findByRole( 'button', { name: 'Publish' } ) );

		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, remote.id, {
				optionsToSync: [ 'all' ],
			} )
		);
	} );

	it( 'marks symbolic links and publishes only the files picked', async () => {
		const { connector, site } = renderButton();

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		const scope = await screen.findByRole( 'button', { name: 'What to publish' } );
		await waitFor( () => expect( scope ).toBeEnabled() );
		await userEvent.click( scope );
		await userEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Choose files…' } ) );
		await userEvent.click( await screen.findByRole( 'button', { name: 'Expand plugins' } ) );
		await userEvent.click( screen.getByRole( 'checkbox', { name: 'shared (symbolic link)' } ) );
		await userEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await userEvent.click( await screen.findByRole( 'button', { name: 'Publish' } ) );

		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, remote.id, {
				optionsToSync: [ 'plugins' ],
				specificSelectionPaths: [ 'plugins/shared' ],
			} )
		);
	} );

	it( 'asks a signed-out user to create an account or log in', async () => {
		renderButton( { getAuthUser: vi.fn().mockResolvedValue( null ) } );

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );

		expect( await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Create account' } ) ).toBeInTheDocument();
	} );
} );
