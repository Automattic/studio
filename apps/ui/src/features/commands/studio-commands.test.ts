import { describe, expect, it, vi } from 'vitest';
import { makeSession, makeSite } from '@/test/fake-connector';
import { matchCommands } from './command-search';
import { getSiteCommands } from './site-commands';
import {
	getAppCommands,
	getChatCommands,
	getPaletteChats,
	getSettingCommands,
	type PaletteCommand,
} from './studio-commands';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

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

const studioSettings = ( signedIn = true ) =>
	getSettingCommands( { scope: 'studio', signedIn, toggles: {}, openSettings: vi.fn() } );

type SiteCommandsInput = Parameters< typeof getSiteCommands >[ 0 ];
const siteCommands = (
	site: SiteDetails,
	sites: SiteDetails[],
	overrides: Partial< SiteCommandsInput > = {},
	actions: Record< string, unknown > = {}
) =>
	getSiteCommands( {
		site,
		previewShown: false,
		canAnnotate: false,
		canOpenDatabase: true,
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

const site = ( id: string ) => ( { id, name: id, path: `/sites/${ id }` } ) as SiteDetails;
const chat = ( id: string, ownerSitePath: string, updatedAt: string, extra = {} ) =>
	( { id, title: id, ownerSitePath, updatedAt, ...extra } ) as unknown as AiSessionSummary;

describe( 'getAppCommands', () => {
	const sites = [ site( 'pine' ), site( 'oak' ) ];
	const sessions = [
		chat( 'old', '/sites/pine', '2026-01-01' ),
		chat( 'archived', '/sites/pine', '2026-06-01', { archived: true } ),
		chat( 'orphan', '/sites/gone', '2026-06-01' ),
		...[ 1, 2, 3, 4, 5 ].map( ( day ) =>
			chat( `oak-${ day }`, '/sites/oak', `2026-02-0${ day }` )
		),
	];
	const openSite = vi.fn();
	const commands = appCommands( {
		sites,
		chats: getPaletteChats( sessions, sites ),
		openSite,
	} );
	const ids = ( group: string ) =>
		commands.filter( ( command ) => command.group === group ).map( ( { id } ) => id );

	it( 'lists the five latest chats as recent and every live chat for search', () => {
		expect( ids( 'recent' ) ).toEqual( [ 5, 4, 3, 2, 1 ].map( ( day ) => `recent-oak-${ day }` ) );
		expect( ids( 'chats' ) ).toEqual( [
			...[ 5, 4, 3, 2, 1 ].map( ( day ) => `chat-oak-${ day }` ),
			'chat-old',
		] );
		expect( ids( 'commands' ) ).not.toContain( 'collapse-all' );
	} );

	it( 'opens a site without resuming its latest chat', () => {
		commands.find( ( { id } ) => id === 'site-oak' )!.run();
		expect( openSite ).toHaveBeenCalledWith( sites[ 1 ] );
	} );
} );

it( 'shows the sidebar before opening the notifications from its bell', () => {
	const toggleSidebar = vi.fn();
	const openNotifications = vi.fn();
	const notifications = ( sidebarOpen: boolean ) =>
		appCommands( { sidebarOpen, toggleSidebar, openNotifications } ).find(
			( { id } ) => id === 'notifications'
		)!;

	notifications( true ).run();
	expect( toggleSidebar ).not.toHaveBeenCalled();
	notifications( false ).run();
	expect( toggleSidebar ).toHaveBeenCalledTimes( 1 );
	expect( openNotifications ).toHaveBeenCalledTimes( 2 );
} );

it( 'derives labels and availability from active context', () => {
	const current = makeSite( { id: 'one', name: 'Test', running: true } );
	const sites = [ current, makeSite( { id: 'two', running: true } ) ];
	const app = appCommands( { sidebarOpen: false } );
	const forSite = siteCommands( current, sites, { chatHidden: false }, { pinned: true } );
	const chatCommands = getChatCommands( makeSession( { id: 'chat', title: 'Current chat' } ), {
		pinned: true,
		working: true,
	} as unknown as Parameters< typeof getChatCommands >[ 1 ] );
	const byId = ( id: string ) =>
		[ ...app, ...forSite, ...chatCommands ].find( ( command ) => command.id === id );
	expect( byId( 'sidebar' )?.label ).toBe( 'Show sidebar' );
	expect( byId( 'chat-visibility' )?.label ).toBe( 'Hide chat' );
	expect( byId( 'pin-site' )?.label ).toBe( 'Unpin site' );
	expect( byId( 'pin-chat' )?.label ).toBe( 'Unpin chat' );
	expect( byId( 'archive-chat' ) ).toBeUndefined();
	expect( byId( 'stop-others' ) ).toBeDefined();
	expect( byId( 'export' ) ).toBeUndefined();
	expect( byId( 'open-files' ) ).toBeUndefined();
	expect( app.filter( ( command ) => command.id === 'color-scheme' ) ).toHaveLength( 1 );
} );

it.each( [
	{ selectedRunning: false, others: 0 },
	{ selectedRunning: true, others: 0 },
	{ selectedRunning: false, others: 1 },
	{ selectedRunning: true, others: 1 },
	{ selectedRunning: false, others: 2 },
] )( 'matches the site menu lifecycle actions: %j', ( { selectedRunning, others } ) => {
	const selected = makeSite( { id: 'selected', name: 'Selected', running: selectedRunning } );
	const sites = [
		selected,
		...Array.from( { length: others }, ( _, index ) =>
			makeSite( { id: `other-${ index }`, running: true } )
		),
	];
	const commands = siteCommands( selected, sites );
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

describe( 'getSettingCommands', () => {
	it( 'turns a known switch on or off in place and opens any other setting', () => {
		const openSettings = vi.fn();
		const toggle = { checked: true, run: vi.fn() };
		const commands = getSettingCommands( {
			scope: 'studio',
			signedIn: true,
			toggles: { 'show-recent-chats': toggle },
			openSettings,
		} );
		const byLabel = ( label: string ) => commands.find( ( command ) => command.label === label )!;

		expect( byLabel( 'Turn off “Show recent chats”' ).run ).toBe( toggle.run );
		byLabel( 'Terminal' ).run();
		expect( openSettings ).toHaveBeenCalledWith( 'general', undefined, 'terminal' );
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
				site: makeSite( { id: 'one', name: 'Test site' } ),
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

	it.each( [
		[ 'shortcuts', 'settings-keyboard' ],
		[ 'connect', 'settings-ai' ],
		[ 'connect provider', 'settings-ai' ],
		[ 'credit balance', 'settings-usage-ai-credits' ],
		[ 'snapshots', 'settings-sharing-preview-sites' ],
	] )( 'finds “%s” first by another name for a setting', ( query, id ) => {
		expect( matchCommands( studioSettings(), query )[ 0 ]?.id ).toBe( id );
	} );
} );

describe( 'command search', () => {
	const commands = appCommands( { settingCommands: studioSettings() } );
	const ids = ( query: string, list = commands ) =>
		matchCommands( list, query ).map( ( command ) => command.id );

	it.each( [
		[ 'colour', 'reset-appearance-tint' ],
		[ 'intensity tint', 'settings-appearance-intensity' ],
		[ 'API key', 'settings-ai-anthropic-provider' ],
		[ 'folder', 'settings-general-default-directory' ],
		[ 'editor default', 'settings-general-code-editor' ],
	] )( 'finds %s', ( query, id ) => {
		expect( ids( query ) ).toContain( id );
	} );

	it( 'ranks names above keywords and matches across fields', () => {
		const base = commands[ 0 ];
		const entries: PaletteCommand[] = [
			{
				...base,
				id: 'prose',
				group: 'settings',
				label: 'Choose editor',
				keywords: [ 'Default IDE application' ],
			},
			{ ...base, id: 'keyword', group: 'settings', label: 'Code editor', keywords: [ 'IDE' ] },
			{ ...base, id: 'words', group: 'settings', label: 'Choose IDE' },
			{ ...base, id: 'exact', group: 'settings', label: 'IDE' },
		];
		expect( ids( 'IDE', entries ).slice( 0, 2 ) ).toEqual( [ 'exact', 'words' ] );
		expect( ids( 'IDE code', entries ) ).toEqual( [ 'keyword' ] );
		expect( ids( 'application editor', entries ) ).toEqual( [ 'prose' ] );
		expect( ids( 'missing editor', entries ) ).toEqual( [] );
	} );

	it( 'keeps browse results unchanged and respects availability', () => {
		expect( matchCommands( commands, '' ) ).toEqual( matchCommands( commands, '  ' ) );
		expect( ids( 'credits', appCommands( { settingCommands: studioSettings( false ) } ) ) ).toEqual(
			[]
		);
		expect( ids( 'credtis' ) ).toEqual( [] );
		expect( ids( 'Command' ) ).not.toContain( 'color-scheme' );
	} );

	it.each( [ 'color', 'colour', 'change color' ] )(
		'puts the color control first for %s',
		( query ) => {
			expect( ids( query )[ 0 ] ).toBe( 'settings-appearance-color' );
		}
	);

	it( 'finds Collapse all by its existing accessible label', () => {
		expect(
			matchCommands(
				appCommands( { collapseAll: vi.fn(), settingCommands: studioSettings() } ),
				'Collapse all sites'
			).map( ( { label } ) => label )
		).toEqual( [ 'Collapse all' ] );
	} );
} );
