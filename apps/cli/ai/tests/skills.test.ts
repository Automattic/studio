import { describe, expect, it } from 'vitest';
import {
	CONCEPT_POOL_PLACEHOLDER,
	findSkill,
	getCurrentConceptPool,
	loadDesignConcepts,
	pickDesignConcept,
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

	it( 'holds at least five concepts with unique names and build and fallback notes, no fit hints', () => {
		expect( concepts.length ).toBeGreaterThanOrEqual( 5 );
		expect( new Set( concepts.map( ( c ) => c.name ) ).size ).toBe( concepts.length );
		for ( const concept of concepts ) {
			expect( concept.body, concept.name ).toMatch( /^Build: /m );
			expect( concept.body, concept.name ).toMatch( /^Fallback: /m );
			expect( concept.body, concept.name ).not.toMatch( /^Fits: /m );
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
	it( 'fills the visual-design pool with a fresh sample of eight and remembers it', () => {
		const skill = findSkill( 'visual-design' );
		expect( skill?.body ).toContain( CONCEPT_POOL_PLACEHOLDER );
		const rendered = renderSkillBody( skill! );
		expect( rendered ).not.toMatch( /\{\{concept-/ );
		expect( rendered.match( /^### .+$/gm ) ).toHaveLength( 8 );
		expect( getCurrentConceptPool() ).toHaveLength( 8 );
	} );

	it( 'leaves skills without placeholders untouched', () => {
		const skill = findSkill( 'site-spec' );
		expect( renderSkillBody( skill! ) ).toBe( skill!.body );
	} );
} );

describe( 'pickDesignConcept', () => {
	const pool = () => {
		renderSkillBody( findSkill( 'visual-design' )! );
		return getCurrentConceptPool();
	};

	it( 'draws one of the candidates and returns its notes', () => {
		const candidates = pool().slice( 0, 4 );
		const { concept, drawn } = pickDesignConcept( { candidates }, seededRandom( 3 ) );
		expect( drawn ).toBe( true );
		expect( candidates ).toContain( concept.name );
		expect( concept.body ).toMatch( /^Build: /m );
	} );

	it( 'rejects shortlists of fewer than three distinct concepts', () => {
		const [ a, b ] = pool();
		expect( () => pickDesignConcept( { candidates: [ a, b, b ] } ) ).toThrow( /at least 3/ );
	} );

	it( 'rejects candidates outside the pool the model was shown', () => {
		const shown = pool();
		const outside = loadDesignConcepts().find( ( c ) => ! shown.includes( c.name ) )!.name;
		expect( () =>
			pickDesignConcept( { candidates: [ ...shown.slice( 0, 3 ), outside ] } )
		).toThrow( /Not in this build's concept pool/ );
	} );

	it( 'rejects names that are not catalog concepts', () => {
		expect( () => pickDesignConcept( { candidates: [ 'Nope', 'Nah', 'Never' ] } ) ).toThrow(
			/Not catalog concepts/
		);
	} );

	it( 'returns a concept named in the brief without drawing', () => {
		const named = loadDesignConcepts()[ 0 ].name;
		const { concept, drawn } = pickDesignConcept( { candidates: [], namedInBrief: named } );
		expect( drawn ).toBe( false );
		expect( concept.name ).toBe( named );
	} );
} );
