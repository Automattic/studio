import { describe, expect, it } from 'vitest';
import { groupCommands, matchCommands } from './command-search';
import type { PaletteCommand } from './studio-commands';

const command = ( id: string, group: PaletteCommand[ 'group' ], label: string, extra = {} ) =>
	( { id, group, label, icon: () => null, run: () => {}, ...extra } ) as PaletteCommand;

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

	it( 'ranks an alias like the label', () => {
		const withAlias = [
			command( 'sites', 'sites', 'Add site ideas' ),
			command( 'new-site', 'quick', 'New site', { aliases: [ 'Add site' ] } ),
		];
		expect( matchCommands( withAlias, 'add site' ).map( ( { id } ) => id ) ).toEqual( [
			'new-site',
			'sites',
		] );
	} );

	it( 'needs every typed word, in any case and spacing', () => {
		expect( ids( '  NEW   site ' ) ).toEqual( [ 'new-site' ] );
		expect( ids( 'new studio' ) ).toEqual( [] );
	} );
} );

describe( 'groupCommands', () => {
	it( 'gives each run of one group a heading', () => {
		const groups = groupCommands( matchCommands( commands, '' ) );
		expect(
			groups.map( ( { heading, items } ) => [ heading, items.map( ( i ) => i.value ) ] )
		).toEqual( [
			[ 'Quick actions', [ 'new-site', 'settings' ] ],
			[ 'Recent', [ 'recent' ] ],
			[ 'Sites', [ 'sites' ] ],
		] );
	} );
} );
