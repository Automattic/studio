import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SiteDetails, SyncSite } from '@/data/core';
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
	behavior = 'choose',
	blueprint = portfolio,
	path = '/?addSite=create',
}: { behavior?: 'choose' | 'blank'; blueprint?: Blueprint | null; path?: string } = {} ) {
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
		{ preferences: { newSiteBehavior: behavior } },
		{
			createSite: async () => {
				connector.state.sites = [ ...connector.state.sites, site ];
				return site;
			},
			fetchSyncableWpcomSites: async () => [ remote ],
			getFilePath: async () => '/tmp/upload/backup.zip',
		}
	);
	const view = renderApp( { connector, path } );
	return { ...view, connector, site };
}

// The new site's page, or the chat it opens straight into.
const created = ( history: { location: { pathname: string } } ) =>
	waitFor( () =>
		expect( history.location.pathname ).toMatch( /^\/sites\/created\/new$|^\/sessions\// )
	);

async function useBlueprint() {
	fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Create site' } ) );
}

async function submit( name = 'Create site' ) {
	const button = screen.getByRole( 'button', { name } );
	await waitFor( () => expect( button ).toBeEnabled() );
	fireEvent.click( button );
}

describe( 'Add site flow', () => {
	it( 'opens a title-only picker with grouped navigation and focuses Blank', async () => {
		setup();
		const blank = await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		await waitFor( () => expect( blank ).toHaveFocus() );
		expect( screen.queryByRole( 'tab', { name: 'Upload' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'combobox', { name: 'Blueprint collection' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'searchbox' ) ).not.toBeInTheDocument();
		expect( screen.getAllByText( 'Choose a starting point' ) ).toHaveLength( 1 );
		expect(
			within( screen.getByRole( 'tablist', { name: 'Ways to add a site' } ) ).getAllByRole( 'tab' )
		).toHaveLength( 9 );
		const card = await screen.findByRole( 'button', { name: 'View Portfolio' } );
		expect( within( card ).getByText( 'View blueprint' ) ).toBeInTheDocument();
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

	it( 'uploads a Blueprint from the picker and cleans its bundle when returning', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Upload Blueprint…' } );
		connector.extractBlueprintBundle.mockResolvedValueOnce( {
			blueprintJson: { meta: { title: 'Uploaded site', author: 'Studio' } },
			blueprintJsonPath: '/tmp/upload/blueprint.json',
			tempDir: '/tmp/upload',
		} );
		fireEvent.change( document.querySelector( 'input[type="file"]' )!, {
			target: { files: [ new File( [ 'bundle' ], 'blueprint.zip', { type: 'application/zip' } ) ] },
		} );
		expect( await screen.findByRole( 'heading', { name: 'Uploaded site' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Create your site' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Upload Blueprint…' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		await screen.findByRole( 'button', { name: 'Start with Blank site' } );
		expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/upload' );
	} );

	it( 'can start blank while an uploaded bundle is still loading', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Upload Blueprint…' } );
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
		fireEvent.click( screen.getByRole( 'button', { name: 'Start with Blank site' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Create site' } ) ).toBeEnabled()
		);
		await act( async () =>
			complete( {
				blueprintJson: {},
				blueprintJsonPath: '/tmp/canceled/blueprint.json',
				tempDir: '/tmp/canceled',
			} )
		);
		expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/canceled' );
		expect( screen.getByRole( 'heading', { name: 'Create a blank site' } ) ).toBeVisible();
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
		expect( screen.getByRole( 'tab', { name: 'Create' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		expect(
			await screen.findByRole( 'button', { name: 'Start with Blank site' } )
		).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Portfolio' } ) );
		expect( screen.queryByRole( 'button', { name: 'Blueprints' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) );
		expect( screen.getByText( 'Choose a starting point' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Blog' } ) );
		expect( await screen.findByText( 'No matching Blueprints.' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Clear filters' } ) );
		expect(
			await screen.findByRole( 'button', { name: 'Start with Blank site' } )
		).toBeInTheDocument();
	} );

	it( 'honors direct blank setup and still exposes the picker', async () => {
		setup( { behavior: 'blank' } );
		expect( await screen.findByLabelText( 'Site name' ) ).toHaveFocus();
		expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect(
			await screen.findByRole( 'button', { name: 'Start with Blank site' } )
		).toBeInTheDocument();
	} );

	it( 'uses the Blueprint title and an available name when creating without setup', async () => {
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
		expect( screen.getByRole( 'button', { name: /Creating…/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'status', { name: 'Creating site' } ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Creating site…' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Close Add site' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.queryByText( 'Creating your site…' ) ).not.toBeInTheDocument();
		expect( screen.queryByLabelText( 'Site name' ) ).not.toBeInTheDocument();
		fireEvent.keyDown( document.activeElement!, { key: 'Escape', code: 'Escape' } );
		expect( screen.getByRole( 'dialog', { name: 'Add site' } ) ).toBeInTheDocument();
		await act( async () => {
			connector.state.sites = [ ...connector.state.sites, site ];
			complete( site );
		} );
		await created( history );
	} );

	it( 'shows creation failures only in the top-level notice and lets the user retry', async () => {
		const { connector, history } = setup();
		connector.createSite.mockRejectedValueOnce( new Error( 'Creation interrupted' ) );
		await useBlueprint();
		expect( await screen.findByText( 'Creation interrupted' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Couldn’t create site: Portfolio' ) ).toBeInTheDocument();
		expect(
			within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).queryByText(
				'Creation interrupted'
			)
		).not.toBeInTheDocument();
		expect( screen.queryByLabelText( 'Site name' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Create site' } ) ).toBeEnabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Create site' } ) );
		await created( history );
		expect( connector.createSite ).toHaveBeenCalledTimes( 2 );
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
			expect( screen.getByRole( 'button', { name: 'Create site' } ) ).toHaveFocus()
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
		fireEvent.click( screen.getByRole( 'button', { name: 'Create site' } ) );
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
		await useBlueprint();
		expect( await screen.findByLabelText( 'Site name' ) ).toBeVisible();
		expect(
			await screen.findByRole( 'button', { name: 'Create site from Blueprint' } )
		).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'keeps Blank site when the Blueprints cannot load', async () => {
		setup( { blueprint: null } );
		expect( await screen.findByText( /Blueprints could not be loaded/ ) ).toBeVisible();
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
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Connect' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: /Remote site/ } ) );
		await submit();
		await waitFor( () => expect( connector.pullSiteFromLive ).toHaveBeenCalled() );
	} );
} );
