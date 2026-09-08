import { describe, expect, it } from 'vitest';
import {
	checkImageGeometry,
	checkMotion,
	checkTypography,
} from './rendered-contract-checks.js';
import type { LayoutObservation, RenderedImage, RenderedTextStyle } from './score.js';

const observation = ( extra: Partial< LayoutObservation > = {} ): LayoutObservation => ( {
	viewport: 1600,
	title: 'Home',
	textChars: 10,
	widestImage: 1600,
	images: [],
	docWidth: 1600,
	overflow: false,
	externalHosts: [],
	hashTargets: [],
	internalMissing: [],
	dialogs: [],
	...extra,
} );

const image = ( key: string, x: number, y: number, width = 400, height = 300 ): RenderedImage => ( {
	key,
	x,
	y,
	width,
	height,
} );

const text = ( extra: Partial< RenderedTextStyle > = {} ): RenderedTextStyle => ( {
	key: 'Nimbus Commute',
	fontFamily: 'aether, sans-serif',
	fontWeight: '400',
	fontSize: 64,
	lineHeight: 70,
	letterSpacing: 0,
	advance: 480,
	loaded: true,
	...extra,
} );

describe( 'checkImageGeometry', () => {
	it( 'fails when a matched image moves outside tolerance', () => {
		const result = checkImageGeometry(
			observation( { images: [ image( 'hero', 0, 96, 1600, 600 ) ] } ),
			observation( { images: [ image( 'hero', 32, 140, 1600, 600 ) ] } )
		);
		expect( result.failures?.[ 0 ] ).toContain( 'hero source 1600x600 at (0,96)' );
		expect( result.failures?.[ 0 ] ).toContain( 'copy 1600x600 at (32,140)' );
	} );

	it( 'matches repeated images to their nearest geometry', () => {
		const source = [ image( 'tile', 0, 100 ), image( 'tile', 0, 900 ) ];
		const candidate = [ image( 'tile', 2, 902 ), image( 'tile', 2, 102 ) ];
		expect(
			checkImageGeometry( observation( { images: source } ), observation( { images: candidate } ) )
		).toEqual( {} );
	} );

	it( 'allows small browser rounding drift', () => {
		expect(
			checkImageGeometry(
				observation( { images: [ image( 'hero', 0, 100, 400, 300 ) ] } ),
				observation( { images: [ image( 'hero', 8, 108, 404, 296 ) ] } )
			)
		).toEqual( {} );
	} );
} );

describe( 'checkTypography', () => {
	it( 'fails on computed family, weight, and metric drift', () => {
		const result = checkTypography(
			observation( { typography: [ text() ] } ),
			observation( {
				typography: [
					text( {
						fontFamily: 'Arial, sans-serif',
						fontWeight: '700',
						fontSize: 60,
						advance: 430,
					} ),
				],
			} )
		);
		expect( result.failures?.[ 0 ] ).toContain( 'family Arial, sans-serif !== aether, sans-serif' );
		expect( result.failures?.[ 0 ] ).toContain( 'weight 700 !== 400' );
		expect( result.failures?.[ 0 ] ).toContain( 'advance 430px !== 480px' );
	} );

	it( 'detects a named face that failed to load through its rendered advance', () => {
		const result = checkTypography(
			observation( { typography: [ text() ] } ),
			observation( { typography: [ text( { advance: 455, loaded: false } ) ] } )
		);
		expect( result.failures?.[ 0 ] ).toContain( 'font face is not loaded' );
		expect( result.failures?.[ 0 ] ).toContain( 'advance 455px !== 480px' );
	} );

	it( 'matches duplicate text runs by nearest style', () => {
		const source = [ text(), text( { fontSize: 24, lineHeight: 30, advance: 180 } ) ];
		const candidate = [ source[ 1 ], source[ 0 ] ];
		expect(
			checkTypography(
				observation( { typography: source } ),
				observation( { typography: candidate } )
			)
		).toEqual( {} );
	} );

	it( 'fails when too few source text runs can be matched', () => {
		const source = Array.from( { length: 10 }, ( _, index ) => text( { key: `run-${ index }` } ) );
		const result = checkTypography(
			observation( { typography: source } ),
			observation( { typography: source.slice( 0, 3 ) } )
		);
		expect( result.failures?.[ 0 ] ).toContain( 'typography coverage 3 of 10 (30%)' );
	} );
} );

describe( 'checkMotion', () => {
	it( 'fails when the copy loses most finite CSS animations', () => {
		const source = Array.from( { length: 20 }, ( _, index ) => `reveal-${ index }` );
		const result = checkMotion(
			observation( { animations: source } ),
			observation( { animations: source.slice( 0, 2 ) } )
		);
		expect( result.failures?.[ 0 ] ).toContain( 'animation coverage 2 of 20 (10%)' );
	} );

	it( 'passes when the copy preserves at least eighty percent by name', () => {
		const source = Array.from( { length: 10 }, ( _, index ) => `reveal-${ index }` );
		expect(
			checkMotion(
				observation( { animations: source } ),
				observation( { animations: source.slice( 0, 8 ) } )
			)
		).toEqual( {} );
	} );

	it( 'fails when preserved animations do not respond to controlled scroll', () => {
		const animations = Array.from( { length: 10 }, ( _, index ) => `reveal-${ index }` );
		const result = checkMotion(
			observation( { animations, responsiveAnimations: animations } ),
			observation( { animations, responsiveAnimations: animations.slice( 0, 2 ) } )
		);
		expect( result.failures?.[ 0 ] ).toContain( 'responsive animation coverage 2 of 10 (20%)' );
	} );

	it( 'does not require motion from a source that has none', () => {
		expect(
			checkMotion( observation( { animations: [] } ), observation( { animations: [] } ) )
		).toEqual( {} );
	} );
} );
