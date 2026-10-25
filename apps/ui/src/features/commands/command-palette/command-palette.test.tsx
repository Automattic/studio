import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import { matchCommands } from '@/features/commands/command-search';
import { getSiteCommands } from '@/features/commands/site-commands';
import {
	getAppCommands,
	getChatCommands,
	getSettingCommands,
} from '@/features/commands/studio-commands';
import { createFakeConnector, makeSession, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SiteDetails } from '@/data/core';
import type { FakeConnector } from '@/test/fake-connector';

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

const pressK = () => fireEvent.keyDown( document.body, { key: 'k', code: 'KeyK', ctrlKey: true } );
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

const searchParams = ( history: { location: { search: string } } ) =>
	Object.fromEntries( new URLSearchParams( history.location.search ) );

afterEach( () => act( () => setCommandPaletteOpen( false ) ) );

describe( 'command palette', () => {
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
		[ 'credits', 'WordPress.com AI Usage', 'usage' ],
		[ 'AI credits', 'WordPress.com AI Usage', 'usage' ],
		[ 'Sharing', 'Sharing', 'sharing' ],
		[ 'Previews', 'Sharing previews on WordPress.com Sharing', 'sharing' ],
	] )( 'searches for %s and opens its settings tab', async ( query, label, tab ) => {
		const { history, user } = await renderPalette();
		await openPalette();
		search( query );
		await user.click( option( label ) );
		await waitFor( () => expect( searchParams( history ).settings ).toBe( tab ) );
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
			expect( searchParams( history ) ).toMatchObject( {
				settings: 'php',
				settingsSite: 'one',
				settingsFocus: 'PHP version',
			} )
		);
		await paletteClosed();
	} );

	it( 'opens from the platform shortcut and supports Enter, Escape, and no results', async () => {
		const { connector } = await renderPalette();
		await openPalette();
		search( 'dark mode' );
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
			screen.queryByRole( 'option', { name: /Open WordPress Admin/ } )
		).not.toBeInTheDocument();
	} );

	it( 'omits site commands without a site', async () => {
		const { history, user } = await renderPalette( {
			connector: createFakeConnector(),
			path: '/sites',
		} );
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

	it( 'shows the available commands before typing', async () => {
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
		const { history, user } = await renderPalette();
		await openPalette();
		search( 'PHP' );
		expect( option( 'PHP Test site' ) ).toBeVisible();
		expect( option( 'PHP version Test site' ) ).toBeVisible();
		await user.click( option( 'PHP version Test site' ) );
		await waitFor( () =>
			expect( searchParams( history ) ).toMatchObject( {
				settings: 'php',
				settingsFocus: 'PHP version',
			} )
		);
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
		const recent = await screen.findByRole( 'group', { name: 'Recent' } );
		expect(
			within( recent )
				.getAllByRole( 'option' )
				.map( ( row ) => row.textContent )
		).toEqual( [ 6, 5, 4, 3, 2 ].map( ( index ) => `Conversation ${ index }Test site` ) );
		search( 'Conversation 0' );
		expect( screen.queryByRole( 'group', { name: 'Recent' } ) ).not.toBeInTheDocument();
		expect( screen.getAllByRole( 'option', { name: 'Conversation 0 Test site' } ) ).toHaveLength(
			1
		);
		await user.click( option( 'Conversation 0 Test site' ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/chat-0' ) );
	} );

	it( 'finds the theme command by its aliases and runs it', async () => {
		const { connector } = await renderPalette();
		await openPalette();
		for ( const query of [ 'dark mode', 'light mode' ] ) {
			search( query );
			expect( screen.getAllByRole( 'option' )[ 0 ] ).toHaveTextContent( 'Use dark mode' );
		}
		search( 'dark mode' );
		fireEvent.keyDown( input(), { key: 'Enter' } );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledExactlyOnceWith(
				{ colorScheme: 'dark' },
				undefined
			)
		);
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
		const row = option( /^Turn (on|off) “Collapse sidebar groups”/ );
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
		[ 'color', 'Color Appearance', 'color' ],
		[ 'tint intensity', 'Intensity Appearance', 'intensity' ],
	] )( 'finds appearance controls with %s', async ( query, label, focus ) => {
		const { history, user } = await renderPalette();
		await openPalette();
		search( query );
		await user.click( option( label ) );
		await waitFor( () =>
			expect( searchParams( history ) ).toMatchObject( {
				settings: 'appearance',
				settingsFocus: focus,
			} )
		);
	} );
} );

describe( 'palette commands', () => {
	const appCommands = ( overrides: Partial< Parameters< typeof getAppCommands >[ 0 ] > = {} ) =>
		getAppCommands( {
			sites: [],
			chats: [],
			colorScheme: 'light',
			sidebarOpen: true,
			settingCommands: [],
			openAddSite: vi.fn(),
			openSettings: vi.fn(),
			openSite: vi.fn(),
			openChat: vi.fn(),
			savePreferences: vi.fn(),
			toggleSidebar: vi.fn(),
			openNotifications: vi.fn(),
			openWhatsNew: vi.fn(),
			...overrides,
		} );

	type SiteCommandsInput = Parameters< typeof getSiteCommands >[ 0 ];
	const siteCommands = (
		site: SiteDetails,
		sites: SiteDetails[],
		overrides: Partial< SiteCommandsInput > = {},
		actions: Record< string, unknown > = {}
	) =>
		getSiteCommands( {
			site,
			chatEnabled: true,
			previewShown: false,
			canAnnotate: false,
			annotating: false,
			actions: {
				busy: false,
				pinned: false,
				running: sites.filter( ( entry ) => entry.running ),
				othersRunning: sites.filter( ( entry ) => entry.running && entry.id !== site.id ),
				...actions,
			} as unknown as SiteCommandsInput[ 'actions' ],
			destinations: [],
			manage: [],
			settingCommands: [],
			openSettings: vi.fn(),
			openHeaderPanel: vi.fn(),
			newChat: vi.fn(),
			reloadPreview: vi.fn(),
			annotate: vi.fn(),
			showPreview: vi.fn(),
			setChatHidden: vi.fn(),
			copyUrl: vi.fn(),
			...overrides,
		} );

	it( 'indexes controls rather than settings headings', () => {
		const toggle = { checked: true, run: vi.fn() };
		const commands = [
			...getSettingCommands( {
				scope: 'studio',
				signedIn: true,
				toggles: { 'usage-statistics': toggle },
				openSettings: vi.fn(),
			} ),
			...getSettingCommands( {
				scope: 'site',
				site: testSite,
				signedIn: true,
				toggles: {},
				openSettings: vi.fn(),
			} ),
		];
		const titles = commands.flatMap( ( command ) => command.aliases ?? [] );
		for ( const label of [
			'WordPress.com account',
			'Log in',
			'Log out',
			'Visit wapuu.studio',
			'Wapuu score',
			'Local domain',
			'MCP',
			'WordPress credentials',
		] ) {
			expect( titles ).not.toContain( label );
		}
		expect( titles ).toContain( 'Use custom domain' );
		expect(
			commands.find(
				( command ) => command.aliases?.includes( 'Improve WordPress Studio for everyone' )
			)?.run
		).toBe( toggle.run );
	} );

	it( 'derives labels and availability from active context', () => {
		const site = makeSite( { id: 'one', name: 'Test', running: true } );
		const sites = [ site, makeSite( { id: 'two', running: true } ) ];
		const app = appCommands( { sidebarOpen: false } );
		const forSite = siteCommands( site, sites, { chatHidden: false }, { pinned: true } );
		const chat = getChatCommands( makeSession( { id: 'chat', title: 'Current chat' } ), {
			pinned: true,
			working: true,
		} as unknown as Parameters< typeof getChatCommands >[ 1 ] );
		const byId = ( id: string ) =>
			[ ...app, ...forSite, ...chat ].find( ( command ) => command.id === id );
		expect( byId( 'sidebar' )?.label ).toBe( 'Show sidebar' );
		expect( byId( 'chat-visibility' )?.label ).toBe( 'Hide chat' );
		expect( byId( 'pin-site' )?.label ).toBe( 'Unpin site' );
		expect( byId( 'pin-chat' )?.label ).toBe( 'Unpin chat' );
		expect( byId( 'archive-chat' ) ).toBeUndefined();
		expect( byId( 'stop-others' ) ).toBeDefined();
		expect( byId( 'export' ) ).toBeUndefined();
		expect( byId( 'open-files' ) ).toBeUndefined();
		expect( app.filter( ( command ) => command.id === 'color-scheme' ) ).toHaveLength( 1 );
		expect( byId( 'color-scheme' )?.searchOnly ).toBeUndefined();
	} );

	it( 'offers the notifications action', () => {
		expect( appCommands().find( ( command ) => command.id === 'notifications' ) ).toMatchObject( {
			group: 'commands',
			label: 'Show notifications',
		} );
	} );

	it.each( [ false, true ] )(
		'offers Collapse all only when applicable: %s',
		( canCollapseAll ) => {
			const command = appCommands( { collapseAll: canCollapseAll ? vi.fn() : undefined } ).find(
				( entry ) => entry.id === 'collapse-all'
			);
			if ( ! canCollapseAll ) {
				expect( command ).toBeUndefined();
			} else {
				expect( command ).toMatchObject( {
					group: 'commands',
					label: 'Collapse all',
					aliases: [ 'Collapse all sites' ],
				} );
			}
		}
	);

	it.each( [
		{ selectedRunning: false, others: 0 },
		{ selectedRunning: true, others: 0 },
		{ selectedRunning: false, others: 1 },
		{ selectedRunning: true, others: 1 },
		{ selectedRunning: false, others: 2 },
	] )( 'matches the site menu lifecycle actions: %j', ( { selectedRunning, others } ) => {
		const site = makeSite( { id: 'selected', name: 'Selected', running: selectedRunning } );
		const sites = [
			site,
			...Array.from( { length: others }, ( _, index ) =>
				makeSite( { id: `other-${ index }`, running: true } )
			),
		];
		const commands = siteCommands( site, sites );
		for ( const [ id, label, available ] of [
			[ 'restart', 'Restart site', selectedRunning ],
			[ 'stop-others', 'Stop other sites', selectedRunning && others > 0 ],
			[ 'stop-all', 'Stop all sites', Number( selectedRunning ) + others > 1 ],
		] as const ) {
			const command = commands.find( ( entry ) => entry.id === id );
			if ( ! available ) {
				expect( command ).toBeUndefined();
			} else {
				expect( command ).toMatchObject( { group: 'site', label } );
			}
		}
		expect( commands.find( ( command ) => command.id === 'lifecycle' ) ).toMatchObject( {
			group: 'quick',
			label: selectedRunning ? 'Stop site' : 'Start site',
		} );
	} );

	it( 'finds Collapse all by its existing accessible label', () => {
		const commands = appCommands( {
			collapseAll: vi.fn(),
			settingCommands: getSettingCommands( {
				scope: 'studio',
				signedIn: true,
				toggles: {},
				openSettings: vi.fn(),
			} ),
		} );
		expect( matchCommands( commands, 'Collapse all sites' ).map( ( { label } ) => label ) ).toEqual(
			[ 'Collapse all' ]
		);
	} );

	it.each( [ false, true ] )( 'offers the next theme action for dark mode: %s', ( darkMode ) => {
		const command = appCommands( { colorScheme: darkMode ? 'dark' : 'light' } ).find(
			( entry ) => entry.id === 'color-scheme'
		);
		expect( command?.label ).toBe( darkMode ? 'Use light mode' : 'Use dark mode' );
	} );
} );
