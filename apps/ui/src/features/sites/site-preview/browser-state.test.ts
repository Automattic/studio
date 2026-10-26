import { describe, expect, it } from 'vitest';
import {
	areBrowserStatesEqual,
	EMPTY_BROWSER_STATE,
	getDirectionalHistoryEntries,
	getHistoryEntryPath,
	normalizeDocumentTitle,
} from './browser-state';

const ENTRIES = [
	{ index: 0, title: 'Home', url: 'http://localhost/' },
	{ index: 1, title: 'Posts', url: 'http://localhost/posts' },
	{ index: 2, title: 'Editor', url: 'http://localhost/editor' },
	{ index: 3, title: 'Settings', url: 'http://localhost/settings' },
	{ index: 4, title: 'Themes', url: 'http://localhost/themes' },
];

describe( 'getDirectionalHistoryEntries', () => {
	it( 'orders back and forward history from the current page outward', () => {
		expect(
			getDirectionalHistoryEntries( ENTRIES, 2, 'back' ).map( ( entry ) => entry.index )
		).toEqual( [ 1, 0 ] );
		expect(
			getDirectionalHistoryEntries( ENTRIES, 2, 'forward' ).map( ( entry ) => entry.index )
		).toEqual( [ 3, 4 ] );
	} );
} );

describe( 'getHistoryEntryPath', () => {
	it( 'shows the path, search and hash, or the raw value when it is not a url', () => {
		expect( getHistoryEntryPath( 'http://localhost:8881/wp-admin/?page=1#top' ) ).toBe(
			'/wp-admin/?page=1#top'
		);
		expect( getHistoryEntryPath( 'not a url' ) ).toBe( 'not a url' );
	} );
} );

describe( 'areBrowserStatesEqual', () => {
	it( 'compares history entries by value', () => {
		const state = { ...EMPTY_BROWSER_STATE, historyEntries: ENTRIES, activeHistoryIndex: 2 };
		expect(
			areBrowserStatesEqual( state, {
				...state,
				historyEntries: ENTRIES.map( ( e ) => ( { ...e } ) ),
			} )
		).toBe( true );
		expect(
			areBrowserStatesEqual( state, {
				...state,
				historyEntries: [ ...ENTRIES.slice( 0, 4 ), { ...ENTRIES[ 4 ], title: 'Plugins' } ],
			} )
		).toBe( false );
		expect( areBrowserStatesEqual( state, { ...state, failed: true } ) ).toBe( false );
	} );
} );

describe( 'normalizeDocumentTitle', () => {
	it( 'trims titles and drops blank or non-string values', () => {
		expect( normalizeDocumentTitle( '  Home  ' ) ).toBe( 'Home' );
		expect( normalizeDocumentTitle( '   ' ) ).toBe( null );
		expect( normalizeDocumentTitle( undefined ) ).toBe( null );
	} );
} );
