import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { ConnectionsTab } from './connections-tab';
import type { SiteDetails, SyncSite } from '@/data/core';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: vi.fn(),
} ) );

vi.mock( '@/components/site-toolbar/publish-site-dialog', () => ( {
	PublishSiteDialog: () => <div>Connect dialog</div>,
} ) );

vi.mock( '@/components/site-toolbar/disconnect-site-dialog', () => ( {
	DisconnectSiteDialog: () => <div>Disconnect dialog</div>,
} ) );

const SITE = {
	id: 'site-1',
	name: 'Demo Site',
	path: '/Users/example/Studio/demo-site',
} as SiteDetails;

const CONNECTION = {
	id: 42,
	localSiteId: SITE.id,
	name: 'Demo production',
	url: 'https://demo.wordpress.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'already-connected',
	lastPullTimestamp: null,
	lastPushTimestamp: new Date().toISOString(),
} as SyncSite;

describe( 'ConnectionsTab', () => {
	const openExternalUrl = vi.fn().mockResolvedValue( undefined );
	const copyText = vi.fn().mockResolvedValue( undefined );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useConnector ).mockReturnValue( { openExternalUrl, copyText } as never );
		vi.mocked( useConnectedWpcomSites ).mockReturnValue( {
			data: [ CONNECTION ],
		} as never );
	} );

	it( 'uses compact URL-first connection rows', () => {
		renderTab();

		expect(
			screen.getByText(
				'Add one or more remote sites, then choose where to push changes or where to pull them from.'
			)
		).toBeVisible();
		expect( screen.getByText( 'demo.wordpress.com' ) ).toBeVisible();
		expect( screen.getByText( 'Production' ) ).toBeVisible();
		expect( screen.getByText( /Pushed .* ago/ ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Disconnect' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps open and copy as icon actions and disconnect in overflow', async () => {
		const user = userEvent.setup();
		renderTab();

		await user.click( screen.getByRole( 'button', { name: 'Open site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Copy URL' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith( 'https://demo.wordpress.com' );
		expect( copyText ).toHaveBeenCalledWith( 'https://demo.wordpress.com' );

		await user.click( screen.getByRole( 'button', { name: 'More options' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Disconnect' } ) );
		expect( screen.getByText( 'Disconnect dialog' ) ).toBeVisible();
	} );
} );

function renderTab() {
	return render(
		<Tooltip.Provider>
			<ConnectionsTab site={ SITE } />
		</Tooltip.Provider>
	);
}
