import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, type FakeConnectorInitialState } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector } from '@/data/core';
import type { Blueprint } from '@wp-playground/blueprints';

afterEach( () => vi.unstubAllGlobals() );

async function setup(
	state: FakeConnectorInitialState = {},
	overrides: Partial< Connector > = {}
) {
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: string ) =>
			Response.json(
				String( url ).includes( 'api.wordpress.org/plugins' )
					? { name: 'Query Monitor' }
					: { blueprints: [] }
			)
		)
	);
	const connector = createFakeConnector(
		{ ...state, preferences: { newSiteBehavior: 'blank', ...state.preferences } },
		overrides
	);
	const view = renderApp( { connector, path: '/?addSite=create' } );
	const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
	await waitFor( () =>
		expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'My WordPress Website' )
	);
	return { ...view, dialog };
}

async function uploadBlueprint( blueprint: Blueprint & { meta?: object } ) {
	fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
	fireEvent.click( await screen.findByRole( 'tab', { name: 'Upload' } ) );
	await screen.findByRole( 'button', { name: 'Choose file' } );
	const contents = JSON.stringify( { meta: { title: 'Network', author: 'Studio' }, ...blueprint } );
	const file = new File( [ contents ], 'blueprint.json', { type: 'application/json' } );
	Object.defineProperty( file, 'text', { value: async () => contents } );
	fireEvent.change( document.querySelector( 'input[type="file"][accept*="json"]' )!, {
		target: { files: [ file ] },
	} );
}

async function createSite( dialog: HTMLElement, name = 'Create site' ) {
	const button = within( dialog ).getByRole( 'button', { name } );
	await waitFor( () => expect( button ).toBeEnabled() );
	fireEvent.click( button );
}

describe( 'Add site › blank setup', () => {
	it( 'switches between blank and uploaded Blueprint setup', async () => {
		const { dialog } = await setup();
		expect(
			within( dialog ).getByRole( 'heading', { name: 'Create a blank site' } )
		).toBeVisible();
		await uploadBlueprint( {} );
		expect( await screen.findByRole( 'heading', { name: 'Network' } ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'heading', { name: 'Create your site' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove' } ) );
		expect( await screen.findByRole( 'heading', { name: 'Create a blank site' } ) ).toBeVisible();
	} );

	it( 'submits a blank site and opens its workspace without starting AI work', async () => {
		const { connector, dialog, history } = await setup();
		const name = within( dialog ).getByRole( 'textbox', { name: 'Site name' } );
		fireEvent.change( name, { target: { value: 'My blank site' } } );
		fireEvent.submit( name.closest( 'form' )! );
		await waitFor( () =>
			expect( history.location.pathname ).toMatch( /^\/sites\/created-.*\/new$/ )
		);
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'My blank site' } )
		);
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'flowType' );
		expect( connector.continueSession ).not.toHaveBeenCalled();
	} );

	it( 'keeps creation feedback in the footer button and locks dismissal while pending', async () => {
		const { connector, dialog } = await setup();
		connector.createSite.mockReturnValueOnce( new Promise( () => {} ) );
		const button = within( dialog ).getByRole< HTMLButtonElement >( 'button', {
			name: 'Create site',
		} );
		await createSite( dialog );
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalledOnce() );
		expect( button ).toHaveAttribute( 'aria-busy', 'true' );
		expect( within( button ).getByRole( 'status', { name: 'Creating site' } ) ).toBeInTheDocument();
		expect( within( dialog ).getByRole( 'button', { name: 'Close Add site' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		fireEvent.keyDown( document.activeElement!, { key: 'Escape', code: 'Escape' } );
		expect( dialog ).toBeInTheDocument();
	} );

	it( 'shows what an uploaded Blueprint will install', async () => {
		const { connector } = await setup();
		await uploadBlueprint( {
			meta: { title: 'Theme & plugin development', author: 'Studio' },
			steps: [
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'query-monitor' },
				},
				{
					step: 'installTheme',
					themeData: { resource: 'bundled', path: './twentytwentyfour.zip' },
				},
			],
		} as Blueprint );
		expect(
			await screen.findByRole( 'heading', { name: 'Theme & plugin development' } )
		).toBeVisible();
		expect( screen.getByRole( 'heading', { name: '1 plugin' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: '1 theme' } ) ).toBeVisible();
		fireEvent.click( await screen.findByRole( 'link', { name: 'Query Monitor' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.org/plugins/query-monitor/'
		);
		expect( screen.getByRole( 'button', { name: 'Create site from Blueprint' } ) ).toBeVisible();
	} );

	it( 'requires a custom domain for a multisite Blueprint', async () => {
		const { dialog } = await setup();
		await uploadBlueprint( { steps: [ { step: 'enableMultisite' } ] } );
		await screen.findByRole( 'heading', { name: 'Network' } );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Advanced settings' } ) );
		const toggle = await within( dialog ).findByRole( 'switch', { name: 'Use custom domain' } );
		expect( toggle ).toBeChecked();
		expect(
			within( dialog ).getByText( 'This Blueprint requires a custom domain.' )
		).toBeVisible();
		expect( within( dialog ).getByRole( 'textbox', { name: 'Domain name' } ) ).toHaveValue(
			'network.wp.local'
		);
	} );

	it( 'adds an existing WordPress folder as it is', async () => {
		const { connector, dialog, history } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Existing',
			path: '/projects/existing',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Advanced settings' } ) );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: /select a different folder|Select a folder/ } )
		);
		await within( dialog ).findByText( 'Existing local WordPress site' );
		expect( within( dialog ).getByRole( 'heading', { name: 'Create your site' } ) ).toBeVisible();
		await createSite( dialog );
		await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\/|\/new$/ ) );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'flowType' );
		expect( connector.continueSession ).not.toHaveBeenCalled();
	} );
} );

describe( 'Add site › frontend', () => {
	async function chooseOption( dialog: HTMLElement, select: string, option: string ) {
		fireEvent.click( within( dialog ).getByRole( 'combobox', { name: select } ) );
		const item = await screen.findByRole( 'option', { name: option } );
		fireEvent.pointerDown( item, { pointerType: 'mouse' } );
		fireEvent.click( item );
	}

	it( 'creates a WordPress theme site by default', async () => {
		const { connector, dialog } = await setup();
		expect( within( dialog ).getByRole( 'combobox', { name: 'Frontend' } ) ).toHaveTextContent(
			'WordPress theme'
		);
		expect(
			within( dialog ).queryByRole( 'combobox', { name: 'Content API' } )
		).not.toBeInTheDocument();
		await createSite( dialog );
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalledOnce() );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ].frontend ).toBeUndefined();
	} );

	it( 'creates a headless site with the chosen framework and content API', async () => {
		const { connector, dialog, history } = await setup();
		await chooseOption( dialog, 'Frontend', 'Headless: Astro' );
		expect(
			within( dialog ).getByText(
				'WordPress runs as the content API; Studio also runs the frontend. Astro and Next.js need Node.js installed.'
			)
		).toBeVisible();
		expect( within( dialog ).getByRole( 'combobox', { name: 'Content API' } ) ).toHaveTextContent(
			'REST API'
		);
		await chooseOption( dialog, 'Content API', 'WPGraphQL' );
		await createSite( dialog );
		await waitFor( () =>
			expect( history.location.pathname ).toMatch( /^\/sites\/created-.*\/new$/ )
		);
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( { frontend: { framework: 'astro', api: 'graphql' } } )
		);
		expect( connector.state.sites.at( -1 )?.frontend ).toMatchObject( {
			framework: 'astro',
			api: 'graphql',
		} );
	} );
} );
