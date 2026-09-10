import { describe, expect, it } from 'vitest';
import {
	DESIGN_CATALOG_KINDS,
	drawDesignPairs,
	findSkill,
	loadDesignCatalog,
	parseDesignEntry,
	renderSkillBody,
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
			expect( concept.description, concept.name ).not.toBe( '' );
			expect( concept.details, concept.name ).toMatch( /^Build: /m );
			expect( concept.details, concept.name ).toMatch( /^Fallback: /m );
			expect( concept.details, concept.name ).not.toMatch( /^Fits: /m );
		}
	} );

	it( 'holds at least ten artistic directions with unique names and every cue line', () => {
		const directions = loadDesignCatalog( 'direction' );
		expect( directions.length ).toBeGreaterThanOrEqual( 10 );
		expect( new Set( directions.map( ( d ) => d.name ) ).size ).toBe( directions.length );
		for ( const direction of directions ) {
			expect( direction.description, direction.name ).not.toBe( '' );
			for ( const cue of [
				'Palette',
				'Type',
				'Surface',
				'Shapes',
				'Imagery',
				'Motion',
				'Avoid',
			] ) {
				expect( direction.details, `${ direction.name } ${ cue }` ).toMatch(
					new RegExp( `^${ cue }: `, 'm' )
				);
			}
		}
	} );

	it( 'parses frontmatter titles and descriptions written as JSON strings or bare', () => {
		expect(
			parseDesignEntry(
				'---\ntitle: "Broadsheet"\ndescription: "A front page: masthead, \\"lead\\", columns."\n---\nBuild: grid.\nFallback: one column.\n'
			)
		).toEqual( {
			name: 'Broadsheet',
			description: 'A front page: masthead, "lead", columns.',
			details: 'Build: grid.\nFallback: one column.',
		} );
		expect(
			parseDesignEntry( '---\ntitle: Noir\ndescription: Dark and cold.\n---\nPalette: black.\n' )
		).toMatchObject( { name: 'Noir', description: 'Dark and cold.' } );
		expect( parseDesignEntry( '---\ntitle: "Empty"\ndescription: "x"\n---\n' ) ).toBeNull();
		expect( parseDesignEntry( 'no frontmatter' ) ).toBeNull();
	} );
} );

describe( 'renderSkillBody', () => {
	it( 'lists every catalog entry by name and description, without its notes', () => {
		const rendered = renderSkillBody( findSkill( 'visual-design' )! );
		expect( rendered ).not.toContain( '{{layout-index}}' );
		expect( rendered ).not.toContain( '{{direction-index}}' );
		for ( const kind of DESIGN_CATALOG_KINDS ) {
			for ( const entry of loadDesignCatalog( kind ) ) {
				expect( rendered ).toContain( `- **${ entry.name }** — ${ entry.description }` );
				expect( rendered ).not.toContain( entry.details.split( '\n' )[ 0 ] );
			}
		}
	} );

	it( 'leaves skills without placeholders untouched', () => {
		const skill = findSkill( 'site-spec' );
		expect( renderSkillBody( skill! ) ).toBe( skill!.body );
	} );
} );

describe( 'drawDesignPairs', () => {
	const concepts = () => loadDesignCatalog( 'concept' );
	const directions = () => loadDesignCatalog( 'direction' );

	it( 'keeps the chosen pairs, fills up to four at random, and never repeats a side', () => {
		const chosen = [
			{ layout: concepts()[ 0 ].name, direction: directions()[ 0 ].name },
			{ layout: concepts()[ 1 ].name, direction: directions()[ 1 ].name },
		];
		const draw = drawDesignPairs( { count: 4, chosen }, seededRandom( 5 ) );
		expect( draw.pairs ).toHaveLength( 4 );
		const layouts = draw.pairs.map( ( p ) => p.layout.name );
		const looks = draw.pairs.map( ( p ) => p.direction.name );
		expect( new Set( layouts ).size ).toBe( 4 );
		expect( new Set( looks ).size ).toBe( 4 );
		for ( const pair of chosen ) {
			expect( draw.pairs ).toContainEqual(
				expect.objectContaining( {
					layout: expect.objectContaining( { name: pair.layout } ),
					direction: expect.objectContaining( { name: pair.direction } ),
				} )
			);
		}
	} );

	it( 'replaces a chosen pair with an unknown name by a random draw and reports it', () => {
		const draw = drawDesignPairs(
			{ count: 4, chosen: [ { layout: 'Nope', direction: directions()[ 0 ].name } ] },
			seededRandom( 2 )
		);
		expect( draw.pairs ).toHaveLength( 4 );
		expect( draw.ignored ).toEqual( [ 'Nope' ] );
	} );

	it( 'fixes a side named in the brief across every pair', () => {
		const named = directions()[ 3 ].name;
		const draw = drawDesignPairs(
			{
				count: 4,
				directionNamedInBrief: named,
				chosen: [ { layout: concepts()[ 2 ].name, direction: 'ignored' } ],
			},
			seededRandom( 9 )
		);
		expect( draw.fixed.direction?.name ).toBe( named );
		expect( draw.pairs.every( ( p ) => p.direction.name === named ) ).toBe( true );
		expect( new Set( draw.pairs.map( ( p ) => p.layout.name ) ).size ).toBe( 4 );
		expect( draw.ignored ).toEqual( [] );
		expect( () => drawDesignPairs( { count: 1, layoutNamedInBrief: 'Vaporwave' } ) ).toThrow(
			/not a catalog layout concept/
		);
	} );

	it( 'never draws avoided entries unless nothing else is left', () => {
		const avoidAllButTwo = directions()
			.slice( 2 )
			.map( ( d ) => d.name );
		const draw = drawDesignPairs(
			{ count: 4, avoid: { directions: avoidAllButTwo } },
			seededRandom( 4 )
		);
		const looks = draw.pairs.map( ( p ) => p.direction.name );
		expect( looks.filter( ( name ) => ! avoidAllButTwo.includes( name ) ) ).toHaveLength( 2 );
		expect( new Set( looks ).size ).toBe( 4 );
	} );
} );
