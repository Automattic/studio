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

	it( 'filters by name prefix', () => {
		const result = getSlashCommandMatches( '/an', null );
		expect( result.open ).toBe( true );
		expect( result.matches.map( ( command ) => command.name ) ).toEqual( [ 'annotate' ] );
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
