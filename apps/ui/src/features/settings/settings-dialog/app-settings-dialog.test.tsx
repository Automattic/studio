import { supportedLocaleNames } from '@studio/common/lib/locale';
import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { INTERFACE_PREFERENCE_DEFAULTS } from '@studio/common/lib/user-settings/preferences';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests } from '@/data/app-messages';
import {
	PANEL_WIDTHS_RESET_EVENT,
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	SIDEBAR_COLLAPSED_STORAGE_KEY,
	SIDEBAR_PANEL_STORAGE_KEY,
} from '@/data/resizable-panels';
import { applyColorTint, DEFAULT_COLOR_TINT } from '@/lib/theme';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector, UserPreferences } from '@/data/core';

beforeEach( () => {
	resetAppMessagesForTests();
	localStorage.clear();
} );

const ERROR = 'An error occurred while saving settings. Please try again.';

async function setup( {
	section = 'general',
	signedIn = true,
	preferences = {},
	overrides = {},
	nativeFolderPicker = false,
}: {
	section?: string;
	signedIn?: boolean;
	preferences?: Partial< UserPreferences >;
	overrides?: Partial< Connector >;
	nativeFolderPicker?: boolean;
} = {} ) {
	let connection = {
		provider: 'wpcom' as const,
		hasAnthropicApiKey: true,
		anthropicApiKeyPreview: 'sk-…last',
	};
	let skills = [
		{
			id: 'studio-cli',
			displayName: 'WordPress Studio CLI',
			description: 'CLI workflows',
			installed: false,
		},
		{
			id: 'wordpress',
			displayName: 'WordPress',
			description: 'WordPress workflows',
			installed: false,
		},
	];
	const connector = createFakeConnector(
		{
			sites: [ makeSite( { id: 'one' } ) ],
			preferences: { colorScheme: 'system', ...preferences },
			...( signedIn ? {} : { user: null } ),
		},
		{
			getAgentInstructions: async () => 'Original instructions',
			getAiSettings: async () => connection,
			saveAnthropicApiKey: async ( key ) => {
				connection = {
					...connection,
					hasAnthropicApiKey: !! key,
					anthropicApiKeyPreview: key ? 'sk-…last' : ( null as never ),
				};
				return connection;
			},
			setAiProvider: async ( provider ) => {
				connection = { ...connection, provider: provider as 'wpcom' };
				return connection;
			},
			getWordPressSkillsStatusAllSites: async () => skills,
			installWordPressSkillToAllSites: async ( id ) => {
				skills = skills.map( ( skill ) =>
					skill.id === id ? { ...skill, installed: true } : skill
				);
			},
			removeWordPressSkillFromAllSites: async ( id ) => {
				skills = skills.map( ( skill ) =>
					skill.id === id ? { ...skill, installed: false } : skill
				);
			},
			getStudioAssistantQuota: async () => null,
			getSnapshotUsage: async () => ( { siteCount: 2, siteLimit: 10 } ) as never,
			getSnapshots: async () =>
				[
					{ atomicSiteId: 1, localSiteId: 'one', userId: TEST_USER.id, url: 'one.example.com' },
					{ atomicSiteId: 2, localSiteId: 'two', userId: TEST_USER.id, url: 'two.example.com' },
				].map( ( snapshot ) => ( { ...snapshot, date: Date.now() } ) ) as never,
			...overrides,
		}
	);
	connector.capabilities = { ...connector.capabilities, nativeFolderPicker };
	const view = renderApp( { connector, path: `/sites/one?settings=${ section }` } );
	await screen.findByRole( 'dialog', { name: 'Settings' } );
	const settingsParam = () => new URLSearchParams( view.history.location.search ).get( 'settings' );
	return { ...view, settingsParam };
}

async function choose( combobox: string, option: string ) {
	fireEvent.click( await screen.findByRole( 'combobox', { name: combobox } ) );
	const item = await screen.findByRole( 'option', { name: option } );
	fireEvent.pointerDown( item, { pointerType: 'mouse' } );
	fireEvent.click( item );
}

const row = ( id: string ) =>
	document.querySelector< HTMLElement >( `[data-setting-id="${ id }"]` )!;
// The site form stays mounted (hidden) in Studio scope, with its own connection card.
const studioConnect = async () => {
	await screen.findAllByRole( 'button', { name: 'Connect' } );
	return screen
		.getAllByRole( 'button', { name: 'Connect' } )
		.find( ( button ) => ! button.closest( 'form' ) )!;
};
const searchBox = () => screen.getByRole( 'textbox', { name: 'Search settings' } );

describe( 'WordPress Studio settings', () => {
	it.each( [ undefined, true, false ] )(
		'saves recent chats visibility from %s',
		async ( value ) => {
			const { connector } = await setup( { preferences: { showRecentChats: value } } );
			const toggle = await screen.findByRole( 'switch', { name: 'Show recent chats' } );
			if ( value ?? true ) {
				expect( toggle ).toBeChecked();
			} else {
				expect( toggle ).not.toBeChecked();
			}
			fireEvent.click( toggle );
			await waitFor( () =>
				expect( connector.setUserPreferences ).toHaveBeenCalledWith(
					{ showRecentChats: ! ( value ?? true ) },
					undefined
				)
			);
		}
	);

	it( 'disables interface reset when saved preferences and panel widths match the defaults', async () => {
		await setup();
		expect( await screen.findByRole( 'button', { name: 'Reset interface' } ) ).toBeDisabled();
	} );

	it.each( [
		{ colorScheme: 'dark' as const },
		{ newSiteBehavior: 'blank' as const },
		{ accentColor: '#069e08' },
		{ tintIntensity: 20 },
		{ contrast: 30 },
		{ quitSitesBehavior: 'stop' as const },
		{ showRecentChats: false },
		{ autoStartSiteOnChat: true },
		{ autoCollapseSites: false },
		{ sidebarPinnedSort: 'manual' as const },
		{ sidebarSiteSort: 'status' as const },
		{ sidebarChatSort: 'manual' as const },
	] )( 'enables interface reset for changed preferences: %j', async ( preferences ) => {
		await setup( { preferences } );
		expect( await screen.findByRole( 'button', { name: 'Reset interface' } ) ).toBeEnabled();
	} );

	it( 'restores sidebar sorting without removing pins or saved chat order', async () => {
		const sidebarPins = [ 'site:one' ];
		const sidebarChatOrder = { one: [ 'chat-one', 'chat-two' ] };
		const { connector } = await setup( {
			preferences: {
				sidebarPinnedSort: 'manual',
				sidebarSiteSort: 'status',
				sidebarChatSort: 'manual',
				sidebarPins,
				sidebarChatOrder,
			},
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Reset interface' } ) );
		await waitFor( () => {
			expect( connector.state.preferences ).toMatchObject( {
				sidebarPinnedSort: 'type',
				sidebarSiteSort: 'manual',
				sidebarChatSort: 'updated',
				sidebarPins,
				sidebarChatOrder,
			} );
		} );
		expect( screen.getByRole( 'button', { name: 'Reset interface' } ) ).toBeDisabled();
	} );

	it( 'resets only interface preferences and saved panel widths', async () => {
		localStorage.setItem( SIDEBAR_PANEL_STORAGE_KEY, '320' );
		localStorage.setItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY, '600' );
		localStorage.setItem( SIDEBAR_COLLAPSED_STORAGE_KEY, 'true' );
		localStorage.setItem( 'unrelated-key', 'one' );
		const reset = vi.fn();
		window.addEventListener( PANEL_WIDTHS_RESET_EVENT, reset );
		const { connector, settingsParam } = await setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Reset interface' } ) );
		await waitFor( () => expect( reset ).toHaveBeenCalledOnce() );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Reset interface' } ) ).toBeDisabled()
		);
		expect( connector.setUserPreferences ).toHaveBeenCalledExactlyOnceWith(
			{ ...INTERFACE_PREFERENCE_DEFAULTS },
			undefined
		);
		expect( localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBeNull();
		expect( localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBeNull();
		expect( localStorage.getItem( SIDEBAR_COLLAPSED_STORAGE_KEY ) ).not.toBe( 'true' );
		expect( localStorage.getItem( 'unrelated-key' ) ).toBe( 'one' );
		expect( settingsParam() ).toBe( 'general' );
		window.removeEventListener( PANEL_WIDTHS_RESET_EVENT, reset );
	} );

	it( 'resets saved colors and the live tint when resetting the interface', async () => {
		const customTint = { accentColor: '#069e08', tintIntensity: 40, contrast: 30 };
		applyColorTint( customTint );
		const { connector } = await setup( { preferences: { colorScheme: 'dark', ...customTint } } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Reset interface' } ) );
		await waitFor( () => {
			expect( document.documentElement.dataset.accentColor ).toBe( DEFAULT_COLOR_TINT.accentColor );
			expect( document.documentElement.style.getPropertyValue( '--tint-intensity' ) ).toBe(
				String( DEFAULT_COLOR_TINT.tintIntensity )
			);
			expect( document.documentElement.style.getPropertyValue( '--contrast' ) ).toBe(
				String( DEFAULT_COLOR_TINT.contrast )
			);
		} );
		expect( connector.setUserPreferences ).toHaveBeenCalledWith(
			expect.objectContaining( DEFAULT_COLOR_TINT ),
			undefined
		);
	} );

	it( 'keeps panel widths when resetting preferences fails and allows retry', async () => {
		localStorage.setItem( SIDEBAR_PANEL_STORAGE_KEY, '320' );
		const { connector } = await setup();
		connector.setUserPreferences.mockRejectedValueOnce( new Error( 'Reset failed' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Reset interface' } ) );
		expect( await screen.findByText( ERROR ) ).toBeVisible();
		expect( localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBe( '320' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Reset interface' } ) );
		await waitFor( () => expect( localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBeNull() );
	} );

	it( 'starts WordPress.com signup from the launch card and hides it after sign-in', async () => {
		const { connector } = await setup( { signedIn: false } );
		let finishLogin!: () => void;
		connector.authenticate.mockImplementation(
			() =>
				new Promise< void >( ( resolve ) => {
					finishLogin = resolve;
				} )
		);
		const connect = await studioConnect();
		expect( connect.closest( '[data-settings-row]' ) ).toHaveTextContent(
			'Do more with WordPress.com'
		);
		fireEvent.click( connect );
		await waitFor( () => expect( connect ).toHaveAttribute( 'aria-busy', 'true' ) );
		expect( connect ).toHaveAttribute( 'aria-disabled', 'true' );
		connector.state.user = TEST_USER;
		await act( async () => finishLogin() );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Connect' } ) ).not.toBeInTheDocument()
		);
		expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith( true, 'settings' );
	} );

	it( 'keeps the launch card available when connection fails', async () => {
		const { connector } = await setup( { signedIn: false } );
		connector.authenticate.mockRejectedValue( new Error( 'Connection failed' ) );
		fireEvent.click( await studioConnect() );
		expect( await screen.findByText( 'Connection failed' ) ).toBeVisible();
		expect( await studioConnect() ).toBeEnabled();
	} );

	it( 'hides the launch card for connected accounts', async () => {
		await setup();
		await screen.findByRole( 'combobox', { name: 'Language' } );
		expect( screen.queryByRole( 'button', { name: 'Connect' } ) ).not.toBeInTheDocument();
	} );

	it.each( [
		[ 'the browser', { platform: 'browser', isWindowsStore: false } ],
		[ 'Windows Store builds', { platform: 'win32', isWindowsStore: true } ],
	] )( 'hides the CLI fieldset in %s', async ( _host, appGlobals ) => {
		await setup( { overrides: { getAppGlobals: async () => appGlobals as never } } );
		await screen.findByRole( 'combobox', { name: 'Language' } );
		expect( screen.queryByRole( 'group', { name: 'Studio CLI' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'switch', { name: 'Studio CLI for terminal' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows the CLI toggle on desktop', async () => {
		const { connector } = await setup();
		const toggle = await screen.findByRole( 'switch', { name: 'Studio CLI for terminal' } );
		expect( toggle ).toBeEnabled();
		fireEvent.click( toggle );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ studioCliInstalled: true },
				undefined
			)
		);
	} );

	it( 'shows account details above General preferences and supports logging out', async () => {
		const { connector } = await setup();
		await screen.findByRole( 'combobox', { name: 'Language' } );
		expect( await screen.findByText( TEST_USER.email ) ).toBeVisible();
		expect( screen.getByText( TEST_USER.displayName ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Account' } ) ).not.toBeInTheDocument();
		const general = screen.getByRole( 'tabpanel', { name: 'General' } );
		expect( within( general ).getAllByRole( 'group' )[ 0 ] ).toHaveTextContent( TEST_USER.email );
		fireEvent.click( screen.getByRole( 'button', { name: 'Log out' } ) );
		await waitFor( () => expect( connector.logout ).toHaveBeenCalledExactlyOnceWith() );
		expect( await studioConnect() ).toBeVisible();
		expect( screen.queryByText( TEST_USER.email ) ).not.toBeInTheDocument();
	} );

	it.each( [
		[ 'Create account', true ],
		[ 'Log in', false ],
	] as const )( 'opens the %s flow from Sharing Settings', async ( label, signup ) => {
		const { connector } = await setup( { section: 'sharing', signedIn: false } );
		expect( await screen.findByRole( 'tab', { name: 'Sharing' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		expect( await screen.findByRole( 'heading', { name: 'Share your WordPress' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: label } ) );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith( signup, 'previews_tab' )
		);
	} );

	it( 'connects a signed-out account from General', async () => {
		const { connector } = await setup( { signedIn: false } );
		expect( screen.queryByRole( 'tab', { name: 'Account' } ) ).not.toBeInTheDocument();
		fireEvent.click( await studioConnect() );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith( true, 'settings' )
		);
	} );

	it( 'disables Connect while offline', async () => {
		const online = vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		try {
			await setup( { signedIn: false } );
			expect( await studioConnect() ).toBeDisabled();
		} finally {
			online.mockRestore();
		}
	} );

	it( 'offers Default, the installed editors and a saved editor that is gone', async () => {
		const { connector } = await setup( { preferences: { editor: 'cursor' } } );
		fireEvent.click( await screen.findByRole( 'combobox', { name: 'Code editor' } ) );
		const options = await screen.findAllByRole( 'option' );
		expect( options.map( ( option ) => option.textContent ) ).toEqual( [
			'Default',
			supportedEditorConfig.cursor.label(),
			supportedEditorConfig.vscode.label(),
		] );
		fireEvent.pointerDown( options[ 0 ], { pointerType: 'mouse' } );
		fireEvent.click( options[ 0 ] );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith( { editor: null }, undefined )
		);
	} );

	it( 'turns the annotation delete confirmation back on', async () => {
		const { connector } = await setup( { preferences: { confirmDeleteAnnotations: false } } );
		fireEvent.click(
			await screen.findByRole( 'switch', { name: 'Confirm before deleting annotations' } )
		);
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ confirmDeleteAnnotations: true },
				undefined
			)
		);
	} );

	it( 'clears the persisted cache and reloads after saving a new language', async () => {
		const location = window.location;
		const reload = vi.fn();
		Object.defineProperty( window, 'location', {
			configurable: true,
			value: { ...location, reload },
		} );
		localStorage.setItem( 'REACT_QUERY_OFFLINE_CACHE', '{}' );
		try {
			const { connector } = await setup();
			await choose( 'Language', supportedLocaleNames.es );
			await waitFor( () => expect( reload ).toHaveBeenCalledOnce() );
			expect( connector.setUserPreferences ).toHaveBeenCalledWith( { locale: 'es' }, undefined );
			expect( localStorage.getItem( 'REACT_QUERY_OFFLINE_CACHE' ) ).toBeNull();
		} finally {
			Object.defineProperty( window, 'location', { configurable: true, value: location } );
		}
	} );

	it( 'says so when a linked setting is not available on this device', async () => {
		await setup( { section: 'general&settingsFocus=future-setting' } );
		expect(
			await screen.findByText( 'This setting is not available on this device' )
		).toBeVisible();
	} );

	it( 'disables reset for default colors with a non-default theme', async () => {
		const { connector } = await setup( {
			section: 'appearance',
			preferences: { colorScheme: 'dark' },
		} );
		const reset = await screen.findByRole( 'button', { name: 'Reset' } );
		expect( reset ).toBeDisabled();
		fireEvent.click( reset );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
	} );

	it.each( [ { accentColor: '#069e08' }, { tintIntensity: 50 }, { contrast: 25 } ] )(
		'enables reset for a changed appearance preference: %j',
		async ( preferences ) => {
			await setup( { section: 'appearance', preferences } );
			expect( await screen.findByRole( 'button', { name: 'Reset' } ) ).toBeEnabled();
		}
	);

	it( 'resets colors while preserving the theme', async () => {
		const { connector } = await setup( {
			section: 'appearance',
			preferences: { colorScheme: 'dark', tintIntensity: 40 },
		} );
		expect( screen.queryByRole( 'button', { name: 'Done' } ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Reset' } ) );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith( DEFAULT_COLOR_TINT, undefined )
		);
	} );

	it( 'restores saved appearance after a failed background save', async () => {
		const { connector } = await setup( { section: 'appearance' } );
		let failSave: ( error: Error ) => void = () => {};
		connector.setUserPreferences.mockImplementationOnce(
			() =>
				new Promise< void >( ( _resolve, reject ) => {
					failSave = reject;
				} )
		);
		const theme = await screen.findByRole( 'combobox', { name: 'Theme' } );
		await choose( 'Theme', 'Dark' );
		await waitFor( () => expect( theme ).toHaveTextContent( 'Dark' ) );
		await waitFor( () => expect( connector.setUserPreferences ).toHaveBeenCalledOnce() );
		await act( async () => failSave( new Error( 'Unable to save appearance' ) ) );
		await waitFor( () => expect( theme ).toHaveTextContent( 'System' ) );
		expect( await screen.findByText( ERROR ) ).toBeVisible();
		expect( theme ).toBeEnabled();
	} );

	it( 'keeps the current panel while searching and opens the selected field', async () => {
		const { connector } = await setup( { section: 'keyboard' } );
		fireEvent.change( searchBox(), { target: { value: 'theme' } } );
		expect( screen.queryByRole( 'combobox', { name: 'Theme' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Theme' } ) );
		const control = await screen.findByRole( 'combobox', { name: 'Theme' } );
		await waitFor( () => expect( row( 'theme' ) ).toHaveAttribute( 'data-settings-match' ) );
		expect( row( 'theme' ) ).toContainElement( control );
		await choose( 'Theme', 'Dark' );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ colorScheme: 'dark' },
				undefined
			)
		);
		expect( searchBox() ).toHaveValue( 'theme' );
		expect( screen.getByRole( 'tab', { name: 'Theme' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Clear search' } ) );
		expect( screen.getByRole( 'heading', { name: 'Appearance' } ) ).toBeVisible();
	} );

	it.each( [ undefined, true, false ] )(
		'saves the sidebar expansion preference from %s',
		async ( value ) => {
			const { connector } = await setup( { preferences: { autoCollapseSites: value } } );
			const toggle = await screen.findByRole( 'switch', { name: 'Collapse sidebar groups' } );
			if ( value ?? true ) {
				expect( toggle ).toBeChecked();
			} else {
				expect( toggle ).not.toBeChecked();
			}
			fireEvent.click( toggle );
			await waitFor( () =>
				expect( connector.setUserPreferences ).toHaveBeenCalledWith(
					{ autoCollapseSites: ! ( value ?? true ) },
					undefined
				)
			);
		}
	);

	it( 'uses the shared sidebar tabs and persists an explicit directory edit', async () => {
		const { connector, settingsParam } = await setup();
		await screen.findByRole( 'tab', { name: 'Usage' } );
		expect(
			within( screen.getByRole( 'tablist', { name: 'Settings sections' } ) )
				.getAllByRole( 'tab' )
				.map( ( tab ) => tab.textContent )
		).toEqual( [
			'General',
			'Appearance',
			'Sharing',
			'AI Providers',
			'MCP',
			'Usage',
			'Skills',
			'Instructions',
			'Keyboard',
		] );
		const directory = await screen.findByRole( 'textbox', { name: 'Default directory' } );
		fireEvent.change( directory, { target: { value: '/new-sites' } } );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
		fireEvent.click( within( row( 'default-directory' ) ).getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ defaultSiteDirectory: '/new-sites' },
				undefined
			)
		);
		expect( settingsParam() ).toBe( 'general' );
	} );

	it( 'keeps a typed directory when saving it fails', async () => {
		const { connector } = await setup();
		connector.setUserPreferences.mockRejectedValueOnce( new Error( 'Save failed' ) );
		const directory = await screen.findByRole( 'textbox', { name: 'Default directory' } );
		fireEvent.change( directory, { target: { value: ' /new-sites ' } } );
		fireEvent.click( within( row( 'default-directory' ) ).getByRole( 'button', { name: 'Save' } ) );
		expect( await screen.findByText( ERROR ) ).toBeVisible();
		expect( directory ).toHaveValue( ' /new-sites ' );
	} );

	it.each( [ '/chosen-sites', null ] )(
		'applies a picked directory immediately unless canceled (%s)',
		async ( selected ) => {
			const { connector } = await setup( {
				nativeFolderPicker: true,
				overrides: { selectDefaultSiteDirectory: async () => selected },
			} );
			const choose_ = await screen.findByRole( 'button', {
				name: 'Default directory: /sites. Choose a different folder.',
			} );
			expect(
				screen.queryByRole( 'textbox', { name: 'Default directory' } )
			).not.toBeInTheDocument();
			expect(
				within( row( 'default-directory' ) ).queryByRole( 'button', { name: 'Save' } )
			).not.toBeInTheDocument();
			fireEvent.click( choose_ );
			await waitFor( () =>
				expect( connector.selectDefaultSiteDirectory ).toHaveBeenCalledWith( '/sites' )
			);
			if ( selected ) {
				await waitFor( () =>
					expect( connector.setUserPreferences ).toHaveBeenCalledWith(
						{ defaultSiteDirectory: selected },
						undefined
					)
				);
			} else {
				expect( connector.setUserPreferences ).not.toHaveBeenCalled();
			}
		}
	);
} );

describe( 'WordPress Studio settings: AI, instructions, skills and MCP', () => {
	const providerRow = ( id: string ) => {
		const element = row( id );
		if ( ! element ) {
			throw new Error( `No row ${ id }` );
		}
		return element;
	};
	const findProviderRow = ( id: string ) => waitFor( () => providerRow( id ) );

	it( 'clears a saved key without switching providers', async () => {
		const { connector } = await setup( { section: 'ai' } );
		fireEvent.click(
			await within( await findProviderRow( 'anthropic-provider' ) ).findByRole( 'button', {
				name: 'Manage',
			} )
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Remove key' } ) );
		await waitFor( () => expect( connector.saveAnthropicApiKey ).toHaveBeenCalledWith( null ) );
		expect( connector.setAiProvider ).not.toHaveBeenCalled();
	} );

	it( 'toggles custom instructions without changing saved text', async () => {
		let enabled = true;
		const { connector } = await setup( {
			section: 'instructions',
			overrides: {
				getAgentInstructionsEnabled: async () => enabled,
				setAgentInstructionsEnabled: async ( value ) => {
					enabled = value;
				},
			},
		} );
		const toggle = await screen.findByRole( 'switch', { name: 'Agent instructions' } );
		await waitFor( () => expect( toggle ).toBeEnabled() );
		fireEvent.click( toggle );
		await waitFor( () => expect( toggle ).not.toBeChecked() );
		expect( connector.setAgentInstructionsEnabled ).toHaveBeenCalledWith( false );
		expect( connector.saveAgentInstructions ).not.toHaveBeenCalled();
		expect(
			await screen.findByRole( 'textbox', { name: 'WordPress Studio instructions' } )
		).toHaveValue( 'Original instructions' );
		fireEvent.click( toggle );
		await waitFor( () => expect( toggle ).toBeChecked() );
		expect( connector.setAgentInstructionsEnabled ).toHaveBeenLastCalledWith( true );
	} );

	it( 'links the global instruction guidance to the assistant documentation', async () => {
		const { connector } = await setup( { section: 'instructions' } );
		await screen.findByRole( 'textbox', { name: 'WordPress Studio instructions' } );
		const links = screen
			.getAllByRole( 'button', { name: 'Learn more…' } )
			.filter( ( link ) => ! link.closest( 'form' ) );
		expect( links ).toHaveLength( 1 );
		fireEvent.click( links[ 0 ] );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/studio-code/'
		);
		expect(
			screen.getByText(
				'Set coding standards, preferred tools, and response style for new chats across all sites.'
			)
		).toBeVisible();
	} );

	it( 'opens AI Providers for a signed-out Usage link and hides Usage from search', async () => {
		const { connector } = await setup( { section: 'usage', signedIn: false } );
		const connect = await within( await findProviderRow( 'wpcom-provider' ) ).findByRole(
			'button',
			{
				name: 'Connect',
			}
		);
		await waitFor( () => expect( connect ).toBeEnabled() );
		expect( screen.getByRole( 'tab', { name: 'AI Providers', selected: true } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Usage' } ) ).not.toBeInTheDocument();
		fireEvent.change( searchBox(), { target: { value: 'balance' } } );
		expect( screen.getByText( 'No settings found.' ) ).toBeVisible();
		fireEvent.keyDown( searchBox(), { key: 'Escape' } );
		fireEvent.click( connect );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledWith( true, 'settings' )
		);
	} );

	it( 'returns to AI Providers when WordPress.com disconnects while viewing Usage', async () => {
		const { connector } = await setup( { section: 'usage' } );
		await screen.findByRole( 'tab', { name: 'Usage', selected: true } );
		connector.state.user = null;
		act( () => connector.emit( 'onAuthStateChanged' ) );
		expect(
			await screen.findByRole( 'tab', { name: 'AI Providers', selected: true } )
		).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Usage' } ) ).not.toBeInTheDocument();
	} );

	it( 'waits for completed WordPress.com OAuth before selecting its provider', async () => {
		const { connector } = await setup( {
			section: 'ai',
			signedIn: false,
			overrides: { authenticate: async () => {} },
		} );
		const connect = await within( await findProviderRow( 'wpcom-provider' ) ).findByRole(
			'button',
			{
				name: 'Connect',
			}
		);
		await waitFor( () => expect( connect ).toBeEnabled() );
		fireEvent.click( connect );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledWith( true, 'settings' )
		);
		expect( connector.setAiProvider ).not.toHaveBeenCalled();
		connector.state.user = TEST_USER;
		act( () => connector.emit( 'onAuthStateChanged' ) );
		await waitFor( () => expect( connector.setAiProvider ).toHaveBeenCalledWith( 'wpcom' ) );
		const manage = await within( providerRow( 'wpcom-provider' ) ).findByRole( 'button', {
			name: 'Manage',
		} );
		fireEvent.click( manage );
		expect( await screen.findByRole( 'tab', { name: 'Usage', selected: true } ) ).toBeVisible();
	} );

	it( 'keeps WordPress.com disconnected when OAuth fails', async () => {
		const { connector } = await setup( { section: 'ai', signedIn: false } );
		connector.authenticate.mockRejectedValueOnce( new Error( 'Unable to connect' ) );
		const connect = await within( await findProviderRow( 'wpcom-provider' ) ).findByRole(
			'button',
			{
				name: 'Connect',
			}
		);
		await waitFor( () => expect( connect ).toBeEnabled() );
		fireEvent.click( connect );
		await screen.findByText( 'Unable to connect' );
		expect( connector.setAiProvider ).not.toHaveBeenCalled();
		expect(
			within( providerRow( 'wpcom-provider' ) ).getByRole( 'button', { name: 'Connect' } )
		).toBeEnabled();
	} );

	it( 'reveals an inline Anthropic key form and collapses after connecting', async () => {
		let hasKey = false;
		const { connector } = await setup( {
			section: 'ai',
			signedIn: false,
			overrides: {
				getAiSettings: async () => ( {
					provider: 'wpcom',
					hasAnthropicApiKey: hasKey,
					anthropicApiKeyPreview: null,
				} ),
				saveAnthropicApiKey: async () => {
					hasKey = true;
					return { provider: 'wpcom', hasAnthropicApiKey: true, anthropicApiKeyPreview: 'test' };
				},
			},
		} );
		const anthropic = await findProviderRow( 'anthropic-provider' );
		const connect = await within( anthropic ).findByRole( 'button', { name: 'Connect' } );
		await waitFor( () => expect( connect ).toBeEnabled() );
		expect( screen.queryByLabelText( 'Anthropic API key' ) ).not.toBeInTheDocument();
		fireEvent.click( connect );
		const input = await screen.findByLabelText( 'Anthropic API key', { selector: 'input' } );
		expect( input ).toHaveAttribute( 'type', 'password' );
		fireEvent.change( input, { target: { value: '  personal-key  ' } } );
		fireEvent.click(
			within( screen.getByRole( 'form', { name: 'Anthropic connection' } ) ).getByRole( 'button', {
				name: 'Save',
			} )
		);
		await waitFor( () =>
			expect( connector.saveAnthropicApiKey ).toHaveBeenCalledWith( 'personal-key' )
		);
		await waitFor( () =>
			expect( screen.queryByLabelText( 'Anthropic API key' ) ).not.toBeInTheDocument()
		);
		expect(
			await within( await findProviderRow( 'anthropic-provider' ) ).findByRole( 'button', {
				name: 'Manage',
			} )
		).toBeVisible();
		expect( connector.authenticate ).not.toHaveBeenCalled();
	} );

	it( 'preserves a rejected key for retry and only switches providers after it is saved', async () => {
		const { connector } = await setup( { section: 'ai', signedIn: false } );
		connector.saveAnthropicApiKey.mockRejectedValueOnce( new Error( 'Invalid API key' ) );
		const manage = await within( await findProviderRow( 'anthropic-provider' ) ).findByRole(
			'button',
			{
				name: 'Manage',
			}
		);
		await waitFor( () => expect( manage ).toBeEnabled() );
		fireEvent.click( manage );
		const input = await screen.findByLabelText( 'Anthropic API key', { selector: 'input' } );
		expect( input ).toHaveAttribute( 'type', 'password' );
		fireEvent.change( input, { target: { value: '  test-key  ' } } );
		const save = () =>
			within( screen.getByRole( 'form', { name: 'Anthropic connection' } ) ).getByRole( 'button', {
				name: 'Save',
			} );
		fireEvent.click( save() );
		await screen.findByText( 'Invalid API key' );
		expect( input ).toHaveValue( '  test-key  ' );
		expect( connector.setAiProvider ).not.toHaveBeenCalled();
		await waitFor( () => expect( save() ).toBeEnabled() );
		fireEvent.click( save() );
		await waitFor( () =>
			expect( connector.setAiProvider ).toHaveBeenCalledWith( 'anthropic-api-key' )
		);
		expect( connector.saveAnthropicApiKey ).toHaveBeenCalledWith( 'test-key' );
		await waitFor( () =>
			expect( screen.queryByLabelText( 'Anthropic API key' ) ).not.toBeInTheDocument()
		);
		expect( connector.authenticate ).not.toHaveBeenCalled();
	} );

	it( 'links to credits and external assistant setup inside the same dialog', async () => {
		await setup( { section: 'usage' } );
		expect( await screen.findByRole( 'tab', { name: 'Usage', selected: true } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'tablist', { name: 'Intelligence sections' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'AI Providers' } ) );
		expect(
			await screen.findByRole( 'tab', { name: 'AI Providers', selected: true } )
		).toBeVisible();
		expect( screen.getAllByRole( 'dialog', { name: 'Settings' } ) ).toHaveLength( 1 );
		const copyButtons = () =>
			screen.queryAllByRole( 'button', { name: /^Copy (install command|MCP configuration)$/ } );
		expect( copyButtons() ).toHaveLength( 0 );
		fireEvent.click( screen.getByRole( 'tab', { name: 'MCP' } ) );
		await waitFor( () => expect( copyButtons() ).toHaveLength( 2 ) );
	} );

	it( 'copies the install command and shared MCP configuration independently', async () => {
		const { connector } = await setup( { section: 'mcp' } );
		const install = await screen.findByRole( 'button', { name: 'Copy install command' } );
		const configuration = screen.getByRole( 'button', { name: 'Copy MCP configuration' } );
		fireEvent.click( install );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith( 'npm install -g wp-studio' )
		);
		fireEvent.click( configuration );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith(
				expect.stringContaining( 'wordpress-studio' )
			)
		);
		await waitFor( () =>
			expect( within( configuration.parentElement! ).getByRole( 'status' ) ).toHaveTextContent(
				'Copied'
			)
		);
	} );

	it( 'reports a failed copy instead of showing copied feedback', async () => {
		const { connector } = await setup( { section: 'mcp' } );
		connector.copyText.mockRejectedValueOnce( new Error( 'Clipboard unavailable' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Copy MCP configuration' } ) );
		await waitFor( () =>
			expect( getNoticeHistory()[ 0 ] ).toMatchObject( {
				title: 'Could not copy',
				description: 'Clipboard unavailable',
			} )
		);
		expect( screen.queryByText( 'Copied' ) ).not.toBeInTheDocument();
	} );
} );
