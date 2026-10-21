import { describe, expect, it } from 'vitest';
import { matchCommands } from './index';

const command = ( id: string, group: string, label: string, extra = {} ) =>
	( { id, group, label, icon: <svg />, run: () => {}, ...extra } ) as Parameters<
		typeof matchCommands
	>[ 0 ][ number ];

const commands = [
	command( 'sites', 'sites', 'Pine Studio' ),
	command( 'settings', 'quick', 'Settings', {
		keywords: [ 'Preferences', 'Studio' ],
		priority: 2,
	} ),
	command( 'new-site', 'quick', 'New site' ),
	command( 'recent', 'recent', 'Fix the header', { browseOnly: true } ),
	command( 'chat', 'chats', 'Fix the header', { searchOnly: true } ),
];

const ids = ( query: string ) => matchCommands( commands, query ).map( ( { id } ) => id );

describe( 'matchCommands', () => {
	it( 'lists recent chats before typing, and every chat while searching', () => {
		expect( ids( '' ) ).toEqual( [ 'new-site', 'settings', 'recent', 'sites' ] );
		expect( ids( 'header' ) ).toEqual( [ 'chat' ] );
	} );

	it( 'ranks a label match above a keyword match', () => {
		expect( ids( 'pre' ) ).toEqual( [ 'settings' ] );
		expect( ids( 'studio' ) ).toEqual( [ 'sites', 'settings' ] );
	} );
} );
