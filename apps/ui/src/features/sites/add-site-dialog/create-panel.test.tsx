import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pendingPromptSlot } from '@/features/composer';
import { createFakeConnector, type FakeConnectorInitialState } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector, SelectedSiteFolder } from '@/data/core';
import type { AiSettings } from '@studio/agent/protocol/providers';
import type { Blueprint as CatalogBlueprint } from '@studio/common/lib/studio-blueprints-api';
import type { Blueprint } from '@wp-playground/blueprints';

afterEach( () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	const pending = pendingPromptSlot.getSnapshot();
	if ( pending ) pendingPromptSlot.clear( pending );
} );

async function setup(
	state: FakeConnectorInitialState = {},
	overrides: Partial< Connector > = {},
	blueprints: CatalogBlueprint[] = [
		{
			slug: 'portfolio',
			title: 'Portfolio',
			excerpt: 'A portfolio',
			image: 'https://example.test/portfolio.png',
			playground_url: 'https://example.test/preview',
			blueprint: { steps: [] },
		},
	]
) {
	vi.stubGlobal(
		'fetch',
		vi.fn( async () => Response.json( { blueprints } ) )
	);
	const connector = createFakeConnector( state, overrides );
	const view = renderApp( { connector, path: '/?addSite=blank' } );
	const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
	await waitFor( () =>
		expect( within( dialog ).getByRole( 'textbox', { name: 'Site name' } ) ).toHaveAttribute(
			'placeholder',
			'Blue Note'
		)
	);
	return { ...view, dialog };
}

async function startBlank() {
	const remove = screen.queryByRole( 'button', { name: 'Remove Blueprint' } );
	if ( remove ) fireEvent.click( remove );
	else {
		fireEvent.click( screen.getByRole( 'button', { name: 'Change' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Start blank' } ) );
	}
	await screen.findByRole( 'group', { name: 'Start from (optional)' } );
}

async function uploadBlueprint( blueprint: Blueprint & { meta?: object } ) {
	const contents = JSON.stringify( { meta: { title: 'Network', author: 'Studio' }, ...blueprint } );
	const file = new File( [ contents ], 'blueprint.json', { type: 'application/json' } );
	Object.defineProperty( file, 'text', { value: async () => contents } );
	fireEvent.change( document.querySelector( 'input[type="file"][accept*="json"]' )!, {
		target: { files: [ file ] },
	} );
}

async function createSite( dialog: HTMLElement, name = 'Add site' ) {
	const button = within( dialog ).getByRole( 'button', { name } );
	await waitFor( () => expect( button ).toBeEnabled() );
	fireEvent.click( button );
}

describe( 'Add site › blank setup', () => {
	it( 'shows only the selected source after choosing a Blueprint', async () => {
		const { connector, dialog } = await setup();
		fireEvent.change( screen.getByLabelText( 'Site name' ), { target: { value: 'My bakery' } } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Make this a bakery' },
		} );
		await uploadBlueprint( { steps: [] } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Browse Blueprints' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Use Blueprint' } ) );
		const source = await screen.findByRole( 'group', { name: 'Start from (optional)' } );
		expect( within( source ).getByText( 'Portfolio' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Start with a Blueprint' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'region', { name: 'Blueprint cards' } ) ).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'My bakery' );
		expect( connector.createSite ).not.toHaveBeenCalled();
		await createSite( dialog );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( {
				name: 'My bakery',
				blueprint: expect.objectContaining( {
					blueprint: expect.objectContaining( { steps: expect.any( Array ) } ),
				} ),
			} )
		);
		expect( connector.continueSession.mock.calls[ 0 ][ 1 ] ).toBe( 'Make this a bakery' );
	} );

	it( 'keeps a dropped Blueprint selected when changing its source and returning from the gallery', async () => {
		const { dialog } = await setup();
		const contents = JSON.stringify( { steps: [], meta: { title: 'Bakery', author: 'Studio' } } );
		const file = new File( [ contents ], 'dropped-blueprint.json', { type: 'application/json' } );
		Object.defineProperty( file, 'text', { value: async () => contents } );
		fireEvent.drop( dialog, { dataTransfer: { files: [ file ], types: [ 'Files' ] } } );
		await screen.findByText( 'dropped-blueprint.json', { selector: 'span' } );
		expect(
			screen.queryByRole( 'button', { name: 'Start with a Blueprint' } )
		).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Browse Blueprints' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Back' } ) );
		expect(
			await screen.findByText( 'dropped-blueprint.json', { selector: 'span' } )
		).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Start with a Blueprint' } )
		).not.toBeInTheDocument();
	} );

	it( 'allows adding a blank site without another starting-point chooser', async () => {
		const { connector, dialog } = await setup( {}, {}, [] );
		expect( within( dialog ).getByRole( 'button', { name: 'Back' } ) ).toBeVisible();
		expect( screen.queryByRole( 'combobox', { name: 'Type' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Start with a Blueprint' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Browse all' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /^Choose(?: file|…)$/ } ) ).toBeVisible();
		await createSite( dialog );
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalledOnce() );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'blueprint' );
	} );

	it( 'chooses a backup inline and retains the name and AI brief when returning to blank', async () => {
		const { dialog } = await setup();
		fireEvent.change( screen.getByLabelText( 'Site name' ), { target: { value: 'My bakery' } } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'A bakery with a weekly menu' },
		} );
		expect( screen.queryByRole( 'combobox', { name: 'Type' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /^Choose(?: file|…)$/ } ) ).toBeVisible();
		expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toBeVisible();
		expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
		expect(
			within( screen.getByRole( 'dialog', { name: 'Add site' } ) ).getByRole( 'button', {
				name: 'Add site',
			} )
		).toBeEnabled();
		fireEvent.change( within( dialog ).getByLabelText( 'Choose a Blueprint or backup' ), {
			target: { files: [ new File( [ 'backup' ], 'bakery.wpress' ) ] },
		} );
		expect( await screen.findByText( 'bakery.wpress' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Start with a Blueprint' } )
		).not.toBeInTheDocument();
		expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toBeVisible();
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'My bakery' );
		await startBlank();
		expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toHaveValue(
			'A bakery with a weekly menu'
		);
	} );

	it( 'restores the form and its brief after browsing and selecting a Blueprint', async () => {
		const { connector } = await setup();
		vi.mocked( fetch ).mockResolvedValue(
			Response.json( {
				blueprints: [
					{
						slug: 'portfolio',
						title: 'Portfolio',
						excerpt: 'A portfolio',
						image: 'https://example.test/portfolio.png',
						playground_url: 'https://example.test/preview',
						blueprint: { steps: [] },
					},
				],
			} )
		);
		fireEvent.change( screen.getByLabelText( 'Site name' ), { target: { value: 'My portfolio' } } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Add my photography projects' },
		} );
		expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toBeVisible();
		await uploadBlueprint( { steps: [] } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Browse Blueprints' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
		expect( await screen.findByLabelText( 'Site name' ) ).toHaveValue( 'My portfolio' );
		expect( screen.getByRole( 'group', { name: 'Start from (optional)' } ) ).toBeVisible();
		expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toHaveValue(
			'Add my photography projects'
		);
		expect( connector.createSite ).not.toHaveBeenCalled();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Browse Blueprints' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect( screen.getByText( 'Portfolio', { selector: 'span' } ) ).toBeVisible();
	} );

	it( 'creates the site before handing its initial brief to the chat exactly once', async () => {
		const { connector, dialog } = await setup();
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Build a bakery site' },
		} );
		await createSite( dialog );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( connector.continueSession ).toHaveBeenCalledWith(
			expect.any( String ),
			'Build a bakery site',
			expect.anything()
		);
		expect( connector.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( { flowType: 'ai' } )
		);
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'prompt' );
		expect( connector.createSite.mock.invocationCallOrder[ 0 ] ).toBeLessThan(
			connector.createSession.mock.invocationCallOrder[ 0 ]
		);
		expect( connector.setSessionProvider ).toHaveBeenCalledWith(
			expect.any( String ),
			'wpcom',
			expect.any( String )
		);
		expect( pendingPromptSlot.getSnapshot() ).toBeNull();
	} );

	it( 'keeps the initial brief pending if its provider disconnects before adding the site', async () => {
		const { connector, dialog, history } = await setup();
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Build my portfolio' },
		} );
		act( () => {
			connector.state.user = null;
			connector.emit( 'onAuthStateChanged' );
		} );
		await waitFor( () =>
			expect(
				within( dialog ).queryByRole( 'textbox', { name: 'Instructions' } )
			).not.toBeInTheDocument()
		);
		await createSite( dialog );
		await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\// ) );
		expect(
			await screen.findByText( 'Connect a provider to build and edit your site.' )
		).toBeVisible();
		expect( connector.continueSession ).not.toHaveBeenCalled();
		expect( pendingPromptSlot.getSnapshot()?.prompt ).toBe( 'Build my portfolio' );
	} );

	it( 'hides AI without a connected provider and adds the site without a chat', async () => {
		const { connector, dialog, history } = await setup( { user: null } );
		expect( within( dialog ).getByText( 'Instructions' ) ).not.toBeVisible();
		expect(
			within( dialog ).queryByRole( 'button', { name: 'Connect a provider' } )
		).not.toBeInTheDocument();
		expect(
			within( dialog ).queryByRole( 'textbox', { name: 'Instructions' } )
		).not.toBeInTheDocument();
		expect( within( dialog ).queryByRole( 'button', { name: 'Add' } ) ).not.toBeInTheDocument();
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'Bakery' },
		} );
		await createSite( dialog );
		await waitFor( () =>
			expect( history.location.pathname ).toMatch( /^\/sites\/created-.*\/new$/ )
		);
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'flowType' );
		expect( connector.createSession ).not.toHaveBeenCalled();
		expect( connector.continueSession ).not.toHaveBeenCalled();
	} );

	it( 'keeps AI hidden without a provider while offline', async () => {
		vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		const { dialog } = await setup( { user: null } );
		expect( within( dialog ).getByText( 'Instructions' ) ).not.toBeVisible();
		expect(
			within( dialog ).queryByRole( 'textbox', { name: 'Instructions' } )
		).not.toBeInTheDocument();
		expect(
			within( dialog ).queryByRole( 'button', { name: 'Connect a provider' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the composer available for a connected provider while offline', async () => {
		vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		const { dialog } = await setup();
		expect(
			await within( dialog ).findByRole( 'textbox', { name: 'Instructions' } )
		).toBeVisible();
		expect(
			within( dialog ).getByText( 'You are offline. Reconnect to send a message.' )
		).toBeVisible();
	} );

	it( 'keeps the site draft and attachments when reconnecting a provider in settings', async () => {
		let aiSettings: AiSettings = {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		};
		const { connector, dialog, history } = await setup(
			{},
			{
				getAiSettings: async () => aiSettings,
				saveAnthropicApiKey: async () => {
					aiSettings = { ...aiSettings, hasAnthropicApiKey: true };
					return aiSettings;
				},
				setAiProvider: async ( provider ) => {
					aiSettings = { ...aiSettings, provider };
					return aiSettings;
				},
			}
		);
		fireEvent.change( within( dialog ).getByLabelText( 'Site name' ), {
			target: { value: 'Bakery' },
		} );
		const input = within( dialog ).getByRole( 'textbox', { name: 'Instructions' } );
		fireEvent.change( input, { target: { value: 'Build a seasonal bakery site' } } );
		fireEvent.change( within( dialog ).getByLabelText( 'Upload attachments' ), {
			target: { files: [ new File( [ 'Menu notes' ], 'menu.txt', { type: 'text/plain' } ) ] },
		} );
		await within( dialog ).findByRole( 'listitem', { name: /^menu\.txt/ } );
		expect(
			within( dialog ).queryByRole( 'button', { name: 'Send message' } )
		).not.toBeInTheDocument();
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( connector.createSite ).not.toHaveBeenCalled();
		act( () => {
			connector.state.user = null;
			connector.emit( 'onAuthStateChanged' );
		} );
		await waitFor( () =>
			expect(
				within( dialog ).queryByRole( 'textbox', { name: 'Instructions' } )
			).not.toBeInTheDocument()
		);
		act( () => history.push( '/?addSite=blank&settings=ai' ) );
		const settings = await screen.findByRole( 'dialog', { name: 'Settings' } );
		fireEvent.click(
			within( within( settings ).getByRole( 'group', { name: 'Anthropic' } ) ).getByRole(
				'button',
				{ name: 'Connect' }
			)
		);
		fireEvent.change(
			within( settings ).getByLabelText( 'Anthropic API key', { selector: 'input' } ),
			{
				target: { value: 'sk-test-local' },
			}
		);
		fireEvent.submit( within( settings ).getByRole( 'form', { name: 'Anthropic connection' } ) );
		await waitFor( () =>
			expect( connector.setAiProvider ).toHaveBeenCalledWith( 'anthropic-api-key' )
		);
		fireEvent.click( within( settings ).getByRole( 'button', { name: /Close .*ettings/ } ) );
		const restored = await screen.findByRole( 'dialog', { name: 'Add site' } );
		expect( within( restored ).getByLabelText( 'Site name' ) ).toHaveValue( 'Bakery' );
		expect( within( restored ).getByRole( 'textbox', { name: 'Instructions' } ) ).toHaveValue(
			'Build a seasonal bakery site'
		);
		expect(
			await within( restored ).findByRole( 'listitem', { name: /^menu\.txt/ } )
		).toBeVisible();
		expect(
			within( restored ).queryByText( 'Connect a provider to build and edit your site.' )
		).not.toBeInTheDocument();
		expect( within( restored ).queryByRole( 'button', { name: 'Model' } ) ).not.toBeInTheDocument();
		await createSite( restored );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( connector.setSessionProvider ).toHaveBeenCalledWith(
			expect.any( String ),
			'anthropic-api-key',
			expect.any( String )
		);
	} );

	it( 'keeps chat recovery through Settings and retries without creating another site or chat', async () => {
		const { connector, dialog } = await setup();
		connector.setSessionProvider.mockRejectedValueOnce( new Error( 'Provider unavailable' ) );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Build a bakery' },
		} );
		await createSite( dialog );
		expect(
			await screen.findByText( 'Your site was created, but the AI chat could not start.' )
		).toBeVisible();
		act( () => connector.emit( 'onOpenSettings', { settingId: 'ai' } ) );
		const settings = await screen.findByRole( 'dialog', { name: 'Settings' } );
		fireEvent.click( within( settings ).getByRole( 'button', { name: /Close .*ettings/ } ) );
		expect(
			await screen.findByText( 'Your site was created, but the AI chat could not start.' )
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Open site' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( connector.createSite ).toHaveBeenCalledOnce();
		expect( connector.createSession ).toHaveBeenCalledOnce();
	} );

	it( 'leaves the added site intact when going Back after chat setup fails', async () => {
		const { connector, dialog } = await setup();
		connector.createSession.mockRejectedValueOnce( new Error( 'Chat storage unavailable' ) );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Build a bakery' },
		} );
		await createSite( dialog );
		await screen.findByText( 'Your site was created, but the AI chat could not start.' );
		const close = within( dialog ).getByRole( 'button', { name: 'Back' } );
		await waitFor( () => expect( close ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
		fireEvent.click( close );
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( connector.createSite ).toHaveBeenCalledOnce();
	} );

	it( 'starts AI work only after applying the selected Blueprint', async () => {
		const { connector, dialog } = await setup();
		await uploadBlueprint( {
			steps: [ { step: 'setSiteOptions', options: { blogdescription: 'Starter' } } ],
		} );
		await screen.findByText( 'blueprint.json', { selector: 'span' } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Customize this for my bakery' },
		} );
		await createSite( dialog );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ].blueprint ).toBeDefined();
		expect( connector.continueSession.mock.calls[ 0 ][ 1 ] ).toBe( 'Customize this for my bakery' );
	} );

	it( 'uses the placeholder suggestion when the site name is left empty', async () => {
		const { connector, dialog } = await setup();
		expect( within( dialog ).getByRole( 'textbox', { name: 'Site name' } ) ).toHaveValue( '' );
		await createSite( dialog );
		await waitFor( () =>
			expect( connector.createSite ).toHaveBeenCalledWith(
				expect.objectContaining( { name: 'Blue Note', path: '/sites/Blue Note' } )
			)
		);
	} );

	it( 'switches between blank and uploaded Blueprint setup', async () => {
		const { dialog } = await setup();
		expect( within( dialog ).getByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
		await uploadBlueprint( {} );
		expect( await screen.findByRole( 'group', { name: 'Start from (optional)' } ) ).toBeVisible();
		expect( await screen.findByText( 'blueprint.json', { selector: 'span' } ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
		await startBlank();
		expect( await screen.findByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
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
			name: 'Add site',
		} );
		await createSite( dialog );
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalledOnce() );
		expect( button ).toHaveAttribute( 'aria-busy', 'true' );
		expect( within( button ).getByRole( 'status', { name: 'Adding site' } ) ).toBeInTheDocument();
		expect( within( dialog ).getByRole( 'button', { name: 'Close Add site' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		fireEvent.keyDown( document.activeElement!, { key: 'Escape', code: 'Escape' } );
		expect( dialog ).toBeInTheDocument();
	} );

	it( 'identifies an uploaded Blueprint by its filename without extra details', async () => {
		const { user } = await setup();
		await uploadBlueprint( {
			meta: { title: 'Bakery', author: 'Studio' },
			steps: [],
		} as Blueprint );
		const source = await screen.findByRole( 'group', { name: 'Start from (optional)' } );
		expect( await within( source ).findByText( 'blueprint.json' ) ).toBeVisible();
		expect( within( source ).getByRole( 'button', { name: 'Browse Blueprints' } ) ).toBeVisible();
		const remove = within( source ).getByRole( 'button', { name: 'Remove Blueprint' } );
		await user.click( remove );
		expect( within( source ).getByRole( 'button', { name: 'Choose…' } ) ).toBeVisible();
		expect( within( source ).queryByText( 'blueprint.json' ) ).not.toBeInTheDocument();
	} );

	it( 'requires a custom domain for a multisite Blueprint', async () => {
		const { dialog } = await setup();
		await uploadBlueprint( { steps: [ { step: 'enableMultisite' } ] } );
		await screen.findByText( 'blueprint.json', { selector: 'span' } );
		const domain = await screen.findByRole( 'textbox', { name: 'Domain name' } );
		expect( domain ).toHaveAccessibleDescription( 'This Blueprint requires a custom domain.' );
		expect( domain ).toHaveValue( 'network.wp.local' );
		fireEvent.change( domain, { target: { value: 'localhost' } } );
		expect( domain ).toBeInvalid();
		expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
		fireEvent.change( domain, { target: { value: 'network.local' } } );
		expect( domain ).toBeValid();
		expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeEnabled();
	} );

	it( 'uses a selected WordPress folder in place, synchronizes Change, and restores defaults on Remove', async () => {
		const { connector, dialog } = await setup();
		const existing = {
			name: 'Bakery',
			path: '/projects/bakery',
			isEmpty: false,
			isWordPress: true,
		};
		connector.selectSiteFolder.mockImplementation( async ( path, options ) =>
			options?.usePath ? { ...existing, path } : existing
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Choose…' } ) );
		const source = screen.getByRole( 'group', { name: 'Start from (optional)' } );
		await within( source ).findByText( 'Existing WordPress site' );
		expect( within( source ).getByText( 'Bakery' ) ).toBeVisible();
		expect( within( source ).queryByRole( 'button', { name: /Change/ } ) ).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'Site folder' ) ).toHaveValue( '/projects/bakery' );
		expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute( 'readonly' );
		expect( screen.getByRole( 'button', { name: 'Change…' } ) ).toBeEnabled();
		connector.selectSiteFolder.mockResolvedValueOnce( {
			...existing,
			name: 'Another',
			path: '/projects/another',
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await within( source ).findByText( 'another' );
		expect( screen.getByLabelText( 'Site folder' ) ).toHaveValue( '/projects/another' );
		fireEvent.click( within( source ).getByRole( 'button', { name: 'Remove' } ) );
		await within( source ).findByRole( 'button', { name: 'Choose…' } );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute( 'title', '/sites/Bakery' )
		);
		expect( within( source ).queryByText( 'Existing WordPress site' ) ).not.toBeInTheDocument();
		expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeEnabled();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'keeps the selected existing site when Change chooses an empty folder', async () => {
		const { connector } = await setup();
		const existing = {
			name: 'Bakery',
			path: '/projects/bakery',
			isEmpty: false,
			isWordPress: true,
		};
		connector.selectSiteFolder.mockResolvedValue( existing );
		fireEvent.click( screen.getByRole( 'button', { name: 'Choose…' } ) );
		await screen.findByText( 'Existing WordPress site' );
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Empty',
			path: '/projects/empty',
			isEmpty: true,
			isWordPress: false,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await screen.findByText( 'Choose a folder containing an existing WordPress site.' );
		expect( screen.getByLabelText( 'Site folder' ) ).toHaveValue( existing.path );
		expect( screen.getByText( 'Bakery', { selector: 'span' } ) ).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it.each( [
		[ 'bakery.wpress', 'Site backup' ],
		[ 'bakery.xml', 'WordPress export' ],
	] )( 'recognizes a native %s source and retains its destination', async ( name, type ) => {
		const { connector, dialog } = await setup();
		const destination = '/projects/destination';
		connector.selectSiteFolder.mockResolvedValue( {
			name: 'Destination',
			path: destination,
			isEmpty: true,
			isWordPress: false,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute( 'title', destination )
		);
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name,
			path: '/imports/' + name,
			file: { name, path: '/imports/' + name },
			isEmpty: false,
			isWordPress: false,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Choose…' } ) );
		await screen.findByText( type, { selector: 'span' } );
		expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute( 'title', destination );
		await createSite( dialog );
		await waitFor( () =>
			expect( connector.importSiteFromBackup ).toHaveBeenCalledWith(
				expect.any( String ),
				'/imports/' + name,
				{ suppressTracksEvent: true }
			)
		);
		expect( connector.getFilePath ).not.toHaveBeenCalled();
	} );

	it( 'adds an existing WordPress folder as it is', async () => {
		const { connector, dialog, history } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Existing',
			path: '/projects/existing',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Change…' } ) );
		await within( dialog ).findByText(
			'WordPress Studio will use this WordPress site in place. No files will be moved.'
		);
		expect( within( dialog ).getByRole( 'heading', { name: 'Add site' } ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'textbox', { name: 'Instructions' } ) ).toBeVisible();
		await createSite( dialog );
		await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\/|\/new$/ ) );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'flowType' );
		expect( connector.continueSession ).not.toHaveBeenCalled();
	} );
	it.each( [ 'blueprint', 'backup' ] )(
		'keeps an existing folder when a %s is selected and blocks adding it',
		async ( source ) => {
			const { connector, dialog } = await setup();
			connector.selectSiteFolder.mockResolvedValue( {
				name: 'Bakery',
				path: '/projects/bakery',
				isEmpty: false,
				isWordPress: true,
			} );
			fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
			await screen.findByText(
				'WordPress Studio will use this WordPress site in place. No files will be moved.'
			);
			if ( source === 'blueprint' ) await uploadBlueprint( { steps: [] } );
			else
				fireEvent.change( screen.getByLabelText( 'Choose a Blueprint or backup' ), {
					target: { files: [ new File( [ 'backup' ], 'bakery.wpress' ) ] },
				} );
			await screen.findByText(
				'Choose an empty folder to use a source. The selected folder already contains a WordPress site.'
			);
			expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute(
				'title',
				'/projects/bakery'
			);
			expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
			expect( connector.createSite ).not.toHaveBeenCalled();
			await startBlank();
			await waitFor( () =>
				expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeEnabled()
			);
			expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute(
				'title',
				'/projects/bakery'
			);
			expect(
				within( screen.getByRole( 'group', { name: 'Start from (optional)' } ) ).queryByText(
					'/projects/bakery'
				)
			).not.toBeInTheDocument();
		}
	);
	it( 'retains a Blueprint when choosing an empty local folder, including after a name change', async () => {
		const { connector } = await setup();
		await uploadBlueprint( { steps: [] } );
		await screen.findByRole( 'button', { name: 'Remove Blueprint' } );
		connector.selectSiteFolder.mockResolvedValue( {
			name: 'Destination',
			path: '/projects/destination',
			isEmpty: true,
			isWordPress: false,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute(
				'title',
				'/projects/destination'
			)
		);
		fireEvent.change( screen.getByLabelText( 'Site name' ), { target: { value: 'Renamed site' } } );
		expect( screen.getByLabelText( 'Site folder' ) ).toHaveAttribute(
			'title',
			'/projects/destination'
		);
		expect( screen.getByText( 'blueprint.json', { selector: 'span' } ) ).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'accepts a dropped folder through its existing path without opening a picker', async () => {
		const { connector, dialog } = await setup();
		connector.getFilePath.mockResolvedValueOnce( '/projects/bakery' );
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Bakery',
			path: '/projects/bakery',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.drop( dialog, {
			dataTransfer: {
				files: [ new File( [], 'bakery' ) ],
				types: [ 'Files' ],
				items: [ { webkitGetAsEntry: () => ( { isDirectory: true } ) } ],
			},
		} );
		await waitFor( () =>
			expect( within( dialog ).getByLabelText( 'Site folder' ) ).toHaveAttribute(
				'title',
				'/projects/bakery'
			)
		);
		expect( connector.selectSiteFolder ).toHaveBeenCalledWith( '/projects/bakery', {
			allowSiteFiles: true,
			usePath: true,
		} );
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );
	it( 'discards a folder selection that completes after the dialog closes', async () => {
		const { connector, dialog } = await setup();
		let finishSelection!: ( folder: SelectedSiteFolder ) => void;
		connector.selectSiteFolder.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				finishSelection = resolve;
			} )
		);
		connector.getFilePath.mockResolvedValueOnce( '/tmp/late-blueprint' );
		fireEvent.drop( dialog, {
			dataTransfer: {
				files: [ new File( [], 'late-blueprint' ) ],
				types: [ 'Files' ],
				items: [ { webkitGetAsEntry: () => ( { isDirectory: true } ) } ],
			},
		} );
		await waitFor( () => expect( connector.selectSiteFolder ).toHaveBeenCalled() );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Close Add site' } ) );
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		await act( async () =>
			finishSelection( {
				name: 'Late Blueprint',
				path: '/tmp/late-blueprint',
				isEmpty: false,
				isWordPress: false,
				blueprint: {
					blueprintJson: { steps: [] },
					blueprintJsonPath: '/tmp/late-blueprint/blueprint.json',
					tempDir: '/tmp/late-blueprint',
				},
			} )
		);
		await waitFor( () =>
			expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/late-blueprint' )
		);
		expect( connector.createSite ).not.toHaveBeenCalled();
		expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
	} );
} );
