import { describe, expect, it } from 'vitest';
import {
	DESIGN_CATALOG_KINDS,
	findSkill,
	getCurrentDesignPool,
	loadDesignCatalog,
	pickDesignEntries,
	renderSkillBody,
	sampleDesignCatalog,
} from '../skills';

function seededRandom( seed: number ): () => number {
	let state = seed;
	return () => {
		state = ( state * 1664525 + 1013904223 ) % 4294967296;
		return state / 4294967296;
	};
}

describe( 'design catalogs', () => {
	it( 'holds at least five layout concepts with unique names and build and fallback notes, no fit hints', () => {
		const concepts = loadDesignCatalog( 'concept' );
		expect( concepts.length ).toBeGreaterThanOrEqual( 5 );
		expect( new Set( concepts.map( ( c ) => c.name ) ).size ).toBe( concepts.length );
		for ( const concept of concepts ) {
			expect( concept.body, concept.name ).toMatch( /^Build: /m );
			expect( concept.body, concept.name ).toMatch( /^Fallback: /m );
			expect( concept.body, concept.name ).not.toMatch( /^Fits: /m );
		}
	} );

	it( 'holds at least ten artistic directions with unique names and every cue line', () => {
		const directions = loadDesignCatalog( 'direction' );
		expect( directions.length ).toBeGreaterThanOrEqual( 10 );
		expect( new Set( directions.map( ( d ) => d.name ) ).size ).toBe( directions.length );
		for ( const direction of directions ) {
			for ( const cue of [
				'Palette',
				'Type',
				'Surface',
				'Shapes',
				'Imagery',
				'Motion',
				'Avoid',
			] ) {
				expect( direction.body, `${ direction.name } ${ cue }` ).toMatch(
					new RegExp( `^${ cue }: `, 'm' )
				);
			}
		}
	} );
} );

describe( 'sampleDesignCatalog', () => {
	it( 'returns the requested count of distinct entries', () => {
		const sample = sampleDesignCatalog( 'direction', 4, seededRandom( 1 ) );
		expect( sample ).toHaveLength( 4 );
		expect( new Set( sample.map( ( c ) => c.name ) ).size ).toBe( 4 );
	} );

	it( 'changes between loads', () => {
		const names = ( seed: number ) =>
			sampleDesignCatalog( 'concept', 4, seededRandom( seed ) ).map( ( c ) => c.name );
		expect( names( 1 ) ).not.toEqual( names( 2 ) );
	} );
} );

describe( 'renderSkillBody', () => {
	it( 'fills both visual-design pools with fresh samples and remembers them', () => {
		const skill = findSkill( 'visual-design' );
		expect( skill?.body ).toContain( '{{concept-pool}}' );
		expect( skill?.body ).toContain( '{{direction-pool}}' );
		const rendered = renderSkillBody( skill! );
		expect( rendered ).not.toMatch( /\{\{[a-z-]+\}\}/ );
		expect( rendered.match( /^### .+$/gm ) ).toHaveLength( 8 + 6 );
		expect( getCurrentDesignPool( 'concept' ) ).toHaveLength( 8 );
		expect( getCurrentDesignPool( 'direction' ) ).toHaveLength( 6 );
		for ( const kind of DESIGN_CATALOG_KINDS ) {
			for ( const name of getCurrentDesignPool( kind ) ) {
				const entry = loadDesignCatalog( kind ).find( ( e ) => e.name === name )!;
				expect( rendered ).toContain( `### ${ name }\n${ entry.body }` );
			}
		}
	} );

	it( 'leaves skills without placeholders untouched', () => {
		const skill = findSkill( 'site-spec' );
		expect( renderSkillBody( skill! ) ).toBe( skill!.body );
	} );
} );

describe.each( DESIGN_CATALOG_KINDS )( 'pickDesignEntries(%s)', ( kind ) => {
	const pool = () => {
		renderSkillBody( findSkill( 'visual-design' )! );
		return getCurrentDesignPool( kind );
	};

	it( 'draws one of the candidates and returns its notes', () => {
		const candidates = pool().slice( 0, 4 );
		const { entries, drawn } = pickDesignEntries( kind, { candidates }, 1, seededRandom( 3 ) );
		expect( drawn ).toBe( true );
		expect( entries ).toHaveLength( 1 );
		expect( candidates ).toContain( entries[ 0 ].name );
		expect( entries[ 0 ].body ).toMatch( kind === 'concept' ? /^Build: /m : /^Palette: /m );
	} );

	it( 'draws several distinct candidates when the user will pick between them', () => {
		const candidates = pool().slice( 0, 4 );
		const { entries } = pickDesignEntries( kind, { candidates }, 3, seededRandom( 7 ) );
		expect( entries ).toHaveLength( 3 );
		expect( new Set( entries.map( ( entry ) => entry.name ) ).size ).toBe( 3 );
		for ( const entry of entries ) {
			expect( candidates ).toContain( entry.name );
		}
	} );

	it( 'rejects shortlists of fewer than three distinct entries', () => {
		const [ a, b ] = pool();
		expect( () => pickDesignEntries( kind, { candidates: [ a, b, b ] } ) ).toThrow( /at least 3/ );
	} );

	it( 'rejects candidates outside the pool the model was shown', () => {
		const shown = pool();
		const outside = loadDesignCatalog( kind ).find( ( c ) => ! shown.includes( c.name ) )!.name;
		expect( () =>
			pickDesignEntries( kind, { candidates: [ ...shown.slice( 0, 3 ), outside ] } )
		).toThrow( /Not in this build's .* pool/ );
	} );

	it( 'rejects names that are not catalog entries', () => {
		expect( () => pickDesignEntries( kind, { candidates: [ 'Nope', 'Nah', 'Never' ] } ) ).toThrow(
			/Not catalog/
		);
	} );

	it( 'returns an entry named in the brief without drawing', () => {
		const named = loadDesignCatalog( kind )[ 0 ].name;
		const { entries, drawn } = pickDesignEntries(
			kind,
			{ candidates: [], namedInBrief: named },
			3
		);
		expect( drawn ).toBe( false );
		expect( entries.map( ( entry ) => entry.name ) ).toEqual( [ named ] );
	} );
} );
