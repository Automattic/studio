import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppMessagesForTests } from '@/data/app-messages';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient, renderApp } from '@/test/render';
import type { SiteDetails } from '@/data/core';

const mySite = () => makeSite( { id: 'one', name: 'My site', path: '/sites/my-site' } );

async function openBlankSetup( dialog: HTMLElement ) {
	fireEvent.click(
		await within( dialog ).findByRole( 'button', { name: 'Start with Blank site' } )
	);
	await within( dialog ).findByLabelText( 'Site name' );
	if (
		within( dialog )
			.getByRole( 'button', { name: 'Advanced settings' } )
			.getAttribute( 'aria-expanded' ) !== 'true'
	) {
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Advanced settings' } ) );
	}
}

// The index route offers Add site once per app session until a site exists:
// open it once with a site so this test starts from a fresh session.
async function resetAddSiteOffer() {
	const { history, unmount } = renderApp( {
		connector: createFakeConnector( { sites: [ mySite() ] } ),
	} );
	await waitFor( () => expect( history.location.pathname ).not.toBe( '/' ) );
	unmount();
}

beforeEach( () => {
	localStorage.clear();
	resetAppMessagesForTests();
} );

afterEach( () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
} );

describe( 'site creation', () => {
	it.each( [ { freshSites: [] }, { freshSites: [ mySite() ] } ] )(
		'waits for fresh sites before offering creation with cached empty data ($freshSites.length fresh sites)',
		async ( { freshSites } ) => {
			await resetAddSiteOffer();
			let resolveSites!: ( sites: SiteDetails[] ) => void;
			const connector = createFakeConnector( { sites: freshSites } );
			connector.getSites.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						resolveSites = resolve;
					} )
			);
			const queryClient = createTestQueryClient();
			queryClient.setQueryData( SITES_QUERY_KEY, [] );
			renderApp( { connector, queryClient } );
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			await waitFor( () => expect( connector.getSites ).toHaveBeenCalled() );
			await act( async () => resolveSites( freshSites ) );
			if ( freshSites.length ) {
				await screen.findByRole( 'button', { name: 'Site menu' } );
				expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			} else {
				expect( await screen.findByRole( 'dialog', { name: 'Add site' } ) ).toBeInTheDocument();
			}
		}
	);

	it( 'keeps automatic creation open when creation fails', async () => {
		await resetAddSiteOffer();
		const connector = createFakeConnector();
		connector.createSite.mockRejectedValueOnce( new Error( 'Creation failed' ) );
		renderApp( { connector } );
		const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
		await openBlankSetup( dialog );
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'New site' },
		} );
		const submit = within( dialog ).getByRole( 'button', { name: 'Create site' } );
		await waitFor( () => expect( submit ).toBeEnabled() );
		fireEvent.click( submit );
		expect( await within( dialog ).findByText( 'Creation failed' ) ).toBeInTheDocument();
		expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'New site' );
	} );

	it( 'creates a real connector site and selects it after the registry refresh', async () => {
		await resetAddSiteOffer();
		const { connector } = renderApp( { connector: createFakeConnector() } );
		const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
		await openBlankSetup( dialog );
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'New site' },
		} );
		await waitFor( () =>
			expect( within( dialog ).getByLabelText( 'Local path' ) ).toHaveValue( '/sites/New site' )
		);
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Create site' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
		);
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'New site', path: '/sites/New site' } )
		);
		expect( await screen.findByRole( 'button', { name: 'Site menu' } ) ).toBeInTheDocument();
		expect( await screen.findByRole( 'button', { name: 'Stop New site' } ) ).toBeEnabled();
	} );

	it.each( [ false, true ] )(
		'creates a site from its sidebar group (pinned: %s)',
		async ( pinned ) => {
			localStorage.setItem( 'studio-ui-sidebar-group-pinned', 'false' );
			localStorage.setItem( 'studio-ui-sidebar-group-sites', 'false' );
			const { connector } = renderApp( {
				connector: createFakeConnector( {
					sites: [ mySite() ],
					preferences: { sidebarPins: [ 'site:one' ] },
				} ),
			} );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			fireEvent.click(
				screen.getByRole( 'button', { name: pinned ? 'Add pinned site' : 'Add site' } )
			);
			const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
			await openBlankSetup( dialog );
			fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
				target: { value: 'New site' },
			} );
			await waitFor( () =>
				expect( within( dialog ).getByLabelText( 'Local path' ) ).toHaveValue( '/sites/New site' )
			);
			fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Create site' } ) );
			await waitFor( () =>
				expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
			);
			expect( connector.createSite ).toHaveBeenCalledWith(
				expect.objectContaining( { name: 'New site', path: '/sites/New site' } )
			);
			const created = `site:${
				connector.state.sites.find( ( item ) => item.name === 'New site' )!.id
			}`;
			await waitFor( () =>
				expect( connector.state.preferences.sidebarPins ).toEqual(
					pinned ? [ 'site:one', created ] : [ 'site:one' ]
				)
			);
			expect( await screen.findByRole( 'button', { name: 'Site menu' } ) ).toBeInTheDocument();
			await waitFor( () =>
				expect(
					localStorage.getItem(
						pinned ? 'studio-ui-sidebar-group-pinned' : 'studio-ui-sidebar-group-sites'
					)
				).toBe( 'true' )
			);
			expect( screen.getByRole( 'button', { name: 'New site' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Add pinned site' } ) ).toBeVisible();
		}
	);

	it( 'uses the native Add Site and sidebar menu events', async () => {
		const { connector } = renderApp( {
			connector: createFakeConnector( { sites: [ mySite() ] } ),
		} );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		act( () => connector.emit( 'onToggleSidebar' ) );
		expect(
			( await screen.findAllByRole( 'button', { name: 'Show sidebar' } ) )[ 0 ]
		).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'New chat for active site' } )
		).not.toBeInTheDocument();
		act( () => connector.emit( 'onToggleSidebar' ) );
		act( () => connector.emit( 'onAddSite' ) );
		expect( await screen.findByRole( 'dialog' ) ).toBeVisible();
	} );

	it( 'opens Add site with a deep-linked Blueprint', async () => {
		const connector = createFakeConnector( { sites: [ mySite() ] } );
		connector.readBlueprintFile.mockResolvedValue( {
			meta: { title: 'Deep-linked Blueprint', author: 'Studio' },
		} );
		renderApp( { connector } );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		act( () =>
			connector.emit( 'onAddSiteWithBlueprint', { blueprintPath: '/tmp/deep-link.json' } )
		);
		const dialog = await screen.findByRole( 'dialog' );
		expect( await within( dialog ).findByText( 'Deep-linked Blueprint' ) ).toBeVisible();
		expect( connector.readBlueprintFile ).toHaveBeenCalledWith( '/tmp/deep-link.json' );
	} );

	it( 'shows an error box when a deep-linked Blueprint cannot be read', async () => {
		const showErrorMessageBox = vi.fn();
		vi.stubGlobal( 'ipcApi', { showErrorMessageBox } );
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const connector = createFakeConnector( { sites: [ mySite() ] } );
		const error = new Error( 'Unreadable Blueprint' );
		connector.readBlueprintFile.mockRejectedValue( error );
		renderApp( { connector } );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		act( () => connector.emit( 'onAddSiteWithBlueprint', { blueprintPath: '/tmp/broken.json' } ) );
		await waitFor( () =>
			expect( showErrorMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( { title: 'Failed to load Blueprint', error } )
			)
		);
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the proposed location when the folder picker is cancelled', async () => {
		const { connector } = renderApp( {
			connector: createFakeConnector( { sites: [ mySite() ] } ),
		} );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		act( () => connector.emit( 'onAddSite' ) );
		const dialog = await screen.findByRole( 'dialog' );
		await openBlankSetup( dialog );
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'New site' },
		} );
		await waitFor( () =>
			expect( within( dialog ).getByLabelText( 'Local path' ) ).toHaveValue( '/sites/New site' )
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: /select a different folder|Select a folder/ } )
		);
		await waitFor( () => expect( connector.selectSiteFolder ).toHaveBeenCalled() );
		await waitFor( () =>
			expect( within( dialog ).getByRole( 'button', { name: 'Create site' } ) ).toBeEnabled()
		);
		expect( within( dialog ).getByLabelText( 'Local path' ) ).toHaveValue( '/sites/New site' );
	} );

	it( 'does not re-register an existing Studio site', async () => {
		const connector = createFakeConnector( { sites: [ mySite() ] } );
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'My site',
			path: '/sites/my-site',
			isEmpty: false,
			isWordPress: true,
		} );
		renderApp( { connector } );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		act( () => connector.emit( 'onAddSite' ) );
		const dialog = await screen.findByRole( 'dialog' );
		await openBlankSetup( dialog );
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'New site' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: /select a different folder|Select a folder/ } )
		);
		await waitFor( () =>
			expect( within( dialog ).getByLabelText( 'Local path' ) ).toHaveValue( '/sites/my-site' )
		);
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Create site' } ) );
		expect(
			await screen.findByText(
				'The directory is already associated with another Studio site. Please choose a different custom local path.'
			)
		).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );
} );
