/**
 * Frames screenshots for places that show them on a white page, such as a
 * blog post, where the app's own white edges would wash out: each image gets
 * rounded corners, a hairline, a soft shadow and a margin of neutral gray.
 * The gray is lighter than the app's dimmed backdrop behind dialogs (#E9E9E9),
 * so a dialog shot doesn't sit gray-on-gray. Everything scales with the
 * image's width, so small crops and full windows look alike.
 *
 *   npm run screenshots:frame -- [--out <dir>] <image…>
 *
 * Writes `<name>.webp` to `--out` (default `screenshots/framed/`).
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { SCREENSHOTS_DIR } from './lib/common.mjs';

const BACKGROUND = [ '#F7F7F7', '#F1F1F1' ];
const HAIRLINE = 'rgba(0,0,0,0.10)';
const SHADOW = 0.14;

const args = process.argv.slice( 2 );
const outIndex = args.indexOf( '--out' );
const outDir =
	outIndex === -1 ? path.join( SCREENSHOTS_DIR, 'framed' ) : path.resolve( args[ outIndex + 1 ] );
const files = args.filter( ( _arg, index ) => index !== outIndex && index !== outIndex + 1 );
if ( ! files.length ) {
	console.error( 'Usage: npm run screenshots:frame -- [--out <dir>] <image…>' );
	process.exit( 1 );
}
await mkdir( outDir, { recursive: true } );

const svg = ( width, height, body ) =>
	Buffer.from(
		`<svg width="${ width }" height="${ height }" xmlns="http://www.w3.org/2000/svg">${ body }</svg>`
	);

for ( const file of files ) {
	const { width, height } = await sharp( file ).metadata();
	const pad = Math.round( width * 0.06 );
	const radius = Math.round( width * 0.012 );
	const blur = Math.round( width * 0.015 );
	const line = Math.max( 1, Math.round( width / 1400 ) );
	const W = width + pad * 2;
	const H = height + pad * 2;

	const background = svg(
		W,
		H,
		`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ BACKGROUND[ 0 ] }"/><stop offset="1" stop-color="${ BACKGROUND[ 1 ] }"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`
	);
	const shadow = await sharp(
		svg(
			W,
			H,
			`<rect x="${ pad }" y="${
				pad + blur / 2
			}" width="${ width }" height="${ height }" rx="${ radius }" fill="rgba(0,0,0,${ SHADOW })"/>`
		)
	)
		.blur( blur )
		.png()
		.toBuffer();
	const rounded = await sharp( file )
		.ensureAlpha()
		.composite( [
			{
				input: svg(
					width,
					height,
					`<rect width="${ width }" height="${ height }" rx="${ radius }" fill="#fff"/>`
				),
				blend: 'dest-in',
			},
		] )
		.png()
		.toBuffer();
	const hairline = svg(
		W,
		H,
		`<rect x="${ pad + line / 2 }" y="${ pad + line / 2 }" width="${ width - line }" height="${
			height - line
		}" rx="${ radius }" fill="none" stroke="${ HAIRLINE }" stroke-width="${ line }"/>`
	);

	const out = path.join( outDir, `${ path.parse( file ).name }.webp` );
	await sharp( background )
		.composite( [
			{ input: shadow, left: 0, top: 0 },
			{ input: rounded, left: pad, top: pad },
			{ input: hairline, left: 0, top: 0 },
		] )
		.webp( { quality: 90 } )
		.toFile( out );
	console.log( `  ${ path.relative( process.cwd(), out ) }  ${ W }x${ H }` );
}
