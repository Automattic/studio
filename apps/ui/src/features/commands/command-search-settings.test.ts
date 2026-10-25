import { describe, expect, it, vi } from 'vitest';
import { matchCommands } from './command-search';
import { getAppCommands, getSettingCommands } from './studio-commands';
import type { PaletteCommand } from './studio-commands';

function getCommands( signedIn = true ) {
	return getAppCommands( {
		sites: [],
		chats: [],
		colorScheme: 'light',
		sidebarOpen: true,
		settingCommands: getSettingCommands( {
			scope: 'studio',
			signedIn,
			toggles: {},
			openSettings: vi.fn(),
		} ),
		openAddSite: vi.fn(),
		openSettings: vi.fn(),
		openSite: vi.fn(),
		openChat: vi.fn(),
		savePreferences: vi.fn(),
		toggleSidebar: vi.fn(),
		openNotifications: vi.fn(),
		openWhatsNew: vi.fn(),
	} );
}

const commands = getCommands();
const ids = ( query: string, list = commands ) =>
	matchCommands( list, query ).map( ( command ) => command.id );

describe( 'command search', () => {
	it.each( [
		[ 'credits', 'settings-usage-ai-credits' ],
		[ '  AI   CREDITS ', 'settings-usage-ai-credits' ],
		[ 'color', 'settings-appearance-color' ],
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
		expect( ids( 'credits', getCommands( false ) ) ).toEqual( [] );
		expect( ids( 'credtis' ) ).toEqual( [] );
		expect( ids( 'Command' ) ).not.toContain( 'color-scheme' );
	} );

	it( 'puts the color control first for color', () => {
		expect( ids( 'color' )[ 0 ] ).toBe( 'settings-appearance-color' );
	} );
} );
