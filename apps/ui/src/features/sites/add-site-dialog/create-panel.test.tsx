import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pendingPromptSlot } from '@/features/composer';
import { createFakeConnector, type FakeConnectorInitialState } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector, SelectedSiteFolder, SyncSite } from '@/data/core';
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
	const dialog = await screen.findByRole( 'dialog', { name: 'Add a WordPress' } );
	await waitFor( () =>
		expect( within( dialog ).getByRole( 'textbox', { name: 'Name' } ) ).toHaveAttribute(
			'placeholder',
			'Blue Note'
		)
	);
	return { ...view, dialog };
}

async function chooseType( label: string ) {
	const user = userEvent.setup();
	await user.click( screen.getByRole( 'combobox', { name: 'Type' } ) );
	await user.click( await screen.findByRole( 'option', { name: label } ) );
}

async function startBlank() {
	await chooseType( 'Blank' );
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
	const input = within( dialog ).getByRole< HTMLInputElement >( 'textbox', { name: 'Name' } );
	if ( ! input.value.trim() ) {
		fireEvent.change( input, { target: { value: input.placeholder } } );
	}
	const button = within( dialog ).getByRole( 'button', { name } );
	await waitFor( () => expect( button ).toBeEnabled() );
	fireEvent.click( button );
}

describe( 'Add site › blank setup', () => {
	it( 'explains optional kickoff instructions without closing setup or changing its draft', async () => {
		const { connector, dialog, user } = await setup();
		const instructions = within( dialog ).getByRole( 'textbox', { name: 'Instructions' } );
		expect( instructions ).toHaveAttribute(
			'placeholder',
			'Share your ideas or inspiration for this site (optional)…'
		);
		fireEvent.change( instructions, { target: { value: 'A warm, welcoming bakery' } } );
		const help = within( dialog ).getByRole( 'button', { name: 'About instructions' } );
		await user.click( help );
		const details = await screen.findByRole( 'dialog', { name: 'Start with inspiration' } );
		expect( details ).toHaveAccessibleDescription(
			'Share your site’s goals, style, or inspiration. Studio uses your instructions and attached files to start an AI chat after creating the site.'
		);
		await user.keyboard( '{Escape}' );
		await waitFor( () => expect( details ).not.toBeInTheDocument() );
		expect( dialog ).toBeVisible();
		expect( help ).toHaveFocus();
		expect( instructions ).toHaveValue( 'A warm, welcoming bakery' );
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it.each( [
		[ 'Blueprint', 'Choose file' ],
		[ 'Backup or export', 'Choose backup or export' ],
	] )( 'requires a source for %s and preserves the edited name', async ( type, action ) => {
		const { connector, dialog } = await setup();
		fireEvent.change( screen.getByLabelText( 'Name' ), { target: { value: 'My bakery' } } );
		await chooseType( type );
		expect(
			within( screen.getByRole( 'group', { name: 'Source' } ) ).getByRole( 'button', {
				name: action,
			} )
		).toBeVisible();
		expect( screen.getByLabelText( 'Name' ) ).toHaveValue( 'My bakery' );
		expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
		await startBlank();
		expect( screen.queryByRole( 'group', { name: 'Source' } ) ).not.toBeInTheDocument();
		await createSite( dialog );
		await waitFor( () =>
			expect( connector.createSite ).toHaveBeenCalledWith(
				expect.objectContaining( { name: 'My bakery' } )
			)
		);
	} );

	it( 'offers only creation sources in Type and explains existing folders below Folder', async () => {
		const { dialog, user } = await setup(
			{},
			{
				capabilities: { nativeFolderPicker: false, annotatePreview: false, studioLogs: false },
			}
		);
		expect( screen.getByLabelText( 'Folder' ) ).toHaveAccessibleDescription(
			expect.stringContaining(
				'You can also choose a folder containing an existing WordPress site.'
			)
		);
		expect( within( dialog ).getByRole( 'button', { name: 'Change…' } ) ).toBeDisabled();
		await user.click( screen.getByRole( 'combobox', { name: 'Type' } ) );
		expect(
			( await screen.findAllByRole( 'option' ) ).map( ( option ) => option.textContent )
		).toEqual( [ 'Blank', 'Blueprint', 'Backup or export' ] );
	} );

	it( 'connects from the first step without a Type field and preserves the draft', async () => {
		const remote = {
			id: 42,
			name: 'Remote bakery',
			url: 'https://bakery.example',
			syncSupport: 'syncable',
			isPressable: false,
		} as SyncSite;
		const { connector, dialog } = await setup(
			{},
			{ fetchSyncableWpcomSites: async () => [ remote ] }
		);
		fireEvent.change( screen.getByLabelText( 'Name' ), { target: { value: 'My bakery' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		fireEvent.click( await screen.findByRole( 'tab', { name: 'Connect' } ) );
		fireEvent.click( await within( dialog ).findByRole( 'button', { name: /Remote bakery/ } ) );
		expect( await screen.findByLabelText( 'Name' ) ).toHaveValue( 'My bakery' );
		expect( screen.queryByRole( 'combobox', { name: 'Type' } ) ).not.toBeInTheDocument();
		expect(
			within( screen.getByRole( 'group', { name: 'Source' } ) ).getByText( 'Remote bakery' )
		).toBeVisible();
		expect(
			within( dialog ).queryByRole( 'textbox', { name: 'Instructions' } )
		).not.toBeInTheDocument();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'ignores a Blueprint load completed after changing its type to blank', async () => {
		const { connector } = await setup();
		let complete!: (
			value: Awaited< ReturnType< Connector[ 'extractBlueprintBundle' ] > >
		) => void;
		connector.extractBlueprintBundle.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				complete = resolve;
			} )
		);
		await chooseType( 'Blueprint' );
		fireEvent.change( screen.getByLabelText( 'Choose a Blueprint or backup' ), {
			target: { files: [ new File( [], 'blueprint.zip' ) ] },
		} );
		await waitFor( () => expect( connector.extractBlueprintBundle ).toHaveBeenCalledOnce() );
		await startBlank();
		await act( async () =>
			complete( {
				blueprintJson: { steps: [] },
				blueprintJsonPath: '/tmp/late/blueprint.json',
				tempDir: '/tmp/late',
			} )
		);
		expect( connector.cleanupBlueprintTempDir ).toHaveBeenCalledWith( '/tmp/late' );
		expect( screen.getByRole( 'combobox', { name: 'Type' } ) ).toHaveTextContent( 'Blank' );
		expect( screen.queryByRole( 'group', { name: 'Source' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows only the selected source after choosing a Blueprint', async () => {
		const { connector, dialog } = await setup();
		fireEvent.change( screen.getByLabelText( 'Name' ), { target: { value: 'My bakery' } } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Make this a bakery' },
		} );
		await uploadBlueprint( { steps: [] } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Browse Blueprints' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Use Blueprint' } ) );
		const source = await screen.findByRole( 'group', { name: 'Source' } );
		expect( within( source ).getByText( 'Portfolio' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Start with a Blueprint' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'region', { name: 'Blueprint cards' } ) ).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'Name' ) ).toHaveValue( 'My bakery' );
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

	it( 'keeps an uploaded Blueprint selected when changing its source and returning from the gallery', async () => {
		const { dialog } = await setup();
		const contents = JSON.stringify( { steps: [], meta: { title: 'Bakery', author: 'Studio' } } );
		const file = new File( [ contents ], 'dropped-blueprint.json', { type: 'application/json' } );
		Object.defineProperty( file, 'text', { value: async () => contents } );
		fireEvent.change( within( dialog ).getByLabelText( 'Choose a Blueprint or backup' ), {
			target: { files: [ file ] },
		} );
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
		expect( screen.getByRole( 'combobox', { name: 'Type' } ) ).toHaveTextContent( 'Blank' );
		expect(
			screen.queryByRole( 'button', { name: 'Start with a Blueprint' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Browse all' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'group', { name: 'Source' } ) ).not.toBeInTheDocument();
		await createSite( dialog );
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalledOnce() );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'blueprint' );
	} );

	it( 'chooses a backup inline and retains the name and AI brief when returning to blank', async () => {
		const { dialog } = await setup();
		fireEvent.change( screen.getByLabelText( 'Name' ), { target: { value: 'My bakery' } } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'A bakery with a weekly menu' },
		} );
		expect( screen.getByRole( 'combobox', { name: 'Type' } ) ).toHaveTextContent( 'Blank' );
		expect( screen.queryByRole( 'group', { name: 'Source' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toBeVisible();
		expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
		expect(
			within( screen.getByRole( 'dialog', { name: 'Add a WordPress' } ) ).getByRole( 'button', {
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
		expect( screen.getByLabelText( 'Name' ) ).toHaveValue( 'My bakery' );
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
		fireEvent.change( screen.getByLabelText( 'Name' ), { target: { value: 'My portfolio' } } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Instructions' } ), {
			target: { value: 'Add my photography projects' },
		} );
		expect( screen.getByRole( 'textbox', { name: 'Instructions' } ) ).toBeVisible();
		await uploadBlueprint( { steps: [] } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Browse Blueprints' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'View Portfolio' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
		expect( await screen.findByLabelText( 'Name' ) ).toHaveValue( 'My portfolio' );
		expect( screen.getByRole( 'group', { name: 'Source' } ) ).toBeVisible();
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
		fireEvent.change( within( dialog ).getByLabelText( 'Name' ), {
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
		fireEvent.change( within( dialog ).getByLabelText( 'Name' ), {
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
		const restored = await screen.findByRole( 'dialog', { name: 'Add a WordPress' } );
		expect( within( restored ).getByLabelText( 'Name' ) ).toHaveValue( 'Bakery' );
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

	it( 'keeps the suggested name out of the folder until a name is entered', async () => {
		const { connector, dialog } = await setup();
		expect( within( dialog ).getByRole( 'textbox', { name: 'Name' } ) ).toHaveValue( '' );
		expect( within( dialog ).getByLabelText( 'Folder' ) ).toHaveValue( '' );
		await waitFor( () =>
			expect( within( dialog ).getByLabelText( 'Folder' ) ).toHaveAttribute( 'title', '/sites/' )
		);
		expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
		expect( connector.generateProposedSitePath ).not.toHaveBeenCalled();
		fireEvent.change( within( dialog ).getByRole( 'textbox', { name: 'Name' } ), {
			target: { value: 'Blue Note' },
		} );
		await createSite( dialog );
		await waitFor( () =>
			expect( connector.createSite ).toHaveBeenCalledWith(
				expect.objectContaining( { name: 'Blue Note', path: '/sites/Blue Note' } )
			)
		);
	} );

	it( 'switches between blank and uploaded Blueprint setup', async () => {
		const { dialog } = await setup();
		expect( within( dialog ).getByRole( 'heading', { name: 'Add a WordPress' } ) ).toBeVisible();
		await uploadBlueprint( {} );
		expect( await screen.findByRole( 'group', { name: 'Source' } ) ).toBeVisible();
		expect( await screen.findByText( 'blueprint.json', { selector: 'span' } ) ).toBeVisible();
		expect( within( dialog ).getByRole( 'heading', { name: 'Add a WordPress' } ) ).toBeVisible();
		await startBlank();
		expect( await screen.findByRole( 'heading', { name: 'Add a WordPress' } ) ).toBeVisible();
	} );

	it( 'submits a blank site and opens its workspace without starting AI work', async () => {
		const { connector, dialog, history } = await setup();
		const name = within( dialog ).getByRole( 'textbox', { name: 'Name' } );
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
		const source = await screen.findByRole( 'group', { name: 'Source' } );
		expect( await within( source ).findByText( 'blueprint.json' ) ).toBeVisible();
		expect( within( source ).getByRole( 'button', { name: 'Browse Blueprints' } ) ).toBeVisible();
		const remove = within( source ).getByRole( 'button', { name: 'Remove Blueprint' } );
		await user.click( remove );
		expect( within( source ).getByRole( 'button', { name: 'Choose file' } ) ).toBeVisible();
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

	it( 'chooses an existing site through Folder and can return to an empty destination', async () => {
		const { connector, dialog } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Bakery',
			path: '/projects/bakery',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await screen.findByText(
			'Studio will use this WordPress site in place. No files will be moved.'
		);
		expect( screen.getByLabelText( 'Folder' ) ).toHaveValue( '/projects/bakery' );
		expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute( 'readonly' );
		expect( screen.queryByRole( 'group', { name: 'Source' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'combobox', { name: 'Type' } ) ).toHaveTextContent( 'Blank' );
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Destination',
			path: '/projects/destination',
			isEmpty: true,
			isWordPress: false,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute(
				'title',
				'/projects/destination'
			)
		);
		expect( screen.getByLabelText( 'Folder' ) ).not.toHaveAttribute( 'readonly' );
		expect(
			screen.queryByText( 'Studio will use this WordPress site in place. No files will be moved.' )
		).not.toBeInTheDocument();
		expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeEnabled();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'keeps an existing folder when the folder picker is cancelled', async () => {
		const { connector } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Bakery',
			path: '/projects/bakery',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await screen.findByText(
			'Studio will use this WordPress site in place. No files will be moved.'
		);
		connector.selectSiteFolder.mockResolvedValueOnce( null );
		fireEvent.click( screen.getByRole( 'button', { name: 'Change…' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Change…' } ) ).toBeEnabled()
		);
		expect( screen.getByLabelText( 'Folder' ) ).toHaveValue( '/projects/bakery' );
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
			expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute( 'title', destination )
		);
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name,
			path: '/imports/' + name,
			file: { name, path: '/imports/' + name },
			isEmpty: false,
			isWordPress: false,
		} );
		await chooseType( 'Backup or export' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Choose backup or export' } ) );
		await screen.findByText( type, { selector: 'span' } );
		expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute( 'title', destination );
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
			'Studio will use this WordPress site in place. No files will be moved.'
		);
		expect( within( dialog ).getByRole( 'heading', { name: 'Add a WordPress' } ) ).toBeVisible();
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
				'Studio will use this WordPress site in place. No files will be moved.'
			);
			if ( source === 'blueprint' ) await uploadBlueprint( { steps: [] } );
			else
				fireEvent.change( screen.getByLabelText( 'Choose a Blueprint or backup' ), {
					target: { files: [ new File( [ 'backup' ], 'bakery.wpress' ) ] },
				} );
			await screen.findByText(
				'Choose an empty folder to use a source. The selected folder already contains a WordPress site.'
			);
			expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute( 'title', '/projects/bakery' );
			expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
			expect( connector.createSite ).not.toHaveBeenCalled();
			await startBlank();
			await waitFor( () =>
				expect( within( dialog ).getByRole( 'button', { name: 'Add site' } ) ).toBeEnabled()
			);
			expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute( 'title', '/projects/bakery' );
			expect(
				screen.queryByText( '/projects/bakery', { selector: 'span' } )
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
			expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute(
				'title',
				'/projects/destination'
			)
		);
		fireEvent.change( screen.getByLabelText( 'Name' ), { target: { value: 'Renamed site' } } );
		expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute( 'title', '/projects/destination' );
		expect( screen.getByText( 'blueprint.json', { selector: 'span' } ) ).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it.each( [
		[ 'Blueprint', 'drop-blueprint.json', 'Choose file' ],
		[ 'Backup or export', 'drop-backup.wpress', 'Choose backup or export' ],
	] )( 'accepts %s drops within the source control', async ( type, filename, button ) => {
		const { connector, dialog } = await setup();
		fireEvent.change( screen.getByLabelText( 'Name' ), { target: { value: 'My bakery' } } );
		await chooseType( type );
		const source = screen.getByRole( 'group', { name: 'Source' } );
		const target = within( source ).getByRole( 'button', { name: button } );
		const contents = JSON.stringify( { steps: [] } );
		const file = new File( [ contents ], filename );
		Object.defineProperty( file, 'text', { value: async () => contents } );
		const dataTransfer = { files: [ file ], types: [ 'Files' ] };
		fireEvent.dragEnter( target, { dataTransfer } );
		expect( target.closest( '[data-dragging]' ) ).toBeInTheDocument();
		expect( dialog ).not.toHaveAttribute( 'data-dragging' );
		expect( screen.queryByText( 'Drop to add site' ) ).not.toBeInTheDocument();
		fireEvent.drop( target, { dataTransfer } );
		expect( await screen.findByText( filename, { selector: 'span' } ) ).toBeVisible();
		expect( source.querySelector( '[data-dragging]' ) ).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'Name' ) ).toHaveValue( 'My bakery' );
		expect( screen.getByRole( 'combobox', { name: 'Type' } ) ).toHaveTextContent( type );
		expect( connector.createSite ).not.toHaveBeenCalled();
		if ( type === 'Blueprint' ) {
			fireEvent.drop( screen.getByText( filename, { selector: 'span' } ), {
				dataTransfer: {
					files: [ new File( [ 'backup' ], 'replacement.wpress' ) ],
					types: [ 'Files' ],
				},
			} );
			expect( await screen.findByText( 'replacement.wpress' ) ).toBeVisible();
			expect( screen.getByRole( 'combobox', { name: 'Type' } ) ).toHaveTextContent(
				'Backup or export'
			);
		}
	} );

	it( 'uses a WordPress folder dropped within the source control in place', async () => {
		const { connector, dialog } = await setup();
		await chooseType( 'Blueprint' );
		connector.getFilePath.mockResolvedValueOnce( '/projects/bakery' );
		connector.selectSiteFolder.mockResolvedValueOnce( {
			name: 'Bakery',
			path: '/projects/bakery',
			isEmpty: false,
			isWordPress: true,
		} );
		fireEvent.drop( screen.getByRole( 'button', { name: 'Choose file' } ), {
			dataTransfer: {
				files: [ new File( [], 'bakery' ) ],
				types: [ 'Files' ],
				items: [ { webkitGetAsEntry: () => ( { isDirectory: true } ) } ],
			},
		} );
		await screen.findByText(
			'Studio will use this WordPress site in place. No files will be moved.'
		);
		expect( screen.getByLabelText( 'Folder' ) ).toHaveValue( '/projects/bakery' );
		expect( screen.getByLabelText( 'Folder' ) ).toHaveAttribute( 'readonly' );
		expect( connector.selectSiteFolder ).toHaveBeenCalledWith( '/projects/bakery', {
			allowSiteFiles: true,
			usePath: true,
		} );
		expect( dialog ).not.toHaveAttribute( 'data-dragging' );
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'ignores source drops over the second-step form', async () => {
		const { connector, dialog } = await setup();
		const dataTransfer = {
			files: [ new File( [], 'bakery' ) ],
			types: [ 'Files' ],
			items: [ { webkitGetAsEntry: () => ( { isDirectory: true } ) } ],
		};
		for ( const target of [
			dialog,
			screen.getByLabelText( 'Name' ),
			within( dialog ).getByRole( 'button', { name: 'Add site' } ),
		] ) {
			fireEvent.dragEnter( target, { dataTransfer } );
			expect( dialog ).not.toHaveAttribute( 'data-dragging' );
			expect( screen.queryByText( 'Drop to add site' ) ).not.toBeInTheDocument();
			expect( fireEvent.drop( target, { dataTransfer } ) ).toBe( false );
		}
		expect( screen.getByRole( 'combobox', { name: 'Type' } ) ).toHaveTextContent( 'Blank' );
		expect( connector.selectSiteFolder ).not.toHaveBeenCalled();
		expect( connector.extractBlueprintBundle ).not.toHaveBeenCalled();
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
		await chooseType( 'Blueprint' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Choose file' } ) );
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
		expect( screen.queryByRole( 'dialog', { name: 'Add a WordPress' } ) ).not.toBeInTheDocument();
	} );
} );
