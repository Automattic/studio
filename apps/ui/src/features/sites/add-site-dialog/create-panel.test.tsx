import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, type FakeConnectorInitialState } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector } from '@/data/core';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
import type { Blueprint } from '@wp-playground/blueprints';

const BRIEF_PLACEHOLDER =
	'A warm, modern website for my neighborhood bakery. Include a menu and our story…';

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

function uploadBlueprint( blueprint: Blueprint & { meta?: object } ) {
	const contents = JSON.stringify( { meta: { title: 'Network', author: 'Studio' }, ...blueprint } );
	const file = new File( [ contents ], 'blueprint.json', { type: 'application/json' } );
	Object.defineProperty( file, 'text', { value: async () => contents } );
	fireEvent.change( document.querySelector( 'input[type="file"][accept*="json"]' )!, {
		target: { files: [ file ] },
	} );
}

const brief = () => screen.queryByPlaceholderText( BRIEF_PLACEHOLDER );

async function createSite( dialog: HTMLElement, name = 'Create site' ) {
	const button = within( dialog ).getByRole( 'button', { name } );
	await waitFor( () => expect( button ).toBeEnabled() );
	fireEvent.click( button );
}

describe( 'Add site › blank setup', () => {
	it( 'offers the brief only with no Blueprint picked', async () => {
		await setup();
		expect( brief() ).toBeVisible();
		uploadBlueprint( {} );
		expect( await screen.findByRole( 'heading', { name: 'Network' } ) ).toBeVisible();
		expect( brief() ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove' } ) );
		expect( await screen.findByPlaceholderText( BRIEF_PLACEHOLDER ) ).toBeVisible();
	} );

	it( 'creates the site with the brief as its first chat prompt', async () => {
		const { connector, dialog, history } = await setup();
		fireEvent.change( brief()!, { target: { value: 'A bakery site' } } );
		await createSite( dialog );
		await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\// ) );
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( { flowType: 'ai' } )
		);
		await waitFor( () =>
			expect( connector.continueSession ).toHaveBeenCalledWith(
				expect.any( String ),
				expect.stringContaining( 'A bakery site' ),
				expect.anything()
			)
		);
	} );

	it( 'keeps the picked model and stands in for a brief of attachments only', async () => {
		const { connector, dialog } = await setup(
			{},
			{
				getStudioAssistantQuota: async () =>
					( {
						allowanceRemaining: 1000,
						purchasedRemaining: 500,
						hasPaymentMethod: true,
					} ) as StudioAssistantQuota,
			}
		);
		const image = new File( [ 'image-bytes' ], 'moodboard.png', { type: 'image/png' } );
		fireEvent.change( dialog.querySelector( 'input[type="file"]:not([accept*="json"])' )!, {
			target: { files: [ image ] },
		} );
		await screen.findByRole( 'listitem', { name: /^moodboard\.png/ } );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Model' } ) );
		const balanced = await screen.findByRole( 'option', { name: /^Balanced/ } );
		await waitFor( () => expect( balanced ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
		fireEvent.click( balanced );
		await createSite( dialog );
		await waitFor( () =>
			expect( connector.setSessionModel ).toHaveBeenCalledWith( expect.any( String ), 'balanced' )
		);
		await waitFor( () =>
			expect( connector.continueSession ).toHaveBeenCalledWith(
				expect.any( String ),
				expect.stringContaining( 'Build this site using the attached files as references.' ),
				expect.anything()
			)
		);
	} );

	it( 'shows what an uploaded Blueprint will install', async () => {
		const { connector } = await setup();
		uploadBlueprint( {
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
		uploadBlueprint( { steps: [ { step: 'enableMultisite' } ] } );
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

	it( 'adds an existing WordPress folder as it is, without the brief', async () => {
		const { connector, dialog, history } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Existing',
			path: '/projects/existing',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.change( brief()!, { target: { value: 'A bakery site' } } );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Advanced settings' } ) );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: /select a different folder|Select a folder/ } )
		);
		await waitFor( () => expect( brief() ).not.toBeInTheDocument() );
		await createSite( dialog );
		await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\/|\/new$/ ) );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'flowType' );
		expect( connector.continueSession ).not.toHaveBeenCalled();
	} );
} );
