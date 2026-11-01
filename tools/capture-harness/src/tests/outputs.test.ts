import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { DOTS, dotsTileSvg, renderLook } from '../frame.ts';
import { loadLook, withBackground } from '../look.ts';
import { LOOKS_DIR } from '../paths.ts';
import { cropFor, encodeStill, writeIfChanged } from '../still.ts';
import { collapseRepeats, encodeVideo, resample } from '../video.ts';

let temp: string | null = null;
afterEach( async () => {
	if ( temp ) {
		await rm( temp, { recursive: true, force: true } );
		temp = null;
	}
} );

const solid = ( width: number, height: number, color: string ) =>
	sharp( { create: { width, height, channels: 4, background: color } } )
		.png()
		.toBuffer();

describe( 'cropFor', () => {
	const viewport = { width: 1440, height: 900 };

	it( 'pads the target and widens it to the least aspect, centred', () => {
		const crop = cropFor(
			{ x: 700, y: 300, width: 100, height: 200 },
			{ pad: 50, aspect: 1.5 },
			viewport
		);
		expect( crop( [] ) ).toEqual( { x: 525, y: 250, width: 450, height: 300 } );
	} );

	it( 'keeps the crop inside the window and grows it for annotations', () => {
		const crop = cropFor(
			{ x: 10, y: 10, width: 400, height: 100 },
			{ pad: [ 48, 24 ], aspect: 1.5 },
			viewport
		);
		expect( crop( [ { x: 0, y: 0, width: 20, height: 200 } ] ) ).toEqual( {
			x: 0,
			y: 0,
			width: 458,
			height: 200,
		} );
	} );
} );

describe( 'writeIfChanged', () => {
	it( 'writes new and changed images, and leaves the same picture alone', async () => {
		temp = await mkdtemp( path.join( tmpdir(), 'capture-test-' ) );
		const file = path.join( temp, 'shot.webp' );
		const white = await encodeStill( await solid( 40, 30, '#ffffff' ), {
			format: 'webp',
			quality: 90,
		} );
		const black = await encodeStill( await solid( 40, 30, '#000000' ), {
			format: 'webp',
			quality: 90,
		} );

		expect( await writeIfChanged( file, white ) ).toMatchObject( { status: 'new' } );
		expect( await writeIfChanged( file, white ) ).toMatchObject( { status: 'unchanged' } );

		const check = await writeIfChanged( file, black, {
			check: true,
			diffDir: path.join( temp, 'diffs' ),
		} );
		expect( check ).toMatchObject( { status: 'changed', diffPixels: 1200 } );
		expect( ( await stat( check.diff as string ) ).isFile() ).toBe( true );
		expect( ( await readFile( file ) ).equals( white ) ).toBe( true );

		expect( await writeIfChanged( file, black ) ).toMatchObject( { status: 'changed' } );
		expect( ( await readFile( file ) ).equals( black ) ).toBe( true );
	} );
} );

describe( 'renderLook', () => {
	it( 'leaves a still alone in the docs look', async () => {
		const png = await solid( 200, 100, '#ffffff' );
		const out = await renderLook( png, await loadLook( 'docs' ) );
		expect( out ).toEqual( [ [ '', png ] ] );
	} );

	it( 'frames a still into each of the social sizes', async () => {
		const out = await renderLook(
			await solid( 2880, 1800, '#ffffff' ),
			await loadLook( 'social' )
		);
		const sizes = await Promise.all(
			out.map( async ( [ suffix, image ] ) => {
				const { width, height } = await sharp( image ).metadata();
				return [ suffix, width, height ];
			} )
		);
		expect( sizes ).toEqual( [
			[ '-card', 1200, 630 ],
			[ '-square', 1080, 1080 ],
			[ '-wide', 1600, 900 ],
		] );
	} );

	it( 'keeps the still beside its framed copy when the look keeps raw stills', async () => {
		const out = await renderLook( await solid( 300, 200, '#ffffff' ), await loadLook( 'blog' ) );
		expect( out.map( ( [ suffix ] ) => suffix ) ).toEqual( [ '', '-framed' ] );
		const { width } = await sharp( out[ 1 ][ 1 ] ).metadata();
		expect( width ).toBe( 300 + Math.round( 300 * 0.06 ) * 2 );
	} );
} );

describe( 'dot field', () => {
	// Columns of the image's top row that hold a dot, in the given dot color.
	const dotColumns = async ( image: Buffer, dot: string ) => {
		const { data, info } = await sharp( image )
			.extract( {
				left: 0,
				top: 0,
				width: ( await sharp( image ).metadata() ).width ?? 0,
				height: 60,
			} )
			.removeAlpha()
			.raw()
			.toBuffer( { resolveWithObject: true } );
		const [ r, g, b ] = [ 1, 3, 5 ].map( ( i ) => parseInt( dot.slice( i, i + 2 ), 16 ) );
		for ( let y = 0; y < info.height; y++ ) {
			const columns: number[] = [];
			for ( let x = 0; x < info.width; x++ ) {
				const i = ( y * info.width + x ) * 3;
				if (
					Math.abs( data[ i ] - r ) +
						Math.abs( data[ i + 1 ] - g ) +
						Math.abs( data[ i + 2 ] - b ) <
					12
				) {
					columns.push( x );
				}
			}
			// Each dot is several pixels wide at 2x: keep where each one starts.
			const starts = columns.filter( ( x, i ) => i === 0 || x - columns[ i - 1 ] > 1 );
			if ( starts.length > 2 ) {
				return starts;
			}
		}
		return [];
	};

	it( 'spaces the dots as Studio does, at the capture scale', async () => {
		const look = await loadLook( 'marketing' );
		const [ , framed ] = (
			await renderLook( await solid( 2880, 1800, '#ffffff' ), {
				...look,
				outputs: undefined,
			} )
		)[ 1 ];
		const columns = await dotColumns( framed, DOTS.light.dot );
		expect( columns.length ).toBeGreaterThan( 2 );
		expect( columns[ 1 ] - columns[ 0 ] ).toBe( DOTS.spacing * look.scale );
	} );

	it( 'draws the dark field for a dark look', async () => {
		const out = await renderLook(
			await solid( 2880, 1800, '#181818' ),
			await loadLook( 'marketing-dark' )
		);
		const [ , framed ] = out.find( ( [ suffix ] ) => suffix === '-framed' )!;
		const { data } = await sharp( framed )
			.extract( { left: 0, top: 0, width: 1, height: 1 } )
			.raw()
			.toBuffer( { resolveWithObject: true } );
		expect( [ data[ 0 ], data[ 1 ], data[ 2 ] ] ).toEqual( [ 0x18, 0x18, 0x18 ] );
	} );

	it( "keeps the window's proportions with an equal margin on each axis", async () => {
		const [ , framed ] = (
			await renderLook( await solid( 2880, 1800, '#ffffff' ), await loadLook( 'marketing' ) )
		)[ 1 ];
		const { width = 0, height = 0 } = await sharp( framed ).metadata();
		expect( width / height ).toBeCloseTo( 2880 / 1800, 2 );
	} );

	it( 'puts the light app on the dark field with --background', async () => {
		const look = withBackground( await loadLook( 'marketing' ), 'dots-dark' );
		const [ , framed ] = ( await renderLook( await solid( 2880, 1800, '#ffffff' ), look ) )[ 1 ];
		const { data } = await sharp( framed )
			.extract( { left: 0, top: 0, width: 1, height: 1 } )
			.raw()
			.toBuffer( { resolveWithObject: true } );
		expect( [ data[ 0 ], data[ 1 ], data[ 2 ] ] ).toEqual( [ 0x18, 0x18, 0x18 ] );
	} );

	it( 'keeps the tiles in looks/backgrounds the same as the frame draws', async () => {
		for ( const scheme of [ 'light', 'dark' ] as const ) {
			const tile = await readFile(
				path.join( LOOKS_DIR, 'backgrounds', `dots-${ scheme }.svg` ),
				'utf8'
			);
			expect( tile ).toBe( dotsTileSvg( scheme ) );
		}
	} );
} );

describe( 'video', () => {
	it( 'resamples frames to a steady rate, repeating the latest', () => {
		const frames = [ { at: 0 }, { at: 40 }, { at: 260 }, { at: 400 } ];
		expect( resample( frames, 10 ).map( ( f ) => f.at ) ).toEqual( [ 0, 40, 40, 260, 400 ] );
	} );

	it( 'merges runs of the same frame', () => {
		const a = { id: 'a' };
		const b = { id: 'b' };
		expect( collapseRepeats( [ a, a, b, a ], 100 ) ).toEqual( [
			{ frame: a, delay: 200 },
			{ frame: b, delay: 100 },
			{ frame: a, delay: 100 },
		] );
	} );

	it( 'writes an animated WebP and GIF without ffmpeg', async () => {
		temp = await mkdtemp( path.join( tmpdir(), 'capture-test-' ) );
		const jpeg = ( color: string ) =>
			sharp( { create: { width: 64, height: 40, channels: 3, background: color } } )
				.jpeg()
				.toBuffer();
		const frames = [
			{ at: 0, jpeg: await jpeg( '#ff0000' ) },
			{ at: 100, jpeg: await jpeg( '#00ff00' ) },
			{ at: 200, jpeg: await jpeg( '#0000ff' ) },
		];
		const results = await encodeVideo(
			frames,
			{ formats: [ 'webp', 'gif' ], fps: 10, width: 64, hold: 0, cursor: false, typingDelay: 0 },
			path.join( temp, 'clip' ),
			() => {}
		);
		expect( results.map( ( r ) => path.basename( r.file ) ) ).toEqual( [
			'clip.webp',
			'clip.gif',
		] );
		for ( const result of results ) {
			const { pages } = await sharp( result.file, { animated: true } ).metadata();
			expect( pages ).toBe( 3 );
		}
	} );
} );
