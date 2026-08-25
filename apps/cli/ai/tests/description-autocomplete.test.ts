import { initTheme } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
	DescriptionAwareAutocompleteProvider,
	dimUnhighlighted,
	highlightMatch,
} from 'cli/ai/description-autocomplete';
import { theme } from 'cli/ai/theme';
import type { SlashCommandDef } from 'cli/ai/slash-commands';

initTheme();

const highlight = ( text: string ) => theme.fg( 'accent', text );
const dim = ( text: string ) => theme.fg( 'muted', text );

const COMMANDS: SlashCommandDef[] = [
	{ name: 'exit', description: 'Exit the chat' },
	{
		name: 'liberate',
		description: 'Migrate & rebuild a site from a closed platform',
	},
];

const provider = new DescriptionAwareAutocompleteProvider( COMMANDS, process.cwd() );

function suggest( text: string ) {
	return provider.getSuggestions( [ text ], 0, text.length, {
		signal: new AbortController().signal,
	} );
}

describe( 'DescriptionAwareAutocompleteProvider', () => {
	it( 'surfaces a command via its description, including partial input', async () => {
		for ( const input of [ '/migrate', '/mig' ] ) {
			const result = await suggest( input );
			expect( result?.items.map( ( item ) => item.value ) ).toEqual( [ 'liberate' ] );
			expect( result?.prefix ).toBe( input );
		}
	} );

	it( 'matches descriptions case-insensitively', async () => {
		const result = await suggest( '/MIGRATE' );
		expect( result?.items.map( ( item ) => item.value ) ).toEqual( [ 'liberate' ] );
	} );

	it( 'does not duplicate a command matched by both name and description', async () => {
		const result = await suggest( '/exit' );
		expect( result?.items.filter( ( item ) => item.value === 'exit' ) ).toHaveLength( 1 );
	} );

	it( 'keeps plain name matching intact', async () => {
		const result = await suggest( '/liber' );
		expect( result?.items.map( ( item ) => item.value ) ).toEqual( [ 'liberate' ] );
	} );

	it( 'stays out of argument completion (text after a space)', async () => {
		const result = await suggest( '/liberate https://example.com' );
		expect( result ).toBeNull();
	} );

	it( 'returns null when nothing matches', async () => {
		const result = await suggest( '/zzz' );
		expect( result ).toBeNull();
	} );

	it( 'colors the query match in names and descriptions', async () => {
		const result = await suggest( '/migrate' );
		const item = result?.items[ 0 ];
		expect( item?.label ).toBe( 'liberate' );
		expect( item?.description ).toBe(
			`${ highlight( 'Migrate' ) } & rebuild a site from a closed platform`
		);
	} );

	it( 'colors the query match in a name-matched command', async () => {
		const result = await suggest( '/liber' );
		expect( result?.items[ 0 ]?.label ).toBe( `${ highlight( 'liber' ) }ate` );
	} );
} );

describe( 'highlightMatch', () => {
	it( 'colors the first case-insensitive occurrence', () => {
		expect( highlightMatch( 'Exit the chat', 'exit' ) ).toBe( `${ highlight( 'Exit' ) } the chat` );
	} );

	it( 'returns text unchanged when the query is absent', () => {
		expect( highlightMatch( 'liberate', 'xyz' ) ).toBe( 'liberate' );
	} );
} );

describe( 'dimUnhighlighted', () => {
	it( 'dims text around a highlight but not the highlight itself', () => {
		const input = `before ${ highlight( 'match' ) } after`;
		expect( dimUnhighlighted( input ) ).toBe(
			`${ dim( 'before ' ) }${ highlight( 'match' ) }${ dim( ' after' ) }`
		);
	} );

	it( 'dims the whole text when there is no highlight', () => {
		expect( dimUnhighlighted( 'plain text' ) ).toBe( dim( 'plain text' ) );
	} );
} );
