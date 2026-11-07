import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app';
import { rememberAccountJourney } from '@/data/account-analytics';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient, renderApp } from '@/test/render';
import type { OnboardingHintsState, SiteDetails, SyncSite } from '@/data/core';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

const portfolio: Blueprint = {
	slug: 'photography-portfolio',
	title: 'Portfolio',
	excerpt: 'A portfolio',
	image: 'https://example.test/wedding-rsvp.jpg',
	playground_url: 'https://playground.test/portfolio',
	blueprint: { steps: [], preferredVersions: { php: '8.3', wp: 'latest' } },
};

const remote = {
	id: 42,
	name: 'Remote site',
	url: 'https://remote.example',
	syncSupport: 'syncable',
	isPressable: false,
} as SyncSite;

afterEach( () => vi.unstubAllGlobals() );

function setup( {
	blueprint = portfolio,
	path = '/?addSite=create',
	colorScheme = 'light',
	strict = false,
	sites = [],
	walkthroughStep,
}: {
	blueprint?: Blueprint | null;
	path?: string;
	colorScheme?: 'light' | 'dark';
	strict?: boolean;
	sites?: SiteDetails[];
	walkthroughStep?: OnboardingHintsState[ 'walkthroughStep' ];
} = {} ) {
	vi.stubGlobal(
		'fetch',
		vi.fn( async () =>
			blueprint
				? Response.json( { blueprints: [ blueprint ] } )
				: new Response( null, { status: 500 } )
		)
	);
	const site = makeSite( { id: 'created', name: 'New site', path: '/sites/new' } );
	const connector = createFakeConnector(
		{ sites, preferences: { colorScheme } },
		{
			...( walkthroughStep ? { getOnboardingHints: async () => ( { walkthroughStep } ) } : {} ),
			createSite: async () => {
				connector.state.sites = [ ...connector.state.sites, site ];
				return site;
			},
			fetchSyncableWpcomSites: async () => [ remote ],
			getFilePath: async () => '/tmp/upload/backup.zip',
		}
	);
	const history = createMemoryHistory( { initialEntries: [ path ] } );
	const queryClient = createTestQueryClient();
	const view = strict
		? {
				...render(
					<StrictMode>
						<App connector={ connector } queryClient={ queryClient } history={ history } />
					</StrictMode>
				),
				history,
				queryClient,
				user: userEvent.setup(),
		  }
		: renderApp( { connector, path, queryClient } );
	return { ...view, connector, site };
}

// The new site's page, or the chat it opens straight into.
const created = ( history: { location: { pathname: string } } ) =>
	waitFor( () =>
		expect( history.location.pathname ).toMatch( /^\/sites\/created\/new$|^\/sessions\// )
	);

async function useBlueprint( create = true ) {
	fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Use Blueprint' } ) );
	await screen.findByLabelText( 'Site name' );
	if ( create ) await submit();
}

async function submit( name = 'Add site' ) {
	const button = within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).getByRole( 'button', {
		name,
	} );
	await waitFor( () => expect( button ).toBeEnabled() );
	fireEvent.click( button );
}

describe( 'Add site flow', () => {
	it.each( [ 'create', 'blank' ] as const )(
		'keeps the %s dialog open on outside presses during the creation tour, but allows the close button',
		async ( section ) => {
			const { user, history } = setup( {
				path: `/?addSite=${ section }`,
				walkthroughStep: 'create',
			} );
			const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
			fireEvent.click(
				screen
					.getAllByRole( 'presentation', { hidden: true } )
					.find( ( element ) => element.dataset.variant === 'dimmed' )!
			);
			expect( dialog ).toBeVisible();
			expect( history.location.search ).toContain( `addSite=${ section }` );
			await user.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );
			await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
			expect( history.location.search ).not.toContain( 'addSite' );
		}
	);

	it( 'allows outside presses after the creation tour is completed', async () => {
		const { history } = setup( { walkthroughStep: 'completed' } );
		const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
		fireEvent.click(
			screen
				.getAllByRole( 'presentation', { hidden: true } )
				.find( ( element ) => element.dataset.variant === 'dimmed' )!
		);
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( history.location.search ).not.toContain( 'addSite' );
	} );

	it( 'allows outside presses to close the dialog when a site already exists', async () => {
		const { history } = setup( { sites: [ makeSite() ] } );
		const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
		fireEvent.click(
			screen
				.getAllByRole( 'presentation', { hidden: true } )
				.find( ( element ) => element.dataset.variant === 'dimmed' )!
		);
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( history.location.search ).not.toContain( 'addSite' );
	} );

	it.each( [ 'light', 'dark' ] as const )(
		'completes the original connect journey when the initial pull fails and the user retries (%s)',
		async ( colorScheme ) => {
			const { connector, site } = setup( { colorScheme } );
			site.id = `connected-${ colorScheme }`;
			const context = {
				placement: 'add_site_connect',
				intent: 'connect_site',
				journey_id: crypto.randomUUID(),
			} as const;
			rememberAccountJourney( connector, context );
			connector.getConnectedWpcomSites.mockResolvedValue( [
				{ ...remote, localSiteId: site.id, syncSupport: 'already-connected' },
			] );
			connector.pullSiteFromLive.mockRejectedValueOnce( new Error( 'Initial pull failed' ) );
			await screen.findByRole( 'button', { name: 'Start with Blank site' } );
			fireEvent.click( screen.getByRole( 'tab', { name: 'Connect' } ) );
			fireEvent.click( await screen.findByRole( 'button', { name: /Remote site/ } ) );
			await submit();
			await waitFor( () =>
				expect( connector.trackEvent ).toHaveBeenCalledWith(
					TRACKS_EVENTS.SYNC_CONNECT,
					{ success: true, num_of_sites: 1 },
					site.id
				)
			);
			const retry = await screen.findByRole(
				'button',
				{ name: 'Try pulling again' },
				{ timeout: 5000 }
			);
			expect(
				connector.trackEvent.mock.calls.filter(
					( [ name ] ) => name === TRACKS_EVENTS.ACCOUNT_JOURNEY_COMPLETED
				)
			).toHaveLength( 0 );
			await waitFor( () => expect( retry ).toBeEnabled() );
			fireEvent.click( retry );
			await waitFor( () =>
				expect( connector.trackEvent ).toHaveBeenCalledWith(
					TRACKS_EVENTS.ACCOUNT_JOURNEY_COMPLETED,
					{ ...context, completion_kind: 'sync_pull' }
				)
			);
			expect( connector.pullSiteFromLive ).toHaveBeenCalledTimes( 2 );
		}
	);

	it( 'retraces tab changes and closes from the initial screen', async () => {
		setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Connect' } ) );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Import' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect( screen.getByRole( 'tab', { name: 'Connect' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect( screen.getByRole( 'tab', { name: 'New' } ) ).toHaveAttribute( 'aria-selected', 'true' );
		expect( screen.getByRole( 'button', { name: 'Back' } ) ).not.toHaveAttribute(
			'aria-disabled',
			'true'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
		);
	} );

	it.each( [ 'blank', 'connect', 'import', 'upload' ] )(
		'returns directly opened %s setup to the chooser, then exits with Back',
		async ( section ) => {
			setup( { path: `/?addSite=${ section }` } );
			const back = await screen.findByRole( 'button', { name: 'Back' } );
			expect( back ).not.toHaveAttribute( 'aria-disabled', 'true' );
			fireEvent.click( back );
			expect(
				await screen.findByRole( 'button', { name: 'Start with Blank site' } )
			).toBeVisible();
			fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
			await waitFor( () =>
				expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
			);
		}
	);

	it( 'keeps the name, custom folder and AI brief when going Back to the chooser and returning', async () => {
		const { connector } = setup( { path: '/?addSite=blank' } );
		connector.selectSiteFolder.mockResolvedValue( {
			name: 'custom',
			path: '/sites/custom',
			isEmpty: true,
			isWordPress: false,
		} );
		fireEvent.change( await screen.findByLabelText( 'Site name' ), {
			target: { value: 'My bakery' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute( 'title', '/sites/custom' )
		);
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'A bakery with a seasonal menu' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) );
		expect( await screen.findByLabelText( 'Site name' ) ).toHaveValue( 'My bakery' );
		expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute( 'title', '/sites/custom' );
		expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toHaveValue(
			'A bakery with a seasonal menu'
		);
	} );

	it( 'shows only a spinner while Blueprints load, then focuses Blank', async () => {
		setup();
		let resolve!: ( response: Response ) => void;
		vi.mocked( fetch ).mockReturnValue( new Promise( ( done ) => ( resolve = done ) ) );
		expect( await screen.findByRole( 'status', { name: 'Loading sites…' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Start with Blank site' } )
		).not.toBeInTheDocument();
		await act( async () => resolve( Response.json( { blueprints: [ portfolio ] } ) ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toHaveFocus()
		);
	} );

	it( 'opens a title-only picker with grouped navigation and focuses Blank', async () => {
		setup();
		const blank = await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		await waitFor( () => expect( blank ).toHaveFocus() );
		expect( screen.getByRole( 'tab', { name: 'Import' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Upload' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Upload Blueprint…' } ) ).not.toBeInTheDocument();

		expect(
			screen.queryByRole( 'combobox', { name: 'Blueprint collection' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'searchbox' ) ).not.toBeInTheDocument();
		expect( screen.getAllByText( 'Create a new WordPress' ) ).toHaveLength( 1 );
		expect(
			within( screen.getByRole( 'tablist', { name: 'Ways to add a site' } ) ).getAllByRole( 'tab' )
		).toHaveLength( 9 );
		const card = await screen.findByRole( 'button', { name: 'View Portfolio' } );
		expect( within( card ).getByText( 'View Blueprint' ) ).toBeInTheDocument();
		expect( within( card ).queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );

	it( 'uses the Personal Blog homepage thumbnail and shows its three screenshots', async () => {
		setup( { blueprint: { ...portfolio, slug: 'substrata', title: 'Personal Blog' } } );
		const card = await screen.findByRole( 'button', { name: 'View Personal Blog' } );
		const thumbnail = within( card ).getByRole( 'img' ).getAttribute( 'src' );
		expect( thumbnail ).toContain( '/personal-blog/home.webp' );
		fireEvent.click( card );
		expect(
			await screen.findByRole( 'img', { name: 'Personal Blog screenshot' } )
		).toHaveAttribute( 'src', expect.stringContaining( '/personal-blog/home.webp' ) );
		expect( screen.getByRole( 'img', { name: 'Personal Blog screenshot 2' } ) ).toHaveAttribute(
			'src',
			expect.stringContaining( '/personal-blog/olive-tree.webp' )
		);
		expect( screen.getByRole( 'img', { name: 'Personal Blog screenshot 3' } ) ).toHaveAttribute(
			'src',
			expect.stringContaining( '/personal-blog/coastal-rituals.webp' )
		);
	} );

	it( 'keeps an uploaded Blueprint while browsing the gallery and cleans its bundle on close', async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'tab', { name: 'Import' } ) );
		await screen.findByRole( 'button', { name: /^Choose(?: file|…)$/ } );
		connector.extractBlueprintBundle.mockResolvedValueOnce( {
			blueprintJson: { meta: { title: 'Uploaded site', author: 'Studio' } },
			blueprintJsonPath: '/tmp/upload/blueprint.json',
			tempDir: '/tmp/upload',
		} );
		fireEvent.change( document.querySelector( 'input[type="file"]' )!, {
			target: { files: [ new File( [ 'bundle' ], 'blueprint.zip', { type: 'application/zip' } ) ] },
		} );
		expect( await screen.findByText( 'blueprint.zip', { selector: 'span' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Upload Blueprint…' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toBeVisible();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Browse Blueprints' } ) );
		await screen.findByRole( 'button', { name: 'View Portfolio' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect( await screen.findByText( 'blueprint.zip', { selector: 'span' } ) ).toBeVisible();
		expect( connector.cleanupBlueprintTempDir ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );
		await waitFor( () =>
			expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/upload' )
		);
	} );

	it( 'can start blank while an uploaded bundle is still loading', async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'tab', { name: 'Import' } ) );
		await screen.findByRole( 'button', { name: /^Choose(?: file|…)$/ } );
		let complete!: (
			value: Awaited< ReturnType< typeof connector.extractBlueprintBundle > >
		) => void;
		connector.extractBlueprintBundle.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				complete = resolve;
			} )
		);
		fireEvent.change( document.querySelector( 'input[type="file"]' )!, {
			target: { files: [ new File( [ 'bundle' ], 'blueprint.zip', { type: 'application/zip' } ) ] },
		} );
		await waitFor( () => expect( connector.extractBlueprintBundle ).toHaveBeenCalledOnce() );
		expect(
			screen.getByText( 'Loading file…', { selector: '[role="status"]' } )
		).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'New' } ) );
		expect( screen.queryByText( 'Loading file…' ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) );
		await waitFor( () =>
			expect(
				within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).getByRole( 'button', {
					name: 'Add site',
				} )
			).toBeEnabled()
		);
		await act( async () =>
			complete( {
				blueprintJson: {},
				blueprintJsonPath: '/tmp/canceled/blueprint.json',
				tempDir: '/tmp/canceled',
			} )
		);
		expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/canceled' );
		expect( screen.getByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
	} );

	it( 'shows shared drag feedback across the import modal', async () => {
		setup( { path: '/?addSite=import' } );
		const target = ( await screen.findByText( 'Drop your file here' ) ).parentElement!
			.parentElement!;
		const dataTransfer = {
			files: [ new File( [ 'backup' ], 'backup.wpress', { type: 'application/octet-stream' } ) ],
			types: [ 'Files' ],
		};
		const dialog = screen.getByRole( 'dialog', { name: 'Add site' } );
		fireEvent.dragEnter( window, { dataTransfer } );
		expect( target ).not.toHaveAttribute( 'data-dragging' );
		fireEvent.dragEnter( target, { dataTransfer } );
		expect( dialog ).toHaveAttribute( 'data-dragging' );
		expect( target ).not.toHaveAttribute( 'data-dragging' );
		fireEvent.dragLeave( target, { dataTransfer } );
		expect( dialog ).not.toHaveAttribute( 'data-dragging' );
		fireEvent.drop( target, { dataTransfer } );
		expect(
			await within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).findByRole( 'button', {
				name: 'Add site',
			} )
		).toBeVisible();
	} );

	it( 'opens legacy Upload links in Import and accepts a dropped Blueprint', async () => {
		setup( { path: '/?addSite=upload' } );
		expect(
			await screen.findByRole( 'heading', { name: 'Import a blueprint or backup' } )
		).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Import' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		const file = new File( [ '{}' ], 'blueprint.json', { type: 'application/json' } );
		Object.defineProperty( file, 'text', { value: async () => '{}' } );
		fireEvent.drop( screen.getByText( 'Drop your file here' ).parentElement!.parentElement!, {
			dataTransfer: { files: [ file ], types: [ 'Files' ] },
		} );
		expect(
			await within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).findByRole( 'button', {
				name: 'Add site',
			} )
		).toBeVisible();
	} );

	it( 'filters by use case and restores the gallery when filters are cleared', async () => {
		setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Portfolio' } ) );
		expect( await screen.findByRole( 'button', { name: 'View Portfolio' } ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Start with Blank site' } )
		).not.toBeInTheDocument();
		expect( screen.getAllByText( 'Portfolio' ).length ).toBeGreaterThan( 1 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) );
		expect( screen.getByRole( 'tab', { name: 'New' } ) ).toHaveAttribute( 'aria-selected', 'true' );
		expect(
			await screen.findByRole( 'button', { name: 'Start with Blank site' } )
		).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Portfolio' } ) );
		expect( screen.getByRole( 'button', { name: 'Blueprints' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Blueprints' } ) );
		expect( screen.getByText( 'Create a new WordPress' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Blog' } ) );
		expect( await screen.findByText( 'No matching sites.' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Clear filters' } ) );
		expect(
			await screen.findByRole( 'button', { name: 'Start with Blank site' } )
		).toBeInTheDocument();
	} );

	it( 'opens direct blank setup with the standard Back and close controls', async () => {
		const { connector } = setup( { path: '/?addSite=blank' } );
		expect( await screen.findByLabelText( 'Site name' ) ).toHaveFocus();
		expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'combobox', { name: 'Type' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
		);
		expect( connector.trackEvent ).not.toHaveBeenCalled();
	} );

	it( 'uses the Blueprint title and an available name in shared setup', async () => {
		const { connector, history } = setup();
		connector.generateNumberedSiteName.mockResolvedValue( 'Portfolio 2' );
		await useBlueprint();
		await created( history );
		expect( connector.generateNumberedSiteName ).toHaveBeenCalledWith( 'Portfolio', [] );
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'Portfolio 2', path: '/sites/Portfolio 2' } )
		);
		expect( screen.queryByLabelText( 'Site name' ) ).not.toBeInTheDocument();
	} );

	it( 'creates with Blueprint defaults and keeps details locked while pending', async () => {
		const { connector, history, site } = setup( {
			blueprint: {
				...portfolio,
				blueprint: {
					preferredVersions: { php: '8.2', wp: '6.8' },
					steps: [ { step: 'setSiteOptions', options: { blogname: 'Recipe name' } } ],
				},
			},
		} );
		let complete!: ( site: SiteDetails ) => void;
		connector.createSite.mockImplementationOnce(
			() => new Promise( ( resolve ) => ( complete = resolve ) )
		);
		await useBlueprint();
		expect( connector.trackEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT,
			{ blueprint_slug: portfolio.slug, placement: 'add_site_blueprint_details' }
		);
		await waitFor( () =>
			expect( connector.createSite ).toHaveBeenCalledWith(
				expect.objectContaining( {
					name: 'Recipe name',
					path: '/sites/Recipe name',
					phpVersion: '8.2',
					wpVersion: '6.8',
				} )
			)
		);
		const addingButton = within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).getByRole(
			'button',
			{ name: 'Adding site Add site' }
		);
		expect( addingButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( addingButton );
		expect(
			connector.trackEvent.mock.calls.filter(
				( [ name ] ) => name === TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT
			)
		).toHaveLength( 1 );
		expect( screen.getByRole( 'status', { name: 'Adding site' } ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Creating site…' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Browse Blueprints' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'button', { name: 'Remove Blueprint' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'button', { name: 'Close Add site' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.queryByText( 'Creating your site…' ) ).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'Recipe name' );
		fireEvent.keyDown( document.activeElement!, { key: 'Escape', code: 'Escape' } );
		expect( screen.getByRole( 'dialog', { name: 'Add site' } ) ).toBeInTheDocument();
		await act( async () => {
			connector.state.sites = [ ...connector.state.sites, site ];
			complete( site );
		} );
		await created( history );
	} );

	it( 'uses the bottom failure notice and retries without reselecting the Blueprint', async () => {
		const { connector, history } = setup();
		connector.createSite.mockRejectedValueOnce( new Error( 'Creation interrupted' ) );
		await useBlueprint();
		expect( await screen.findByText( 'Couldn’t create site: Portfolio' ) ).toBeVisible();
		expect(
			screen.queryByText( 'WordPress Studio could not create the site.' )
		).not.toBeInTheDocument();
		expect(
			within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).queryByRole( 'alert' )
		).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'Portfolio' );
		await submit();
		await created( history );
		expect( connector.createSite ).toHaveBeenCalledTimes( 2 );
		expect(
			connector.trackEvent.mock.calls.filter(
				( [ name ] ) => name === TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT
			)
		).toHaveLength( 1 );
	} );

	it( 'shows screenshots before preparing a Blueprint and restores the filtered gallery focus', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		expect( await screen.findByRole( 'img', { name: 'Portfolio preview' } ) ).toHaveAttribute(
			'src',
			expect.stringContaining( 'wedding-rsvp.jpg' )
		);
		fireEvent.click( screen.getByRole( 'tab', { name: 'Portfolio' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
		expect( await screen.findByRole( 'img', { name: 'Portfolio screenshot' } ) ).toHaveAttribute(
			'src',
			expect.stringContaining( 'wedding-rsvp.jpg' )
		);
		expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
		expect( screen.queryByLabelText( 'Site name' ) ).not.toBeInTheDocument();
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Use Blueprint' } ) ).toHaveFocus()
		);
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		expect( connector.createSite ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'View Portfolio' } ) ).toHaveFocus()
		);
		expect( screen.getByRole( 'tab', { name: 'Portfolio' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		expect(
			screen.queryByRole( 'button', { name: 'Start with Blank site' } )
		).not.toBeInTheDocument();
	} );

	it( 'creates from details even when a screenshot cannot load', async () => {
		const { history } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
		fireEvent.error( await screen.findByRole( 'img', { name: 'Portfolio screenshot' } ) );
		expect( screen.queryByRole( 'img', { name: 'Portfolio screenshot' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
		await screen.findByLabelText( 'Site name' );
		await submit();
		await created( history );
		expect( screen.queryByLabelText( 'Site name' ) ).not.toBeInTheDocument();
	} );

	it( 'previews from details in a separate browser without preparing or creating a site', async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Preview in browser' } ) );
		await waitFor( () =>
			expect( connector.openExternalUrl ).toHaveBeenCalledWith(
				'https://grammerthemedemo.wordpress.com/'
			)
		);
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'falls back to the Playground preview for a Blueprint without a demo', async () => {
		const { connector } = setup( { blueprint: { ...portfolio, slug: 'my-recipe' } } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Preview in browser' } ) );
		await waitFor( () =>
			expect( connector.openExternalUrl ).toHaveBeenCalledWith( portfolio.playground_url )
		);
	} );

	it( 'leaves the choice to the setup form when the Blueprint folder is taken', async () => {
		const { connector } = setup();
		connector.generateProposedSitePath.mockResolvedValue( {
			path: '/sites/Portfolio',
			isEmpty: false,
			isWordPress: true,
		} );
		await useBlueprint( false );
		expect( await screen.findByLabelText( 'Site name' ) ).toBeVisible();
		expect(
			await within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).findByRole( 'button', {
				name: 'Add site',
			} )
		).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'keeps Blank site when the Blueprints cannot load', async () => {
		setup( { blueprint: null } );
		expect( await screen.findByText( /Sites could not be loaded/ ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeVisible();
	} );

	it( 'waits for Settings to close before opening', async () => {
		setup( { path: '/?addSite=create&settings=general' } );
		const settings = await screen.findByRole( 'dialog', { name: 'Settings' } );
		expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
		fireEvent.keyDown( settings, { key: 'Escape' } );
		expect( await screen.findByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
	} );

	it( 'allows another starting method after Blueprint creation fails', async () => {
		const { connector } = setup();
		connector.createSite.mockRejectedValueOnce( new Error( 'Invalid recipe' ) );
		await useBlueprint();
		expect( await screen.findByText( 'Invalid recipe' ) ).toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Browse Blueprints' } ) );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Connect' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: /Remote site/ } ) );
		await submit();
		await waitFor( () => expect( connector.pullSiteFromLive ).toHaveBeenCalled() );
	} );
} );

describe( 'Modal-wide file drops', () => {
	function drop( target: Element | Window, filename = 'different-theme name.zip' ) {
		fireEvent.drop( target, {
			dataTransfer: {
				files: [ new File( [ 'bundle' ], filename, { type: 'application/zip' } ) ],
				types: [ 'Files' ],
			},
		} );
	}
	function extracted( title = 'SYSTEM', tempDir = '/tmp/uploaded' ) {
		return {
			blueprintJson: {
				meta: { title: 'Fashion Magazine', author: 'Studio' },
				siteOptions: { blogname: title },
			},
			blueprintJsonPath: tempDir + '/blueprint.json',
			tempDir,
		};
	}

	it( 'keeps bundle resources through Strict Mode effect replay and releases them on close', async () => {
		const { connector } = setup( { strict: true } );
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		connector.extractBlueprintBundle.mockResolvedValueOnce( extracted() );
		drop( screen.getByRole( 'dialog', { name: 'Add site' } ) );
		await waitFor( () => expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'SYSTEM' ) );
		expect( connector.cleanupBlueprintTempDir ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );
		await waitFor( () =>
			expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledExactlyOnceWith( '/tmp/uploaded' )
		);
	} );

	it.each( [ '.json', '.zip', '.gz', '.gzip', '.tar', '.tar.gz', '.tgz', '.wpress', '.xml' ] )(
		'accepts %s from the shared Import picker',
		async ( extension ) => {
			const { connector } = setup( { path: '/?addSite=import' } );
			await screen.findByRole( 'button', { name: /^Choose(?: file|…)$/ } );
			const input = document.querySelector< HTMLInputElement >( 'input[type="file"]' )!;
			expect( input.accept.split( ',' ) ).toContain( extension );
			const file = new File( [ '{}' ], 'My Store' + extension );
			if ( extension === '.json' )
				Object.defineProperty( file, 'text', {
					value: async () => JSON.stringify( { siteOptions: { blogname: 'SYSTEM' } } ),
				} );
			if ( extension === '.zip' )
				connector.extractBlueprintBundle.mockRejectedValueOnce(
					new Error( 'No blueprint.json found in the ZIP.' )
				);
			fireEvent.change( input, { target: { files: [ file ] } } );
			await waitFor( () =>
				expect( screen.getByLabelText( 'Site name' ) ).toHaveValue(
					extension === '.json' ? 'SYSTEM' : 'My Store'
				)
			);
			expect( screen.getByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
			expect( screen.queryByRole( 'button', { name: 'Cancel' } ) ).not.toBeInTheDocument();
			expect(
				within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).getByRole( 'button', {
					name: 'Add site',
				} )
			).toBeEnabled();
		}
	);

	it.each( [ 'create', 'connect', 'upload', 'import' ] )(
		'opens the shared setup for a backup ZIP dropped on %s',
		async ( section ) => {
			const { connector } = setup( { path: '/?addSite=' + section } );
			const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
			connector.extractBlueprintBundle.mockRejectedValueOnce(
				new Error(
					'No blueprint.json found in the ZIP. Place it at the root or inside one enclosing folder.'
				)
			);
			drop( dialog, 'studio-backup-My Store.zip' );
			await waitFor( () =>
				expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'My Store' )
			);
			expect( within( dialog ).getByText( 'studio-backup-My Store.zip' ) ).toBeVisible();
			expect( within( dialog ).getByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
			expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeEnabled();
			expect( connector.extractBlueprintBundle ).toHaveBeenCalledOnce();
			expect( connector.createSite ).not.toHaveBeenCalled();
		}
	);

	it( 'accepts non-ZIP backups anywhere in the modal without Blueprint extraction', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		fireEvent.drop( screen.getByRole( 'tab', { name: 'New' } ), {
			dataTransfer: { files: [ new File( [ 'backup' ], 'My Store.wpress' ) ], types: [ 'Files' ] },
		} );
		await screen.findByText( 'My Store.wpress' );
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'My Store' );
		expect( connector.extractBlueprintBundle ).not.toHaveBeenCalled();
	} );

	it( 'does not treat a malformed Blueprint as a backup', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		connector.extractBlueprintBundle.mockRejectedValueOnce( new SyntaxError( 'Unexpected token' ) );
		drop( screen.getByRole( 'dialog', { name: 'Add site' } ) );
		await screen.findByRole( 'dialog', { name: 'Blueprint error' } );
		expect( screen.queryByLabelText( 'Site name' ) ).not.toBeInTheDocument();
	} );

	it( 'discards stale backup detection after a newer Blueprint drop', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		let reject!: ( error: Error ) => void;
		connector.extractBlueprintBundle.mockReturnValueOnce(
			new Promise( ( _, fail ) => {
				reject = fail;
			} )
		);
		drop( screen.getByRole( 'dialog', { name: 'Add site' } ), 'old-backup.zip' );
		connector.extractBlueprintBundle.mockResolvedValueOnce( extracted() );
		drop( screen.getByRole( 'dialog', { name: 'Add site' } ) );
		await waitFor( () => expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'SYSTEM' ) );
		await act( async () => reject( new Error( 'No blueprint.json found in the ZIP.' ) ) );
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'SYSTEM' );
		expect( screen.queryByText( 'old-backup.zip' ) ).not.toBeInTheDocument();
	} );

	it( 'cleans up a selected Blueprint when replacing it with a backup', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		connector.extractBlueprintBundle.mockResolvedValueOnce( extracted() );
		drop( screen.getByRole( 'dialog', { name: 'Add site' } ) );
		await waitFor( () => expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'SYSTEM' ) );
		connector.extractBlueprintBundle.mockRejectedValueOnce(
			new Error( 'No blueprint.json found in the ZIP.' )
		);
		drop(
			within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).getByRole( 'button', {
				name: 'Add site',
			} ),
			'backup-My Store.zip'
		);
		await screen.findByText( 'backup-My Store.zip' );
		expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/uploaded' );
	} );

	it.each( [ 'header', 'sidebar', 'gallery', 'upload', 'import', 'setup' ] )(
		'accepts a ZIP on %s exactly once and uses the Blueprint site title',
		async ( area ) => {
			const { connector } = setup( {
				path:
					area === 'import'
						? '/?addSite=import'
						: area === 'upload'
						? '/?addSite=upload'
						: area === 'setup'
						? '/?addSite=blank'
						: '/?addSite=create',
			} );
			const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
			connector.extractBlueprintBundle.mockResolvedValueOnce( extracted() );
			const target =
				area === 'sidebar'
					? await within( dialog ).findByRole( 'tab', { name: 'New' } )
					: area === 'header'
					? await within( dialog ).findByText( 'Create a new WordPress' )
					: area === 'upload'
					? await within( dialog ).findByText( 'Drop your file here' )
					: area === 'import'
					? await within( dialog ).findByText( 'Drop your file here' )
					: area === 'setup'
					? await within( dialog ).findByLabelText( 'Site name' )
					: await within( dialog ).findByRole( 'button', { name: 'Start with Blank site' } );
			drop( target );
			await waitFor( () =>
				expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'SYSTEM' )
			);
			expect( within( dialog ).getByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
			expect(
				within( dialog ).queryByRole( 'button', { name: 'Cancel' } )
			).not.toBeInTheDocument();
			expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
			expect( connector.extractBlueprintBundle ).toHaveBeenCalledOnce();
			expect( connector.importSiteFromBackup ).not.toHaveBeenCalled();
		}
	);

	it( 'replaces a connected source with a Blueprint before submitting', async () => {
		const { connector } = setup( { path: '/?addSite=connect' } );
		fireEvent.click( await screen.findByRole( 'button', { name: /Remote site/ } ) );
		await screen.findByLabelText( 'Site name' );
		connector.extractBlueprintBundle.mockResolvedValueOnce( extracted() );
		drop(
			within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).getByRole( 'button', {
				name: 'Add site',
			} )
		);
		await waitFor( () => expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'SYSTEM' ) );
		expect( screen.queryByText( 'remote.example' ) ).not.toBeInTheDocument();
		await submit();
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalled() );
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( {
				blueprint: expect.objectContaining( { filePath: '/tmp/uploaded/blueprint.json' } ),
			} )
		);
		expect( connector.pullSiteFromLive ).not.toHaveBeenCalled();
	} );

	it( 'preserves edits and a valid Blueprint after a failed replacement', async () => {
		const { connector } = setup( { path: '/?addSite=blank' } );
		await screen.findByLabelText( 'Site name' );
		connector.extractBlueprintBundle.mockResolvedValueOnce( extracted() );
		drop( screen.getByRole( 'dialog', { name: 'Add site' } ) );
		await waitFor( () => expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'SYSTEM' ) );
		fireEvent.change( screen.getByLabelText( 'Site name' ), {
			target: { value: 'My Edited Title' },
		} );
		connector.extractBlueprintBundle.mockRejectedValueOnce( new Error( 'Invalid ZIP' ) );
		drop(
			within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).getByRole( 'button', {
				name: 'Add site',
			} )
		);
		await screen.findByRole( 'dialog', { name: 'Blueprint error' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'My Edited Title' );
		await submit();
		await waitFor( () =>
			expect( connector.createSite ).toHaveBeenCalledWith(
				expect.objectContaining( {
					name: 'My Edited Title',
					blueprint: expect.objectContaining( {
						blueprint: expect.objectContaining( { siteOptions: { blogname: 'My Edited Title' } } ),
					} ),
				} )
			)
		);
	} );

	it( 'cleans a superseded bundle and ignores drops during creation', async () => {
		const { connector } = setup( { path: '/?addSite=blank' } );
		await screen.findByLabelText( 'Site name' );
		let complete!: ( value: ReturnType< typeof extracted > ) => void;
		connector.extractBlueprintBundle.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				complete = resolve;
			} )
		);
		const dialog = screen.getByRole( 'dialog', { name: 'Add site' } );
		drop( dialog );
		connector.extractBlueprintBundle.mockResolvedValueOnce( extracted( 'Latest', '/tmp/latest' ) );
		drop( dialog );
		await waitFor( () => expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'Latest' ) );
		await act( async () => complete( extracted( 'Stale', '/tmp/stale' ) ) );
		expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/stale' );
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'Latest' );
		connector.createSite.mockReturnValueOnce( new Promise( () => {} ) );
		await submit();
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalledOnce() );
		drop( dialog );
		expect( connector.extractBlueprintBundle ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'ignores drops outside the modal and cleans loads completed after closure', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		drop( window );
		expect( connector.extractBlueprintBundle ).not.toHaveBeenCalled();
		let complete!: ( value: ReturnType< typeof extracted > ) => void;
		connector.extractBlueprintBundle.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				complete = resolve;
			} )
		);
		drop( screen.getByRole( 'dialog', { name: 'Add site' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
		);
		await act( async () => complete( extracted() ) );
		expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/uploaded' );
	} );
} );

describe( 'Preview navigation', () => {
	it.each( [ 'New', 'Portfolio' ] )(
		'hides the sidebar on a preview and restores the %s gallery',
		async ( tab ) => {
			setup();
			await screen.findByRole( 'button', { name: 'View Portfolio' } );
			if ( tab === 'Portfolio' ) fireEvent.click( screen.getByRole( 'tab', { name: tab } ) );
			fireEvent.click( screen.getByRole( 'button', { name: 'View Portfolio' } ) );
			await screen.findByRole( 'button', { name: 'Blueprints' } );
			expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
			fireEvent.click( screen.getByRole( 'button', { name: 'Blueprints' } ) );
			expect( await screen.findByRole( 'button', { name: 'View Portfolio' } ) ).toBeVisible();
			expect( screen.getByRole( 'tab', { name: tab } ) ).toHaveAttribute( 'aria-selected', 'true' );
		}
	);
} );

it( 'returns to all sites from a category breadcrumb after switching filters', async () => {
	setup();
	await screen.findByRole( 'button', { name: 'Start with Blank site' } );
	fireEvent.click( screen.getByRole( 'tab', { name: 'Portfolio' } ) );
	expect( await screen.findByRole( 'heading', { name: 'Portfolio' } ) ).toBeVisible();
	fireEvent.click( screen.getByRole( 'tab', { name: 'Blog' } ) );
	expect( await screen.findByRole( 'heading', { name: 'Blog' } ) ).toBeVisible();
	fireEvent.click( screen.getByRole( 'button', { name: 'Blueprints' } ) );
	expect( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) ).toBeVisible();
	expect( screen.getByRole( 'tab', { name: 'New' } ) ).toHaveAttribute( 'aria-selected', 'true' );
	expect( screen.queryByRole( 'button', { name: 'Blueprints' } ) ).not.toBeInTheDocument();
} );

it( 'resolves connect failure telemetry before removing the local record', async () => {
	const { connector, site } = setup();
	connector.connectWpcomSite.mockRejectedValueOnce( new Error( 'Cannot save connection' ) );
	let finishTelemetry: () => void = () => {};
	connector.trackEvent.mockImplementation( async ( event ) => {
		if ( event === TRACKS_EVENTS.SYNC_CONNECT )
			await new Promise< void >( ( resolve ) => {
				finishTelemetry = resolve;
			} );
	} );
	await screen.findByRole( 'button', { name: 'Start with Blank site' } );
	fireEvent.click( screen.getByRole( 'tab', { name: 'Connect' } ) );
	fireEvent.click( await screen.findByRole( 'button', { name: /Remote site/ } ) );
	await submit();
	await waitFor( () =>
		expect( connector.trackEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_CONNECT,
			{ success: false, failure_reason: 'storage_write', num_of_sites: 0 },
			site.id
		)
	);
	expect( connector.deleteSite ).not.toHaveBeenCalled();
	await act( async () => finishTelemetry() );
	await waitFor( () => expect( connector.deleteSite ).toHaveBeenCalled() );
} );

function blueprintEvents( connector: ReturnType< typeof createFakeConnector > ) {
	return connector.trackEvent.mock.calls.filter(
		( [ name ] ) =>
			name.startsWith( 'studio_blueprint_' ) || name === TRACKS_EVENTS.BLANK_SITE_SELECTED
	);
}

describe( 'Add site Blueprint Tracks actions', () => {
	it.each( [ false, true ] )(
		'records view, preview and create once with exact props (filtered: %s)',
		async ( filtered ) => {
			const { connector, history, queryClient, user } = setup();
			const card = await screen.findByRole( 'button', { name: 'View Portfolio' } );
			fireEvent.load( screen.getByRole( 'img', { name: 'Portfolio preview' } ) );
			expect( blueprintEvents( connector ) ).toEqual( [] );
			const props = {
				blueprint_slug: portfolio.slug,
				...( filtered ? { use_case: 'portfolio' } : {} ),
			};
			const expected = [];
			if ( filtered ) {
				await user.click( screen.getByRole( 'tab', { name: 'Portfolio' } ) );
				expected.push( [
					TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED,
					{ use_case: 'portfolio' },
				] );
			}
			await user.click( card );
			expected.push( [ TRACKS_EVENTS.BLUEPRINT_VIEWED, props ] );
			fireEvent.error( await screen.findByRole( 'img', { name: 'Portfolio screenshot' } ) );
			await act( async () => queryClient.invalidateQueries( { queryKey: [ 'blueprints' ] } ) );
			expect( blueprintEvents( connector ) ).toStrictEqual( expected );
			await user.click( screen.getByRole( 'button', { name: 'Preview in browser' } ) );
			expected.push( [
				TRACKS_EVENTS.BLUEPRINT_PREVIEW_IN_BROWSER,
				{ ...props, placement: 'add_site_blueprint_details' },
			] );
			expect( blueprintEvents( connector ) ).toStrictEqual( expected );
			expect( connector.trackEvent.mock.invocationCallOrder.at( -1 ) ).toBeLessThan(
				connector.openExternalUrl.mock.invocationCallOrder[ 0 ]
			);
			await user.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
			expected.push( [
				TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT,
				{ ...props, placement: 'add_site_blueprint_details' },
			] );
			await screen.findByLabelText( 'Site name' );
			await submit();
			await created( history );
			expect( blueprintEvents( connector ) ).toStrictEqual( expected );
			expect( connector.trackEvent.mock.invocationCallOrder.at( -1 ) ).toBeLessThan(
				connector.createSite.mock.invocationCallOrder[ 0 ]
			);
		}
	);

	it.each( [
		[ 'Business', 'business' ],
		[ 'Blog', 'blog' ],
		[ 'Portfolio', 'portfolio' ],
		[ 'Store', 'store' ],
		[ 'Events', 'events' ],
		[ 'Development', 'development' ],
	] )( 'records the %s category once and ignores unchanged selections', async ( label, value ) => {
		const { connector, user } = setup();
		await screen.findByRole( 'button', { name: 'View Portfolio' } );
		await user.click( screen.getByRole( 'tab', { name: label } ) );
		await user.click( screen.getByRole( 'tab', { name: label } ) );
		expect( blueprintEvents( connector ) ).toStrictEqual( [
			[ TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, { use_case: value } ],
		] );
	} );

	it( 'records both explicit clear-to-all actions but leaves Back and other tabs silent', async () => {
		const { connector, user } = setup();
		await screen.findByRole( 'button', { name: 'View Portfolio' } );
		await user.click( screen.getByRole( 'tab', { name: 'Portfolio' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) );
		await user.click( screen.getByRole( 'tab', { name: 'Blog' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Clear filters' } ) );
		await user.click( screen.getByRole( 'tab', { name: 'Portfolio' } ) );
		await user.click( screen.getByRole( 'tab', { name: 'New' } ) );
		await user.click( screen.getByRole( 'tab', { name: 'Import' } ) );
		await user.click( screen.getByRole( 'tab', { name: 'Connect' } ) );
		await user.click( screen.getByRole( 'tab', { name: 'New' } ) );
		expect( blueprintEvents( connector ) ).toStrictEqual( [
			[ TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, { use_case: 'portfolio' } ],
			[ TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, { use_case: 'blog' } ],
			[ TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, { use_case: 'all' } ],
			[ TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, { use_case: 'portfolio' } ],
			[ TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, { use_case: 'all' } ],
		] );
	} );

	it( 'records each keyboard activation of Blank site with placement only', async () => {
		const { connector, history, user } = setup();
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toHaveFocus()
		);
		await user.keyboard( '{Enter}' );
		await screen.findByLabelText( 'Site name' );
		await user.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
		);
		await act( async () => history.push( '/?addSite=create' ) );
		await user.click( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) );
		expect( blueprintEvents( connector ) ).toStrictEqual( [
			[ TRACKS_EVENTS.BLANK_SITE_SELECTED, { placement: 'add_site_blueprint_gallery' } ],
			[ TRACKS_EVENTS.BLANK_SITE_SELECTED, { placement: 'add_site_blueprint_gallery' } ],
		] );
	} );

	it.each( [ 'taken-folder', 'custom-domain' ] )(
		'records create intent when details open setup (%s)',
		async ( reason ) => {
			const { connector, user } = setup( {
				blueprint:
					reason === 'custom-domain'
						? { ...portfolio, blueprint: { steps: [ { step: 'enableMultisite' } ] } }
						: portfolio,
			} );
			if ( reason === 'taken-folder' )
				connector.generateProposedSitePath.mockResolvedValue( {
					path: '/sites/taken',
					isEmpty: false,
					isWordPress: true,
				} );
			await user.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
			await user.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
			await screen.findByLabelText( 'Site name' );
			expect( connector.createSite ).not.toHaveBeenCalled();
			expect( blueprintEvents( connector ) ).toStrictEqual( [
				[ TRACKS_EVENTS.BLUEPRINT_VIEWED, { blueprint_slug: portfolio.slug } ],
				[
					TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT,
					{ blueprint_slug: portfolio.slug, placement: 'add_site_blueprint_details' },
				],
			] );
		}
	);

	it( 'counts deliberate repeat views and previews without counting Back', async () => {
		const { connector, user } = setup();
		for ( let attempt = 0; attempt < 2; attempt++ ) {
			await user.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
			await user.click( screen.getByRole( 'button', { name: 'Preview in browser' } ) );
			await user.click( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) );
		}
		expect( blueprintEvents( connector ).map( ( [ name ] ) => name ) ).toEqual( [
			TRACKS_EVENTS.BLUEPRINT_VIEWED,
			TRACKS_EVENTS.BLUEPRINT_PREVIEW_IN_BROWSER,
			TRACKS_EVENTS.BLUEPRINT_VIEWED,
			TRACKS_EVENTS.BLUEPRINT_PREVIEW_IN_BROWSER,
		] );
	} );

	it.each( [ 'reject', 'pending' ] )(
		'keeps every action working when tracking is %s',
		async ( failure ) => {
			const { connector, history, user } = setup();
			if ( failure === 'reject' )
				connector.trackEvent.mockRejectedValue( new Error( 'Tracks unavailable' ) );
			else connector.trackEvent.mockImplementation( () => new Promise( () => {} ) );
			await screen.findByRole( 'button', { name: 'View Portfolio' } );
			await user.click( screen.getByRole( 'button', { name: 'Start with Blank site' } ) );
			await screen.findByLabelText( 'Site name' );
			await user.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );
			await waitFor( () =>
				expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
			);
			await act( async () => history.push( '/?addSite=create' ) );
			await screen.findByRole( 'button', { name: 'View Portfolio' } );
			await user.click( screen.getByRole( 'tab', { name: 'Blog' } ) );
			await user.click( screen.getByRole( 'button', { name: 'Clear filters' } ) );
			await user.click( screen.getByRole( 'button', { name: 'View Portfolio' } ) );
			await user.click( screen.getByRole( 'button', { name: 'Preview in browser' } ) );
			expect( connector.openExternalUrl ).toHaveBeenCalledOnce();
			await user.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
			await screen.findByLabelText( 'Site name' );
			await submit();
			await created( history );
			expect( blueprintEvents( connector ).map( ( [ name ] ) => name ) ).toEqual( [
				TRACKS_EVENTS.BLANK_SITE_SELECTED,
				TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED,
				TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED,
				TRACKS_EVENTS.BLUEPRINT_VIEWED,
				TRACKS_EVENTS.BLUEPRINT_PREVIEW_IN_BROWSER,
				TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT,
			] );
		}
	);

	it( 'sends only the public catalog slug and fixed props despite sensitive Blueprint fields', async () => {
		const sensitive = {
			...portfolio,
			slug: 'public-catalog-entry',
			title: 'Private title private@example.test',
			excerpt: 'Private excerpt',
			image: 'https://private.example.test/screenshot?token=private-token',
			playground_url: 'https://private.example.test/preview?token=private-token',
			bundle_url: 'https://private.example.test/bundle?token=private-token',
			filePath: '/private/local/blueprint.json',
			blueprint: {
				...portfolio.blueprint,
				login: { username: 'private-user', password: 'private-password' },
			},
		};
		const { connector, history, user } = setup( { blueprint: sensitive } );
		await user.click( await screen.findByRole( 'button', { name: `View ${ sensitive.title }` } ) );
		await user.click( screen.getByRole( 'button', { name: 'Preview in browser' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( sensitive.playground_url );
		await user.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
		await screen.findByLabelText( 'Site name' );
		await submit();
		await created( history );
		expect( blueprintEvents( connector ) ).toStrictEqual( [
			[ TRACKS_EVENTS.BLUEPRINT_VIEWED, { blueprint_slug: sensitive.slug } ],
			[
				TRACKS_EVENTS.BLUEPRINT_PREVIEW_IN_BROWSER,
				{ blueprint_slug: sensitive.slug, placement: 'add_site_blueprint_details' },
			],
			[
				TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT,
				{ blueprint_slug: sensitive.slug, placement: 'add_site_blueprint_details' },
			],
		] );
		expect( JSON.stringify( blueprintEvents( connector ) ) ).not.toMatch(
			/private|https?:|filePath|title|email|token|password|username/
		);
	} );
} );
