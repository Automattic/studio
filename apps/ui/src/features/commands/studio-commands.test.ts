import { describe, expect, it, vi } from 'vitest';
import { getAppCommands, getPaletteChats, getSettingCommands } from './studio-commands';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const site = ( id: string ) => ( { id, name: id, path: `/sites/${ id }` } ) as SiteDetails;
const chat = ( id: string, ownerSitePath: string, updatedAt: string, extra = {} ) =>
	( { id, title: id, ownerSitePath, updatedAt, ...extra } ) as unknown as AiSessionSummary;

const sites = [ site( 'pine' ), site( 'oak' ) ];
const sessions = [
	chat( 'old', '/sites/pine', '2026-01-01' ),
	chat( 'archived', '/sites/pine', '2026-06-01', { archived: true } ),
	chat( 'orphan', '/sites/gone', '2026-06-01' ),
	...[ 1, 2, 3, 4, 5 ].map( ( day ) => chat( `oak-${ day }`, '/sites/oak', `2026-02-0${ day }` ) ),
];

describe( 'getAppCommands', () => {
	const openSite = vi.fn();
	const commands = getAppCommands( {
		sites,
		chats: getPaletteChats( sessions, sites ),
		colorScheme: 'light',
		sidebarOpen: true,
		settingCommands: [],
		openAddSite: vi.fn(),
		openSettings: vi.fn(),
		openSite,
		openChat: vi.fn(),
		savePreferences: vi.fn(),
		toggleSidebar: vi.fn(),
		openNotifications: vi.fn(),
		openWhatsNew: vi.fn(),
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

	it( 'opens a site on its latest chat', () => {
		commands.find( ( { id } ) => id === 'site-oak' )!.run();
		expect( openSite ).toHaveBeenCalledWith( sites[ 1 ], sessions[ 7 ] );
	} );
} );

it( 'shows the sidebar before opening the notifications from its bell', () => {
	const toggleSidebar = vi.fn();
	const openNotifications = vi.fn();
	const notifications = ( sidebarOpen: boolean ) =>
		getAppCommands( {
			sites: [],
			chats: [],
			colorScheme: 'light',
			sidebarOpen,
			settingCommands: [],
			openAddSite: vi.fn(),
			openSettings: vi.fn(),
			openSite: vi.fn(),
			openChat: vi.fn(),
			savePreferences: vi.fn(),
			toggleSidebar,
			openNotifications,
			openWhatsNew: vi.fn(),
		} ).find( ( { id } ) => id === 'notifications' )!;

	notifications( true ).run();
	expect( toggleSidebar ).not.toHaveBeenCalled();
	notifications( false ).run();
	expect( toggleSidebar ).toHaveBeenCalledTimes( 1 );
	expect( openNotifications ).toHaveBeenCalledTimes( 2 );
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
} );
