import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppMessagesForTests } from '@/data/app-messages';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import { closeNoticeHistory } from '@/features/notifications';
import {
	createFakeConnector,
	makeSession,
	makeSite,
	TEST_USER,
	type FakeConnector,
	type FakeConnectorState,
} from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
const testSite = makeSite( { id: 'one', name: 'Test site' } );

async function renderPalette( {
	connector = createFakeConnector( { sites: [ testSite ] } ),
	path = '/sites/one',
}: { connector?: FakeConnector; path?: string } = {} ) {
	const view = renderApp( { connector, path } );
	await waitFor( () => expect( view.history.location.pathname ).toBe( path ) );
	await screen.findByRole( 'group', { name: 'Sites' } );
	return view;
}

function pressK( target: Document | Element = document ) {
	fireEvent.keyDown( target, { code: 'KeyK', key: 'k', metaKey: isApple, ctrlKey: ! isApple } );
}
const input = () => screen.getByRole( 'combobox', { name: 'Search commands' } );
const search = ( query: string ) => fireEvent.change( input(), { target: { value: query } } );
const option = ( name: string | RegExp ) => screen.getByRole( 'option', { name } );
const paletteClosed = () =>
	waitFor( () =>
		expect( screen.queryByRole( 'dialog', { name: 'Command palette' } ) ).not.toBeInTheDocument()
	);

async function openPalette() {
	pressK();
	return screen.findByRole( 'combobox', { name: 'Search commands' } );
}

const revealed = ( setting: string ) =>
	waitFor( () =>
		expect( document.querySelector( '[data-settings-match]' ) ).toHaveAccessibleName( setting )
	);

const searchParams = ( history: { location: { search: string } } ) =>
	Object.fromEntries( new URLSearchParams( history.location.search ) );

afterEach( () =>
	act( () => {
		setCommandPaletteOpen( false );
		closeNoticeHistory();
	} )
);

describe( 'command palette', () => {
	it( 'toggles the sidebar after releasing the palette dialog guard', async () => {
		await renderPalette();
		for ( const label of [ 'Hide sidebar', 'Show sidebar' ] ) {
			await openPalette();
			search( label );
			fireEvent.click( option( label ) );
			await paletteClosed();
			await waitFor( () =>
				expect(
					screen
						.getAllByRole( 'button', {
							name: label === 'Hide sidebar' ? 'Show sidebar' : 'Hide sidebar',
						} )
						.some( ( button ) => ! button.closest( '[inert]' ) )
				).toBe( true )
			);
		}
	} );

	it( 'opens one notification history from a collapsed sidebar after the palette closes', async () => {
		await renderPalette();
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Hide sidebar' } )[ 0 ] );
		for ( let attempt = 0; attempt < 2; attempt++ ) {
			await openPalette();
			await waitFor( () =>
				expect( screen.queryByText( 'No notifications.' ) ).not.toBeInTheDocument()
			);
			search( 'Show notifications' );
			fireEvent.click( option( 'Show notifications' ) );
			await paletteClosed();
			await screen.findByText( 'No notifications.' );
			expect( screen.getAllByRole( 'dialog', { name: 'Notification history' } ) ).toHaveLength( 1 );
			const bell = screen.getByRole( 'button', { name: 'Notification history' } );
			expect( bell.closest( '[inert]' ) ).toBeNull();
		}
	} );

	it.each( [ false, true ] )(
		'offers the Usage section only when signed in to WordPress.com: %s',
		async ( signedIn ) => {
			const connector = createFakeConnector( {
				sites: [ testSite ],
				user: signedIn ? TEST_USER : null,
			} );
			await renderPalette( { connector } );
			await openPalette();
			search( 'Usage' );
			expect( screen.queryByRole( 'option', { name: 'Usage' } ) !== null ).toBe( signedIn );
			expect( screen.queryByRole( 'option', { name: /View AI usage/ } ) ).not.toBeInTheDocument();
			search( 'AI Providers' );
			expect( option( 'AI Providers' ) ).toBeVisible();
		}
	);

	it.each( [
		[ 'MCP', 'MCP', 'mcp' ],
		[ 'Connect', 'AI Providers', 'ai' ],
		[ 'Connect provider', 'AI Providers', 'ai' ],
		[ 'credits', 'Usage', 'usage' ],
		[ 'AI credits', 'Usage', 'usage' ],
		[ 'credit balance', 'Usage', 'usage' ],
		[ 'Sharing', 'Sharing', 'sharing' ],
		[ 'Previews', 'Sharing', 'sharing' ],
		[ 'snapshots', 'Sharing', 'sharing' ],
	] )( 'searches for %s and opens its settings tab', async ( query, label, tab ) => {
		const { history, user } = await renderPalette();
		await openPalette();
		search( query );
		await user.click( option( label ) );
		await waitFor( () => expect( searchParams( history ).settings ).toBe( tab ) );
	} );

	it.each( [
		[ 'Skills on this site', 'Skills', 'site-skills', 'WordPress skills', 'site-wordpress-skills' ],
	] )(
		'opens the canonical destination for %s without changing settings',
		async ( query, label, section, setting, id ) => {
			const { history, user, connector } = await renderPalette();
			await openPalette();
			search( query );
			expect( screen.getAllByRole( 'option' ) ).toHaveLength( 1 );
			await user.click( option( new RegExp( `^${ label }` ) ) );
			await waitFor( () => expect( searchParams( history ).settings ).toBe( section ) );
			await revealed( setting );
			expect( document.querySelector( '[data-settings-match]' ) ).toHaveAttribute(
				'data-setting-id',
				id
			);
			expect( connector.setUserPreferences ).not.toHaveBeenCalled();
			expect( connector.installWordPressSkillToAllSites ).not.toHaveBeenCalled();
			expect( connector.removeWordPressSkillFromAllSites ).not.toHaveBeenCalled();
		}
	);

	it( 'highlights the app Skills control through its consolidated destination', async () => {
		const connector = createFakeConnector( { sites: [ testSite ] } );
		connector.getWordPressSkillsStatusAllSites.mockResolvedValue( [
			{
				id: 'wp-test',
				displayName: 'Test skill',
				description: 'Test',
				installed: true,
			},
		] );
		const { user } = await renderPalette( { connector } );
		await openPalette();
		search( 'skills' );
		expect( screen.getAllByRole( 'option' ) ).toHaveLength( 2 );
		expect(
			screen.queryByRole( 'option', { name: /^(Enable|Disable) WordPress skills/ } )
		).not.toBeInTheDocument();
		await user.click(
			within( screen.getByRole( 'group', { name: 'App settings' } ) ).getByRole( 'option', {
				name: 'Skills',
			} )
		);
		await revealed( 'WordPress skills' );
		expect( document.querySelector( '[data-settings-match]' ) ).toHaveAttribute(
			'data-setting-id',
			'wordpress-skills'
		);
	} );

	it( 'uses Rename site as the only Site name destination and focuses its stable target', async () => {
		const { history, user } = await renderPalette();
		await openPalette();
		search( 'Site name' );
		expect( screen.getAllByRole( 'option' ) ).toHaveLength( 1 );
		await user.click( option( 'Rename site… Test site' ) );
		await waitFor( () => expect( searchParams( history ).settings ).toBe( 'site' ) );
		await revealed( 'Site name' );
		expect( document.querySelector( '[data-settings-match]' ) ).toHaveAttribute(
			'data-setting-id',
			'site-name'
		);
		expect( screen.getByRole( 'textbox', { name: 'Site name' } ) ).toHaveFocus();
	} );

	it( 'searches settings details and runs their deep link, and clears search on reopening', async () => {
		const { history, user } = await renderPalette();
		await openPalette();
		search( 'PHP version' );
		fireEvent.keyDown( input(), { key: 'Escape' } );
		await paletteClosed();
		expect( await openPalette() ).toHaveValue( '' );
		search( 'PHP version' );
		await user.click( option( 'PHP version Test site' ) );
		await waitFor( () =>
			expect( searchParams( history ) ).toMatchObject( { settings: 'php', settingsSite: 'one' } )
		);
		await revealed( 'PHP version' );
		await paletteClosed();
	} );

	it( 'opens from the platform shortcut and supports Enter, Escape, and no results', async () => {
		const { connector } = await renderPalette();
		await openPalette();
		search( 'Toggle theme' );
		await waitFor( () =>
			expect( option( 'Use dark mode' ) ).toHaveAttribute( 'aria-selected', 'true' )
		);
		fireEvent.keyDown( input(), { key: 'Enter' } );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ colorScheme: 'dark' },
				undefined
			)
		);
		await paletteClosed();
		await openPalette();
		search( 'zzzzzzzz' );
		expect( await screen.findByText( 'No commands found.' ) ).toBeVisible();
		fireEvent.keyDown( input(), { key: 'Escape' } );
		await paletteClosed();
	} );

	it( 'hides unavailable actions while the site is busy', async () => {
		const connector = createFakeConnector( { sites: [ testSite ] } );
		connector.startSite.mockImplementation( () => new Promise( () => {} ) );
		const { user } = await renderPalette( { connector } );
		await openPalette();
		search( 'Start site' );
		await user.click( option( 'Start site Test site' ) );
		await paletteClosed();
		await openPalette();
		search( 'Start site' );
		expect( screen.queryByRole( 'option', { name: /^Start site/ } ) ).not.toBeInTheDocument();
		search( 'Open WordPress Admin' );
		expect(
			screen.queryByRole( 'option', { name: /^Open WordPress Admin in preview/ } )
		).not.toBeInTheDocument();
	} );

	it( 'omits site commands without a site', async () => {
		const { history, user } = renderApp( { connector: createFakeConnector(), path: '/sites' } );
		fireEvent.keyDown( await screen.findByRole( 'dialog', { name: 'Add site' } ), {
			key: 'Escape',
		} );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await openPalette();
		expect( screen.queryByRole( 'option', { name: /New chat/ } ) ).not.toBeInTheDocument();
		expect( option( 'Settings' ) ).toBeVisible();
		expect( option( 'New site' ) ).toBeVisible();
		search( 'create' );
		expect( screen.getByRole( 'group', { name: 'Quick actions' } ) ).toContainElement(
			option( 'New site' )
		);
		await user.click( option( 'New site' ) );
		await waitFor( () => expect( searchParams( history ).addSite ).toBe( 'create' ) );
	} );

	it( 'shows the available commands and settings destinations before typing', async () => {
		await renderPalette();
		await openPalette();
		for ( const name of [
			'New site',
			'Hide sidebar',
			'Start site Test site',
			'New chat Test site',
			'Settings',
			'Site settings Test site',
			'Use dark mode',
			'Skills',
			'Skills Test site',
			'Language General',
			'Reset appearance Appearance',
		] ) {
			expect( option( name ) ).toBeVisible();
		}
	} );

	it.each( [ 'add', 'create', 'add site', 'add chat' ] )(
		'keeps creation actions first when searching for %s',
		async ( query ) => {
			await renderPalette();
			await openPalette();
			search( query );
			const expected = query.endsWith( 'site' )
				? [ 'New site' ]
				: query.endsWith( 'chat' )
				? [ 'New chat Test site' ]
				: [ 'New site', 'New chat Test site' ];
			const options = screen.getAllByRole( 'option' );
			for ( const [ index, name ] of expected.entries() ) {
				expect( options[ index ] ).toHaveAccessibleName( name );
			}
			await waitFor( () => expect( options[ 0 ] ).toHaveAttribute( 'aria-selected', 'true' ) );
		}
	);

	it( 'opens site settings for the active site', async () => {
		const { history, user } = await renderPalette();
		await openPalette();
		await user.click( option( 'Site settings Test site' ) );
		await waitFor( () =>
			expect( searchParams( history ) ).toMatchObject( { settings: 'site', settingsSite: 'one' } )
		);
	} );

	it( 'searches both settings panels and individual controls', async () => {
		await renderPalette();
		await openPalette();
		search( 'PHP' );
		expect( option( 'PHP Test site' ) ).toBeVisible();
		expect( option( 'PHP version Test site' ) ).toBeVisible();
	} );

	it( 'limits initial recent chats to five and searches older chats without duplicates', async () => {
		const sessions = Array.from( { length: 7 }, ( _, index ) => ( {
			summary: makeSession( {
				id: `chat-${ index }`,
				title: `Conversation ${ index }`,
				ownerSiteId: 'one',
				updatedAt: new Date( 2026, 9, 12, 12, index ).toISOString(),
			} ),
			entries: [],
		} ) );
		const { history, user } = await renderPalette( {
			connector: createFakeConnector( { sites: [ testSite ], sessions } ),
		} );
		await openPalette();
		const recent = await screen.findByRole( 'group', { name: 'Recent chats' } );
		expect(
			within( recent )
				.getAllByRole( 'option' )
				.map( ( row ) => row.textContent )
		).toEqual( [ 6, 5, 4, 3, 2 ].map( ( index ) => `Conversation ${ index }Test site` ) );
		search( 'Conversation 0' );
		expect( screen.queryByRole( 'group', { name: 'Recent chats' } ) ).not.toBeInTheDocument();
		expect( screen.getAllByRole( 'option', { name: 'Conversation 0 Test site' } ) ).toHaveLength(
			1
		);
		await user.click( option( 'Conversation 0 Test site' ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/chat-0' ) );
	} );

	it( 'matches theme aliases and excludes secondary text and misspellings', async () => {
		await renderPalette();
		await openPalette();
		for ( const query of [ 'light mode', 'dark mode' ] ) {
			search( query );
			expect( screen.getAllByRole( 'option' )[ 0 ] ).toHaveTextContent( 'Use dark mode' );
			expect( option( 'Use dark mode' ) ).toHaveAttribute( 'aria-selected', 'true' );
		}
		for ( const query of [ 'monthly', 'Test site', 'lght mode' ] ) {
			search( query );
			if ( query === 'Test site' ) {
				expect( screen.getAllByRole( 'option' )[ 0 ] ).toHaveAccessibleName( 'Test site' );
				for ( const name of [
					'New chat Test site',
					'Start site Test site',
					'Site settings Test site',
				] ) {
					expect( screen.queryByRole( 'option', { name } ) ).not.toBeInTheDocument();
				}
			} else {
				expect( screen.getByText( 'No commands found.' ) ).toBeVisible();
			}
		}
	} );

	it( 'runs switch settings in place as normal command rows', async () => {
		const { connector, user } = await renderPalette();
		await openPalette();
		search( 'Collapse sidebar groups' );
		const row = option( /^(Enable|Disable) automatic sidebar collapsing/ );
		expect(
			within( screen.getByRole( 'group', { name: 'Commands' } ) ).getByRole( 'option', {
				name: /^(Enable|Disable) automatic sidebar collapsing/,
			} )
		).toBe( row );
		expect( screen.queryByRole( 'switch' ) ).not.toBeInTheDocument();
		await user.click( row );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ autoCollapseSites: expect.any( Boolean ) },
				undefined
			)
		);
	} );

	it.each( [
		[ 'color', 'Color Appearance', 'Color' ],
		[ 'colour', 'Color Appearance', 'Color' ],
		[ 'tint intensity', 'Intensity Appearance', 'Intensity' ],
	] )( 'finds appearance controls with %s', async ( query, label, setting ) => {
		const { history, user } = await renderPalette();
		await openPalette();
		search( query );
		await user.click( option( label ) );
		await waitFor( () => expect( searchParams( history ).settings ).toBe( 'appearance' ) );
		await revealed( setting );
	} );
} );

function site( overrides: Partial< SiteDetails > = {} ) {
	return makeSite( { id: 'one', path: '/sites/my-site', ...overrides } );
}

function chat( overrides: Partial< AiSessionSummary > ) {
	return {
		summary: makeSession( {
			ownerSiteId: 'one',
			updatedAt: new Date().toISOString(),
			...overrides,
		} ),
		entries: [],
	};
}

function setup( {
	sites = [ site() ],
	signedIn = false,
	...state
}: { sites?: SiteDetails[]; signedIn?: boolean } & Partial< FakeConnectorState > = {} ) {
	const connector = createFakeConnector( {
		sites,
		user: signedIn ? TEST_USER : null,
		...state,
		preferences: {
			autoCollapseSites: false,
			...state.preferences,
		} as FakeConnectorState[ 'preferences' ],
	} );
	return renderApp( { connector } );
}

async function paletteCommand( query: string, name?: RegExp ) {
	await openPalette();
	search( query );
	fireEvent.click(
		await screen.findByRole( 'option', { name: name ?? new RegExp( `^${ query }` ) } )
	);
	await waitFor( () =>
		expect( screen.queryByLabelText( 'Search commands' ) ).not.toBeInTheDocument()
	);
}

describe( 'Command palette in the Studio workspace', () => {
	beforeEach( () => {
		localStorage.clear();
		resetAppMessagesForTests();
	} );

	it.each( [ false, true ] )(
		'restarts through the palette after stop settles (fails: %s)',
		async ( fails ) => {
			const { connector } = setup( { sites: [ site( { running: true } ) ] } );
			let finishStop!: () => void;
			connector.stopSite.mockImplementation(
				() =>
					new Promise< void >( ( resolve, reject ) => {
						finishStop = () => ( fails ? reject( new Error( 'Unable to stop' ) ) : resolve() );
					} )
			);
			await screen.findByRole( 'button', { name: 'Site menu' } );
			await paletteCommand( 'Restart site' );
			await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			expect( connector.startSite ).not.toHaveBeenCalled();
			await act( async () => finishStop() );
			if ( fails ) {
				await screen.findAllByText( 'Failed to stop site' );
				expect( connector.startSite ).not.toHaveBeenCalled();
			} else {
				await waitFor( () =>
					expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' )
				);
			}
		}
	);

	it( 'switches sites and starts the selected site from the command palette', async () => {
		const { connector } = setup( {
			sites: [ site(), site( { id: 'two', name: 'Second site' } ) ],
		} );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		await openPalette();
		search( 'Second site' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Second site' } ) );
		expect( await screen.findByRole( 'button', { name: 'Site menu' } ) ).toBeVisible();
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await openPalette();
		search( 'Start site' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Start site Second site' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'two' ) );
	} );

	it( 'opens a recent chat from the command palette on its owning site', async () => {
		const recent = chat( {
			id: 'recent-chat',
			title: 'Build a portfolio',
			ownerSiteId: 'two',
			updatedAt: '2026-10-11T12:00:00Z',
		} );
		const { connector, history } = setup( {
			sites: [ site(), site( { id: 'two', name: 'Second site' } ) ],
			signedIn: true,
			sessions: [
				recent,
				chat( { id: 'archived', title: 'Archived chat', ownerSiteId: 'two', archived: true } ),
				chat( { id: 'missing', title: 'Missing site chat', ownerSiteId: 'missing' } ),
			],
		} );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		pressK();
		const recentGroup = await screen.findByRole( 'group', { name: 'Recent chats' } );
		expect(
			within( recentGroup ).queryByRole( 'option', { name: /Archived|Missing/ } )
		).not.toBeInTheDocument();
		fireEvent.click(
			within( recentGroup ).getByRole( 'option', { name: 'Build a portfolio Second site' } )
		);
		await waitFor( () => expect( connector.getSession ).toHaveBeenCalledWith( 'recent-chat' ) );
		expect( history.location.pathname ).toBe( '/sessions/recent-chat' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	} );

	it.each( [ false, true ] )(
		'switches Add site to the command palette (empty: %s)',
		async ( empty ) => {
			setup( { sites: empty ? [] : [ site() ] } );
			if ( ! empty ) {
				await screen.findByRole( 'button', { name: 'Site menu' } );
				fireEvent.click( screen.getByRole( 'button', { name: 'Add site' } ) );
			}
			const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
			const blank = await within( dialog ).findByRole( 'button', {
				name: 'Start with Blank site',
			} );
			await waitFor( () => expect( blank ).toHaveFocus() );
			pressK( blank );
			await waitFor( () =>
				expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
			);
			await waitFor( () => expect( input() ).toHaveFocus() );
			fireEvent.change( input(), { target: { value: 'add' } } );
			fireEvent.click( await screen.findByRole( 'option', { name: 'New site' } ) );
			expect( await screen.findByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
			await waitFor( () =>
				expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toHaveFocus()
			);
			expect( screen.queryByRole( 'tooltip', { name: 'New site' } ) ).not.toBeInTheDocument();
		}
	);

	it( 'uses existing host actions from the command palette', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Site menu' } );
		await openPalette();
		search( 'Open in Finder' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Open in Finder My site' } ) );
		expect( connector.openSiteFolder ).toHaveBeenCalledWith( 'one' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	} );

	it( 'executes palette site actions once and reuses import confirmation', async () => {
		const { connector } = setup( {
			sites: [
				site( { running: true, customDomain: 'my-site.local', enableHttps: true } ),
				site( { id: 'two', running: true } ),
			],
		} );
		connector.exportFullSite.mockResolvedValue( '/tmp/site.zip' as never );
		connector.exportDatabase.mockResolvedValue( '/tmp/database.sql' as never );
		connector.copySite.mockResolvedValue( site( { id: 'copy', name: 'Copy' } ) );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		await paletteCommand( 'copy site URL', /^Copy site URL/ );
		expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( 'https://my-site.local' );
		await paletteCommand( 'open in browser', /^Open in Browser My site/ );
		expect( connector.openSiteUrl ).toHaveBeenCalledExactlyOnceWith( 'one', '/', {
			autoLogin: false,
		} );
		await paletteCommand( 'export site', /^Export site/ );
		await waitFor( () =>
			expect( connector.exportFullSite ).toHaveBeenCalledExactlyOnceWith( 'one' )
		);
		await paletteCommand( 'export database', /^Export database/ );
		await waitFor( () =>
			expect( connector.exportDatabase ).toHaveBeenCalledExactlyOnceWith( 'one' )
		);
		await paletteCommand( 'duplicate site', /^Duplicate site/ );
		await waitFor( () => expect( connector.copySite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		await paletteCommand( 'stop other sites', /^Stop other sites/ );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'two' ) );
		const picker = vi.spyOn( HTMLInputElement.prototype, 'click' );
		await paletteCommand( 'import backup', /^Import backup/ );
		expect( picker ).toHaveBeenCalledTimes( 1 );
		const input = picker.mock.contexts[ 0 ] as HTMLInputElement;
		expect( input ).toHaveAttribute( 'type', 'file' );
		fireEvent.change( input, { target: { files: [ new File( [ 'backup' ], 'backup.zip' ) ] } } );
		const confirmation = await screen.findByRole( 'alertdialog', { name: /Overwrite/ } );
		expect( connector.importSiteFromBackup ).not.toHaveBeenCalled();
		fireEvent.click( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.importSiteFromBackup ).not.toHaveBeenCalled();
		await paletteCommand( 'reset appearance', /^Reset appearance/ );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledExactlyOnceWith(
				{ accentColor: '#3858e9', tintIntensity: 0, contrast: 0, colorScheme: 'system' },
				undefined
			)
		);
	} );

	it( 'pins, renames and archives the current chat through palette commands', async () => {
		const { connector, history } = setup( {
			sites: [ site( { running: true } ) ],
			signedIn: true,
			sessions: [ chat( { id: 'palette-chat', title: 'Working chat' } ) ],
		} );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/palette-chat' ) );
		await paletteCommand( 'Working chat', /^Working chat/ );
		await waitFor( () => expect( connector.getSession ).toHaveBeenCalledWith( 'palette-chat' ) );
		await paletteCommand( 'pin chat', /^Pin chat/ );
		await screen.findByRole( 'group', { name: 'Pinned' } );
		await waitFor( () =>
			expect( connector.state.preferences.sidebarPins ).toContain( 'chat:palette-chat' )
		);
		await paletteCommand( 'rename chat', /^Rename chat/ );
		const dialog = await screen.findByRole( 'dialog', { name: 'Rename chat' } );
		fireEvent.change( within( dialog ).getByRole( 'textbox', { name: 'Chat title' } ), {
			target: { value: 'Updated chat' },
		} );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'palette-chat', {
				title: 'Updated chat',
			} )
		);
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await paletteCommand( 'archive chat', /^Archive chat/ );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'palette-chat', {
				archived: true,
			} )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'group', { name: 'Pinned' } ) ).not.toBeInTheDocument()
		);
	} );

	it( 'opens Intensity settings from the palette and focuses its slider', async () => {
		setup();
		await screen.findByRole( 'button', { name: 'Site menu' } );
		await openPalette();
		search( 'Intensity' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Intensity Appearance' } ) );
		await screen.findByRole( 'dialog', { name: 'Settings' } );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Intensity', { selector: 'input' } ) ).toHaveFocus()
		);
	} );

	it( 'replays What’s New from the palette and marks it seen when skipped', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Site menu' } );
		await paletteCommand( 'new features', /^What’s New/ );
		expect(
			await screen.findByRole( 'dialog', { name: 'Meet the new WordPress Studio' } )
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Skip' } ) );
		await waitFor( () =>
			expect( connector.setOnboardingHints ).toHaveBeenCalledWith(
				expect.objectContaining( { whatsNewSeenVersion: expect.any( Number ) } )
			)
		);
	} );

	it.each( [ 'light', 'dark' ] as const )(
		'toggles from the rendered %s theme with one palette command',
		async ( scheme ) => {
			const { connector } = setup( { preferences: { colorScheme: scheme } as never } );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			await openPalette();
			search( scheme + ' mode' );
			fireEvent.keyDown( input(), { key: 'Enter' } );
			await waitFor( () =>
				expect( connector.setUserPreferences ).toHaveBeenCalledExactlyOnceWith(
					{ colorScheme: scheme === 'dark' ? 'light' : 'dark' },
					undefined
				)
			);
		}
	);
} );
