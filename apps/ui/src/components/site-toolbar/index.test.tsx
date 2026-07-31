import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { usePullSiteFromLive, usePushSiteToLive } from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { SiteToolbar } from './index';
import type { SiteDetails, SyncSite } from '@/data/core';

vi.mock( '@tanstack/react-query', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useIsMutating: () => 0,
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( { useAgenticFeatures: vi.fn() } ) );
vi.mock( '@/data/queries/use-auth-user', () => ( { useLogin: vi.fn() } ) );
vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: vi.fn(),
} ) );
vi.mock( '@/data/queries/use-preview-site', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	usePublishPreviewSite: vi.fn(),
} ) );
vi.mock( '@/data/queries/use-snapshots', () => ( { useSnapshots: vi.fn() } ) );
vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useStartSite: () => ( { mutate: vi.fn() } ),
	useStopSite: () => ( { mutate: vi.fn() } ),
} ) );
vi.mock( '@/data/queries/use-sync-site', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	usePullSiteFromLive: vi.fn(),
	usePushSiteToLive: vi.fn(),
	useDisconnectWpcomSite: () => ( { mutate: vi.fn(), isPending: false } ),
} ) );
vi.mock( '@/data/sync-activity', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useSiteSyncActivity: vi.fn(),
} ) );

const SITE = {
	id: 'riff',
	name: 'Riff',
	path: '/Users/dev/Studio/riff',
	running: true,
	port: 8882,
	url: 'http://localhost:8882',
} as unknown as SiteDetails;

function liveSite( overrides: Partial< SyncSite > = {} ): SyncSite {
	return {
		id: 42,
		localSiteId: 'riff',
		name: 'Riff',
		url: 'https://riff.wordpress.com',
		isStaging: false,
		isPressable: false,
		syncSupport: 'already-connected',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...overrides,
	};
}

function renderToolbar( {
	sidebarCollapsed = false,
	...props
}: Partial< Parameters< typeof SiteToolbar >[ 0 ] > & { sidebarCollapsed?: boolean } = {} ) {
	return render(
		<SidebarCollapsedContext.Provider value={ sidebarCollapsed }>
			<Tooltip.Provider>
				<SiteToolbar site={ SITE } { ...props } />
			</Tooltip.Provider>
		</SidebarCollapsedContext.Provider>
	);
}

describe( 'SiteToolbar', () => {
	beforeEach( () => {
		// The push/pull direction and chosen connection are remembered per site.
		window.localStorage.clear();
		vi.mocked( useConnector ).mockReturnValue( {
			openExternalUrl: vi.fn(),
			copyText: vi.fn().mockResolvedValue( undefined ),
		} as never );
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			reason: null,
			isReady: true,
		} );
		vi.mocked( useLogin ).mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		vi.mocked( useConnectedWpcomSites ).mockReturnValue( { data: [] } as never );
		vi.mocked( useSnapshots ).mockReturnValue( { data: [] } as never );
		vi.mocked( usePublishPreviewSite ).mockReturnValue( {
			mutate: vi.fn(),
			isPending: false,
		} as never );
		vi.mocked( usePushSiteToLive ).mockReturnValue( { mutate: vi.fn() } as never );
		vi.mocked( usePullSiteFromLive ).mockReturnValue( { mutate: vi.fn() } as never );
		vi.mocked( useIsSiteStarting ).mockReturnValue( false );
		vi.mocked( useIsSiteStopping ).mockReturnValue( false );
		vi.mocked( useSiteSyncActivity ).mockReturnValue( null );
	} );

	it( 'shows the site identity and its local address', () => {
		renderToolbar();

		expect( screen.getByText( 'Riff' ) ).toBeVisible();
		expect( screen.getByText( 'localhost:8882' ) ).toBeVisible();
	} );

	it( 'leaves the run-state control to the sidebar while the sidebar is open', () => {
		renderToolbar();

		expect(
			screen.queryByRole( 'button', { name: /Site status: Running/ } )
		).not.toBeInTheDocument();
	} );

	it( 'takes over the run-state control once the sidebar is collapsed', () => {
		renderToolbar( { sidebarCollapsed: true } );

		expect(
			screen.getByRole( 'button', { name: /Site status: Running\. Stop site/ } )
		).toBeVisible();
	} );

	it( 'puts Publish in the toolbar itself rather than behind a menu', () => {
		renderToolbar();

		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
		expect( screen.queryByText( 'No live site' ) ).not.toBeInTheDocument();
	} );

	it( 'offers both push and pull once a live site is connected', () => {
		vi.mocked( useConnectedWpcomSites ).mockReturnValue( { data: [ liveSite() ] } as never );
		renderToolbar();

		// Icon-only, so the accessible name is all there is to go on.
		expect( screen.getByRole( 'button', { name: 'Pull' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Push' } ) ).toBeVisible();
	} );

	it( 'keeps the action in place while a push is uploading, and fills it', () => {
		vi.mocked( useConnectedWpcomSites ).mockReturnValue( { data: [ liveSite() ] } as never );
		vi.mocked( useSiteSyncActivity ).mockReturnValue( {
			kind: 'pending',
			direction: 'push',
			phase: 'uploading',
			progress: 62,
		} );
		renderToolbar();

		const push = screen.getByRole( 'button', { name: 'Push' } );
		expect( push ).toBeVisible();
		expect( push.querySelector( '[style*="62%"]' ) ).not.toBeNull();
	} );

	describe( 'with both a production and a staging connection', () => {
		const production = liveSite( { id: 42, url: 'https://riff.com' } );
		const staging = liveSite( {
			id: 43,
			name: 'Riff (staging)',
			url: 'https://riff-staging.wpcomstaging.com',
			isStaging: true,
			lastPushTimestamp: '2026-07-30T10:00:00.000Z',
		} );

		beforeEach( () => {
			vi.mocked( useConnectedWpcomSites ).mockReturnValue( {
				data: [ staging, production ],
			} as never );
		} );

		it( 'shows both directions rather than a mode to set', () => {
			renderToolbar();

			expect( screen.getByRole( 'button', { name: 'Pull' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Push' } ) ).toBeVisible();
		} );
	} );

	it( 'pulls straight away when there is only one connection to pull from', async () => {
		const pull = vi.fn();
		vi.mocked( usePullSiteFromLive ).mockReturnValue( { mutate: pull } as never );
		vi.mocked( useConnectedWpcomSites ).mockReturnValue( { data: [ liveSite() ] } as never );
		const user = userEvent.setup();
		renderToolbar();

		await user.click( screen.getByRole( 'button', { name: 'Pull' } ) );

		expect( pull ).toHaveBeenCalledWith( { siteId: 'riff', remoteSiteId: 42 } );
	} );

	it( 'leaves a failed push pressable again, and says nothing in the header', () => {
		vi.mocked( useConnectedWpcomSites ).mockReturnValue( { data: [ liveSite() ] } as never );
		vi.mocked( useSiteSyncActivity ).mockReturnValue( {
			kind: 'error',
			direction: 'push',
			message: 'Backup timed out',
		} );
		renderToolbar();

		// The failure is a toast; the header just offers the move again.
		expect( screen.getByRole( 'button', { name: 'Push' } ) ).toBeEnabled();
		expect( screen.queryByText( 'Push failed' ) ).not.toBeInTheDocument();
	} );
} );
