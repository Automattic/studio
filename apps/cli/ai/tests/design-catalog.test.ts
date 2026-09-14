import {
	DESIGN_CATALOG_KINDS,
	drawDesignEntries,
	loadDesignCatalog,
	renderDesignCatalogIndex,
} from '../design-catalog';
import { findSkill } from '../skills';

function seededRandom( seed: number ): () => number {
	let state = seed;
	return () => {
		state = ( state * 1664525 + 1013904223 ) % 4294967296;
		return state / 4294967296;
	};
}

describe( 'design catalogs', () => {
	it( 'holds at least five layout concepts with unique names and build and fallback notes, no fit hints', () => {
		const concepts = loadDesignCatalog( 'layouts' );
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
		const directions = loadDesignCatalog( 'directions' );
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
} );

describe( 'renderDesignCatalogIndex', () => {
	it( 'lists every catalog entry by name and description, without its notes', () => {
		const rendered = renderDesignCatalogIndex( findSkill( 'visual-design' )!.body );
		expect( rendered ).not.toContain( '{{layout-index}}' );
		expect( rendered ).not.toContain( '{{direction-index}}' );
		for ( const kind of DESIGN_CATALOG_KINDS ) {
			for ( const entry of loadDesignCatalog( kind ) ) {
				expect( rendered ).toContain( `- **${ entry.name }** — ${ entry.description }` );
				expect( rendered ).not.toContain( entry.details.split( '\n' )[ 0 ] );
			}
		}
	} );
} );

describe( 'drawDesignEntries', () => {
	it( 'returns the chosen directions as they are, with nothing drawn at random', () => {
		const directions = loadDesignCatalog( 'directions' ).slice( 0, 4 );
		const names = directions.map( ( entry ) => entry.name );
		expect( drawDesignEntries( { kind: 'directions', count: 4, chosen: names } ) ).toEqual(
			directions
		);
		expect( () =>
			drawDesignEntries( { kind: 'directions', count: 4, chosen: names.slice( 0, 2 ) } )
		).toThrow( 'Pass 4 in chosen' );
		expect( () =>
			drawDesignEntries( { kind: 'directions', count: 1, chosen: [ 'Vaporwave' ] } )
		).toThrow( 'design it from the brief' );
	} );

	it( 'keeps up to two chosen layouts and draws the rest at random from those not shown yet', () => {
		const [ first, second, third ] = loadDesignCatalog( 'layouts' );
		const entries = drawDesignEntries(
			{ kind: 'layouts', count: 4, chosen: [ first.name, second.name, third.name ] },
			seededRandom( 5 )
		);
		expect( new Set( entries ).size ).toBe( 4 );
		expect( entries ).toEqual( expect.arrayContaining( [ first, second ] ) );
		expect( drawDesignEntries( { kind: 'layouts', count: 1, chosen: [ third.name ] } ) ).toEqual( [
			third,
		] );
		const shown = loadDesignCatalog( 'layouts' )
			.slice( 0, -4 )
			.map( ( entry ) => entry.name );
		expect( drawDesignEntries( { kind: 'layouts', count: 4, shown } ) ).toEqual(
			expect.arrayContaining( loadDesignCatalog( 'layouts' ).slice( -4 ) )
		);
		expect( () =>
			drawDesignEntries( { kind: 'layouts', count: 4, chosen: [ first.name ], shown } )
		).toThrow( 'Already shown' );
	} );
} );
