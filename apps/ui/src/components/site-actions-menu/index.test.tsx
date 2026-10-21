import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteActionsMenu } from './index';
import type { SiteDetails } from '@/data/core';

const { navigate, preview, startSite, stopSite, sites } = vi.hoisted( () => ( {
	navigate: vi.fn(),
	preview: { siteId: 'other', setSite: vi.fn(), updatePath: vi.fn(), setOpen: vi.fn() },
	startSite: { mutate: vi.fn(), mutateAsync: vi.fn() },
	stopSite: { mutate: vi.fn(), mutateAsync: vi.fn() },
	sites: [] as SiteDetails[],
} ) );

vi.mock( '@tanstack/react-router', () => ( { useNavigate: () => navigate } ) );
vi.mock( '@/data/core', () => ( { useConnector: () => ( { trackEvent: vi.fn() } ) } ) );
vi.mock( '@/hooks/use-session-ui', () => ( { useSessionPreviewUI: () => preview } ) );
vi.mock( '@/hooks/use-open-settings', () => ( { useOpenSettings: () => vi.fn() } ) );
vi.mock( '@/hooks/use-site-management-actions', () => ( {
	useSiteManagementActions: () =>
		[ 'duplicate', 'import', 'export', 'export-db', 'delete' ].map( ( id ) => ( {
			id,
			label: id,
			icon: <svg />,
			run: vi.fn(),
		} ) ),
} ) );
vi.mock( '@/components/open-in-menu/use-open-in-destinations', () => ( {
	useOpenInDestinations: () => [],
} ) );
vi.mock( '@/components/publish-panel/publish-menu', () => ( { SitePublishMenu: () => null } ) );
vi.mock( '@/components/share-dialog/share-menu-item', () => ( { SiteShareMenuItem: () => null } ) );
vi.mock( '@/components/delete-site-dialog', () => ( { DeleteSiteDialog: () => null } ) );
vi.mock( '@/components/import-site-dialog', () => ( {
	IMPORT_FILE_ACCEPT: '',
	ImportSiteDialog: () => null,
	useSiteBackupImport: () => ( {} ),
} ) );
vi.mock( '@/data/queries/use-sidebar-pins', () => ( {
	sitePinKey: ( id: string ) => `site:${ id }`,
	useSidebarPins: () => ( { isPinned: () => false, togglePin: vi.fn() } ),
} ) );
vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteBusy: () => false,
	useSites: () => ( { data: sites } ),
	useStartSite: () => startSite,
	useStopSite: () => stopSite,
} ) );

function createSite( id: string, running: boolean ): SiteDetails {
	return { id, name: id, path: `/sites/${ id }`, port: 8881, running } as SiteDetails;
}

async function choose( site: SiteDetails, submenu: string, item: string ) {
	render( <SiteActionsMenu site={ site } /> );
	fireEvent.click( screen.getByRole( 'button', { name: `Site actions for ${ site.name }` } ) );
	fireEvent.click( await screen.findByText( submenu ) );
	fireEvent.click( await screen.findByText( item ) );
}

describe( 'SiteActionsMenu', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'starts a stopped site before showing WP Admin in its preview', async () => {
		startSite.mutateAsync.mockResolvedValue( true );

		await choose( createSite( 'blog', false ), 'Go to', 'WordPress Admin' );

		await waitFor( () => expect( preview.setOpen ).toHaveBeenCalledWith( true ) );
		expect( startSite.mutateAsync ).toHaveBeenCalledWith( 'blog' );
		expect( preview.setSite ).toHaveBeenCalledWith( 'blog' );
		expect( preview.updatePath.mock.lastCall?.[ 0 ] ).toMatch(
			/^\/studio-auto-login\?redirect_to=/
		);
		expect( navigate ).toHaveBeenCalledWith( { to: '/sites/$siteId', params: { siteId: 'blog' } } );
	} );

	it( 'stops only the other running sites', async () => {
		const blog = createSite( 'blog', true );
		sites.splice( 0, sites.length, blog, createSite( 'shop', true ), createSite( 'docs', false ) );

		await choose( blog, 'Stop', 'Stop other sites' );

		expect( stopSite.mutate.mock.calls ).toEqual( [ [ 'shop' ] ] );
	} );
} );
