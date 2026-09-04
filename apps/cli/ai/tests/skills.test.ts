import { describe, expect, it } from 'vitest';
import {
	CONCEPT_SHORTLIST_PLACEHOLDER,
	findSkill,
	loadDesignConcepts,
	renderSkillBody,
	sampleDesignConcepts,
} from '../skills';

const ROLES = [ 'Moment', 'System', 'Detail' ];

function seededRandom( seed: number ): () => number {
	let state = seed;
	return () => {
		state = ( state * 1664525 + 1013904223 ) % 4294967296;
		return state / 4294967296;
	};
}

describe( 'design concepts catalog', () => {
	const concepts = loadDesignConcepts();

	it( 'holds at least 130 concepts over three roles with several categories each', () => {
		expect( concepts.length ).toBeGreaterThanOrEqual( 130 );
		expect( [ ...new Set( concepts.map( ( c ) => c.role ) ) ] ).toEqual( ROLES );
		for ( const role of ROLES ) {
			const categories = new Set(
				concepts.filter( ( c ) => c.role === role ).map( ( c ) => c.category )
			);
			expect( categories.size, role ).toBeGreaterThanOrEqual( 3 );
		}
	} );

	it( 'gives every concept a unique name and fit, build, and fallback notes', () => {
		expect( new Set( concepts.map( ( c ) => c.name ) ).size ).toBe( concepts.length );
		for ( const concept of concepts ) {
			expect( concept.body, concept.name ).toMatch( /^Fits: /m );
			expect( concept.body, concept.name ).toMatch( /^Build: /m );
			expect( concept.body, concept.name ).toMatch( /^Fallback: /m );
		}
	} );
} );

describe( 'sampleDesignConcepts', () => {
	it( 'returns the requested count per role, spread across its categories', () => {
		const sample = sampleDesignConcepts( 4, seededRandom( 1 ) );
		expect( sample ).toHaveLength( 12 );
		for ( const role of ROLES ) {
			const forRole = sample.filter( ( c ) => c.role === role );
			const categoryCount = new Set(
				loadDesignConcepts()
					.filter( ( c ) => c.role === role )
					.map( ( c ) => c.category )
			).size;
			expect( forRole, role ).toHaveLength( 4 );
			expect( new Set( forRole.map( ( c ) => c.category ) ).size, role ).toBe(
				Math.min( 4, categoryCount )
			);
		}
	} );

	it( 'changes between loads', () => {
		const names = ( seed: number ) =>
			sampleDesignConcepts( 4, seededRandom( seed ) ).map( ( c ) => c.name );
		expect( names( 1 ) ).not.toEqual( names( 2 ) );
	} );
} );

describe( 'renderSkillBody', () => {
	it( 'fills the visual-design shortlist with a fresh sample grouped by role', () => {
		const skill = findSkill( 'visual-design' );
		expect( skill?.body ).toContain( CONCEPT_SHORTLIST_PLACEHOLDER );
		const rendered = renderSkillBody( skill! );
		expect( rendered ).not.toContain( CONCEPT_SHORTLIST_PLACEHOLDER );
		expect( rendered.match( /^### (Moment|System|Detail)$/gm ) ).toHaveLength( 3 );
		expect( rendered.match( /^#### .+ \(.+\)$/gm ) ).toHaveLength( 12 );
	} );

	it( 'leaves skills without placeholders untouched', () => {
		const skill = findSkill( 'site-spec' );
		expect( renderSkillBody( skill! ) ).toBe( skill!.body );
	} );
} );
