import { describe, expect, it } from 'vitest';
import { DescriptionAwareAutocompleteProvider } from 'cli/ai/description-autocomplete';
import type { SlashCommandDef } from 'cli/ai/slash-commands';

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
} );
