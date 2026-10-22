import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteActionsMenu } from './index';
import type { SiteDetails } from '@/data/core';

const { navigate, openSettings, preview, startSite, stopSite, sites, agents } = vi.hoisted(
	() => ( {
		navigate: vi.fn(),
		openSettings: vi.fn(),
		preview: { siteId: 'other', setSite: vi.fn(), updatePath: vi.fn(), setOpen: vi.fn() },
		startSite: { mutate: vi.fn(), mutateAsync: vi.fn() },
		stopSite: { mutate: vi.fn(), mutateAsync: vi.fn() },
		sites: [] as SiteDetails[],
		agents: { busy: [] as string[] },
	} )
);

vi.mock( '@tanstack/react-router', () => ( { useNavigate: () => navigate } ) );
vi.mock( '@/data/core', () => ( { useConnector: () => ( { trackEvent: vi.fn() } ) } ) );
vi.mock( '@/hooks/use-session-ui', () => ( { useSessionPreviewUI: () => preview } ) );
vi.mock( '@/hooks/use-open-settings', () => ( { useOpenSettings: () => openSettings } ) );
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
vi.mock( '@/data/queries/use-sessions', () => ( {
	useSessions: () => ( {
		data: [ { id: 'blog-chat', ownerSiteId: 'blog', ownerSitePath: '/sites/blog' } ],
	} ),
} ) );
vi.mock( '@/data/queries/use-agent-run', () => ( {
	useSessionsBusy: ( ids: string[] ) => ids.some( ( id ) => agents.busy.includes( id ) ),
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
		agents.busy = [];
	} );

	it( 'starts or stops the current site with ⌥⌘S, shown in its menu', async () => {
		render( <SiteActionsMenu site={ createSite( 'blog', false ) } /> );
		console.log( 'DBG', document.body.innerHTML.slice( 0, 600 ) );
		fireEvent.keyDown( document.body, { key: 'ß', code: 'KeyS', ctrlKey: true, altKey: true } );
		expect( startSite.mutate ).toHaveBeenCalledWith( 'blog' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Site actions for blog' } ) );
		expect( await screen.findByRole( 'menuitem', { name: /Start site/ } ) ).toHaveTextContent(
			'Ctrl+Alt+S'
		);
	} );

	it( 'holds off Delete, saying why, while one of the site’s chats is running', async () => {
		agents.busy = [ 'blog-chat' ];
		render( <SiteActionsMenu site={ createSite( 'blog', false ) } /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Site actions for blog' } ) );

		expect( await screen.findByText( 'Delete site' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Wait for active chats and queued prompts to finish.' )
		).toBeInTheDocument();
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

	it( 'renames from the site settings, with the name field focused', async () => {
		render( <SiteActionsMenu site={ createSite( 'blog', true ) } /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Site actions for blog' } ) );
		fireEvent.click( await screen.findByText( 'Rename' ) );

		expect( openSettings ).toHaveBeenCalledWith( 'site', 'blog', 'Site name' );
	} );
} );
