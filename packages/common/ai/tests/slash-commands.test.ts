import { describe, expect, it } from 'vitest';
import {
	buildSkillInvocationPrompt,
	getAiSkillCommands,
	getSlashCommandMatches,
	resolveSkillFromPrompt,
} from '../slash-commands';

describe( 'resolveSkillFromPrompt', () => {
	it( 'resolves the bare slash form the `studio ui` server forwards untouched', () => {
		expect( resolveSkillFromPrompt( '/rank-me-up' ) ).toBe( 'rank-me-up' );
	} );

	it( 'resolves the expanded form the desktop sends after expanding before the fork', () => {
		expect( resolveSkillFromPrompt( buildSkillInvocationPrompt( 'rank-me-up' ) ) ).toBe(
			'rank-me-up'
		);
	} );

	it( 'ignores surrounding whitespace', () => {
		expect( resolveSkillFromPrompt( '  /annotate  ' ) ).toBe( 'annotate' );
	} );

	it( 'returns undefined for an ordinary prompt', () => {
		expect( resolveSkillFromPrompt( 'Fix the header on my site' ) ).toBeUndefined();
	} );

	// The name is reported to analytics, so prompt text must never leak out through it.
	it( 'returns undefined for slash text that is not a known skill', () => {
		expect( resolveSkillFromPrompt( '/not-a-skill' ) ).toBeUndefined();
		expect( resolveSkillFromPrompt( '/rank-me-up extra words' ) ).toBeUndefined();
		expect( resolveSkillFromPrompt( '/../../etc/passwd' ) ).toBeUndefined();
	} );

	it( 'does not treat a prompt merely mentioning a skill as an invocation', () => {
		expect( resolveSkillFromPrompt( 'What does the /rank-me-up skill do?' ) ).toBeUndefined();
	} );

	it( 'returns undefined for an empty prompt', () => {
		expect( resolveSkillFromPrompt( '' ) ).toBeUndefined();
		expect( resolveSkillFromPrompt( '   ' ) ).toBeUndefined();
	} );
} );

describe( 'getSlashCommandMatches', () => {
	it( 'is closed for an empty string', () => {
		const result = getSlashCommandMatches( '', null );
		expect( result.open ).toBe( false );
		expect( result.matches ).toEqual( [] );
	} );

	it( 'opens with every command for a lone slash', () => {
		const result = getSlashCommandMatches( '/', null );
		expect( result.open ).toBe( true );
		expect( result.matches ).toEqual( getAiSkillCommands() );
	} );

	it( 'filters by case-insensitive substring (including the start)', () => {
		const result = getSlashCommandMatches( '/an', null );
		expect( result.open ).toBe( true );
		// `annotate` starts with it; `need-for-speed` has it in its description
		// ("performance"); `rank-me-up` contains it in the middle.
		expect( result.matches.map( ( command ) => command.name ) ).toEqual( [
			'annotate',
			'need-for-speed',
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

	it( 'matches a substring of a command description, including partial input', () => {
		for ( const input of [ '/migrate', '/mig' ] ) {
			const result = getSlashCommandMatches( input, null );
			expect( result.open ).toBe( true );
			expect( result.matches.map( ( command ) => command.name ) ).toEqual( [ 'liberate' ] );
		}
	} );

	it( 'matches descriptions case-insensitively', () => {
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
