/**
 * Frames stills for places that show them on a page of their own, where the
 * app's white edges would wash out: rounded corners, a hairline, a soft
 * shadow and a margin of the look's background. Everything scales with the
 * image's width, so small crops and full windows look alike. A look's
 * `outputs` then fit the framed still into fixed-size canvases, such as the
 * 1200×630 of a social card.
 */
import sharp from 'sharp';
import type { Look } from './schema.ts';

type Frame = NonNullable< Look[ 'frame' ] >;
type Output = NonNullable< Look[ 'outputs' ] >[ number ];

const svg = ( width: number, height: number, body: string ) =>
	Buffer.from(
		`<svg width="${ width }" height="${ height }" xmlns="http://www.w3.org/2000/svg">${ body }</svg>`
	);

function backgroundSvg( width: number, height: number, background: Frame[ 'background' ] ) {
	const [ from, to ] = Array.isArray( background ) ? background : [ background, background ];
	return svg(
		width,
		height,
		`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ from }"/><stop offset="1" stop-color="${ to }"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`
	);
}

/** `image` framed on the look's background, as a PNG. */
async function frameImage( image: Buffer, frame: Frame ): Promise< Buffer > {
	const { width = 0, height = 0 } = await sharp( image ).metadata();
	const pad = Math.round( width * frame.padding );
	const radius = Math.round( width * frame.radius );
	const blur = Math.round( width * frame.blur );
	const line = Math.max( 1, Math.round( width / 1400 ) );
	const W = width + pad * 2;
	const H = height + pad * 2;

	const shadow = await sharp(
		svg(
			W,
			H,
			`<rect x="${ pad }" y="${
				pad + blur / 2
			}" width="${ width }" height="${ height }" rx="${ radius }" fill="rgba(0,0,0,${
				frame.shadow
			})"/>`
		)
	)
		.blur( Math.max( 0.3, blur ) )
		.png()
		.toBuffer();
	const rounded = await sharp( image )
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
		}" rx="${ radius }" fill="none" stroke="${ frame.hairline }" stroke-width="${ line }"/>`
	);
	return sharp( backgroundSvg( W, H, frame.background ) )
		.composite( [
			{ input: shadow, left: 0, top: 0 },
			{ input: rounded, left: pad, top: pad },
			{ input: hairline, left: 0, top: 0 },
		] )
		.png()
		.toBuffer();
}

/**
 * The framed still fitted into an output's canvas: scaled to fit inside its
 * margin, never up, and centred on the frame's background.
 */
async function fitToOutput(
	framed: Buffer,
	output: Output,
	background: Frame[ 'background' ]
): Promise< Buffer > {
	const { width = 0, height = 0 } = await sharp( framed ).metadata();
	const room = {
		width: Math.round( output.width * ( 1 - output.margin * 2 ) ),
		height: Math.round( output.height * ( 1 - output.margin * 2 ) ),
	};
	const scale = Math.min( 1, room.width / width, room.height / height );
	const fitted = await sharp( framed )
		.resize( Math.round( width * scale ), Math.round( height * scale ) )
		.png()
		.toBuffer();
	const size = await sharp( fitted ).metadata();
	return sharp( backgroundSvg( output.width, output.height, background ) )
		.composite( [
			{
				input: fitted,
				left: Math.round( ( output.width - ( size.width ?? 0 ) ) / 2 ),
				top: Math.round( ( output.height - ( size.height ?? 0 ) ) / 2 ),
			},
		] )
		.png()
		.toBuffer();
}

/**
 * The images a look makes of one still, by file suffix: the still itself
 * (`''`, unless `keepRaw` is off and the look frames), and when the look
 * frames, `-framed` or one per output.
 */
export async function renderLook( png: Buffer, look: Look ): Promise< [ string, Buffer ][] > {
	const out: [ string, Buffer ][] = [];
	if ( ! look.frame || look.keepRaw ) {
		out.push( [ '', png ] );
	}
	if ( look.frame ) {
		const framed = await frameImage( png, look.frame );
		if ( look.outputs?.length ) {
			for ( const output of look.outputs ) {
				out.push( [
					output.suffix ? `-${ output.suffix }` : '',
					await fitToOutput( framed, output, look.frame.background ),
				] );
			}
		} else {
			out.push( [ look.keepRaw ? '-framed' : '', framed ] );
		}
	}
	return out;
}
