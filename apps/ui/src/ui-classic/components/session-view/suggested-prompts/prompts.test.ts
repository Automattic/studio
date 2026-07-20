import { describe, expect, it } from 'vitest';
import { getSuggestedPrompts, samplePrompts, SUGGESTED_PROMPT_COUNT } from './prompts';
import type { SuggestedPrompt } from './prompts';

function makePool(): SuggestedPrompt[] {
	const categories = [ 'pages', 'design', 'content', 'structure', 'features' ] as const;
	return categories.flatMap( ( category ) =>
		[ 1, 2, 3, 4 ].map( ( n ) => ( {
			id: `${ category }-${ n }`,
			category,
			label: `${ category } ${ n }`,
			prompt: `Do ${ category } ${ n }`,
		} ) )
	);
}

// Deterministic "random" so tests don't flake.
const fixedRandom = () => 0.42;

describe( 'samplePrompts', () => {
	it( 'returns the requested count', () => {
		expect( samplePrompts( makePool(), 7, fixedRandom ) ).toHaveLength( 7 );
	} );

	it( 'caps each category at two picks', () => {
		const picked = samplePrompts( makePool(), 7, fixedRandom );
		const byCategory = new Map< string, number >();
		for ( const prompt of picked ) {
			byCategory.set( prompt.category, ( byCategory.get( prompt.category ) ?? 0 ) + 1 );
		}
		for ( const count of byCategory.values() ) {
			expect( count ).toBeLessThanOrEqual( 2 );
		}
	} );

	it( 'never repeats a prompt', () => {
		const picked = samplePrompts( makePool(), 7, fixedRandom );
		expect( new Set( picked.map( ( prompt ) => prompt.id ) ).size ).toBe( picked.length );
	} );

	it( 'does not mutate the pool', () => {
		const pool = makePool();
		const order = pool.map( ( prompt ) => prompt.id );
		samplePrompts( pool, 7, fixedRandom );
		expect( pool.map( ( prompt ) => prompt.id ) ).toEqual( order );
	} );
} );

describe( 'getSuggestedPrompts', () => {
	it( 'samples the standard count and interpolates the site name', () => {
		// The pool has several %s-interpolated entries; sampling is random, so
		// just assert shape + no stray placeholders.
		const prompts = getSuggestedPrompts( 'My Test Site' );
		expect( prompts ).toHaveLength( SUGGESTED_PROMPT_COUNT );
		for ( const prompt of prompts ) {
			expect( prompt.prompt ).not.toContain( '%s' );
		}
	} );
} );
