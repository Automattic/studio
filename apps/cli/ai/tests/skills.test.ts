import { describe, expect, it } from 'vitest';
import {
	CONCEPT_SHORTLIST_PLACEHOLDER,
	findSkill,
	loadDesignConcepts,
	renderSkillBody,
	sampleDesignConcepts,
} from '../skills';

function seededRandom( seed: number ): () => number {
	let state = seed;
	return () => {
		state = ( state * 1664525 + 1013904223 ) % 4294967296;
		return state / 4294967296;
	};
}

describe( 'design concepts catalog', () => {
	const concepts = loadDesignConcepts();

	it( 'holds ten concepts with unique names and fit, build, and fallback notes', () => {
		expect( concepts ).toHaveLength( 10 );
		expect( new Set( concepts.map( ( c ) => c.name ) ).size ).toBe( concepts.length );
		for ( const concept of concepts ) {
			expect( concept.body, concept.name ).toMatch( /^Fits: /m );
			expect( concept.body, concept.name ).toMatch( /^Build: /m );
			expect( concept.body, concept.name ).toMatch( /^Fallback: /m );
		}
	} );
} );

describe( 'sampleDesignConcepts', () => {
	it( 'returns the requested count of distinct concepts', () => {
		const sample = sampleDesignConcepts( 4, seededRandom( 1 ) );
		expect( sample ).toHaveLength( 4 );
		expect( new Set( sample.map( ( c ) => c.name ) ).size ).toBe( 4 );
	} );

	it( 'changes between loads', () => {
		const names = ( seed: number ) =>
			sampleDesignConcepts( 4, seededRandom( seed ) ).map( ( c ) => c.name );
		expect( names( 1 ) ).not.toEqual( names( 2 ) );
	} );
} );

describe( 'renderSkillBody', () => {
	it( 'fills the visual-design shortlist with a fresh sample', () => {
		const skill = findSkill( 'visual-design' );
		expect( skill?.body ).toContain( CONCEPT_SHORTLIST_PLACEHOLDER );
		const rendered = renderSkillBody( skill! );
		expect( rendered ).not.toContain( CONCEPT_SHORTLIST_PLACEHOLDER );
		expect( rendered.match( /^### .+$/gm ) ).toHaveLength( 4 );
	} );

	it( 'leaves skills without placeholders untouched', () => {
		const skill = findSkill( 'site-spec' );
		expect( renderSkillBody( skill! ) ).toBe( skill!.body );
	} );
} );
