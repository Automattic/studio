import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { describe, expect, it } from 'vitest';
import { getSlashCommandMatches } from './slash-autocomplete';

describe( 'getSlashCommandMatches', () => {
	it( 'is closed for an empty string', () => {
		const result = getSlashCommandMatches( '', null );
		expect( result.open ).toBe( false );
		expect( result.matches ).toEqual( [] );
	} );

	it( 'opens with every command for a lone slash', () => {
		const result = getSlashCommandMatches( '/', null );
		expect( result.open ).toBe( true );
		expect( result.matches ).toEqual( AI_SKILL_COMMANDS );
	} );

	it( 'filters by case-insensitive substring (including the start)', () => {
		const result = getSlashCommandMatches( '/an', null );
		expect( result.open ).toBe( true );
		// `annotate` starts with it; `rank-me-up` contains it in the middle.
		expect( result.matches.map( ( command ) => command.name ) ).toEqual( [
			'annotate',
			'rank-me-up',
		] );
	} );

	it( 'matches a substring in the middle of a name', () => {
		const result = getSlashCommandMatches( '/speed', null );
		expect( result.open ).toBe( true );
		expect( result.matches.map( ( command ) => command.name ) ).toEqual( [ 'need-for-speed' ] );
	} );

	it( 'keeps matching as a hyphenated name is typed out', () => {
		const result = getSlashCommandMatches( '/need-for', null );
		expect( result.open ).toBe( true );
		expect( result.matches.map( ( command ) => command.name ) ).toEqual( [ 'need-for-speed' ] );
	} );

	it( 'matches a command keyword, including partial input', () => {
		for ( const input of [ '/migrate', '/mig', '/import' ] ) {
			const result = getSlashCommandMatches( input, null );
			expect( result.open ).toBe( true );
			expect( result.matches.map( ( command ) => command.name ) ).toEqual( [ 'liberate' ] );
		}
	} );

	it( 'matches keywords case-insensitively', () => {
		const result = getSlashCommandMatches( '/MIGRATE', null );
		expect( result.open ).toBe( true );
		expect( result.matches.map( ( command ) => command.name ) ).toEqual( [ 'liberate' ] );
	} );

	it( 'opens for a slash token that follows earlier text and a space', () => {
		const result = getSlashCommandMatches( 'fix my site /sp', null );
		expect( result.open ).toBe( true );
		expect( result.matches.map( ( command ) => command.name ) ).toEqual( [ 'need-for-speed' ] );
	} );

	it( 'stays closed for a slash glued to the end of a word', () => {
		const result = getSlashCommandMatches( 'path/to', null );
		expect( result.open ).toBe( false );
		expect( result.matches ).toEqual( [] );
	} );

	it( 'closes once a trailing space follows a full command', () => {
		const result = getSlashCommandMatches( '/annotate ', null );
		expect( result.open ).toBe( false );
		expect( result.matches ).toEqual( [] );
	} );

	it( 'stays closed while a preview prompt is active', () => {
		const result = getSlashCommandMatches( '/', 'preview in progress' );
		expect( result.open ).toBe( false );
		expect( result.matches ).toEqual( [] );
	} );

	it( 'closes when no command matches the prefix', () => {
		const result = getSlashCommandMatches( '/zzz', null );
		expect( result.open ).toBe( false );
		expect( result.matches ).toEqual( [] );
	} );
} );
