/**
 * Frames stills for places that show them on a page of their own, where the
 * app's white edges would wash out: rounded corners, a hairline, a soft
 * shadow and a margin of the look's background (a color, a gradient, or
 * Studio's own dot field). Everything scales with the
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

/**
 * The dot field behind an empty chat in Studio (`apps/ui/src/features/sites/
 * preview-particles`): dots of a 1px radius every 26px, in CSS pixels, in the
 * colors `--preview-dot` and `--chat` resolve to at the default appearance.
 */
export const DOTS = {
	spacing: 26,
	radius: 1,
	// A step off the app's white, so a white window's edge still reads on it.
	light: { background: '#fafafa', dot: '#c3c3c3' },
	dark: { background: '#181818', dot: '#414141' },
} as const;

type DotScheme = 'light' | 'dark';

/** A frame background as drawn: colors, or the dot field in one scheme. */
type Background = { colors: [ string, string ] } | { dots: DotScheme };

function resolveBackground( background: Frame[ 'background' ], look: Look ): Background {
	if ( background === 'dots' ) {
		return { dots: look.appearance.colorScheme === 'dark' ? 'dark' : 'light' };
	}
	if ( background === 'dots-light' || background === 'dots-dark' ) {
		return { dots: background === 'dots-dark' ? 'dark' : 'light' };
	}
	return { colors: Array.isArray( background ) ? background : [ background, background ] };
}

/**
 * Whether a background is dark. The window's edge follows the background,
 * not the app: on a dark one it needs a light line and a deeper shadow.
 */
function isDark( background: Background ) {
	if ( 'dots' in background ) {
		return background.dots === 'dark';
	}
	const hex = /^#([0-9a-f]{6})$/i.exec( background.colors[ 0 ] )?.[ 1 ];
	if ( ! hex ) {
		return false;
	}
	const [ r, g, b ] = [ 0, 2, 4 ].map( ( i ) => parseInt( hex.slice( i, i + 2 ), 16 ) );
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

const AUTO_EDGE = {
	light: { shadow: 0.08, hairline: 'rgba(0,0,0,0.07)' },
	dark: { shadow: 0.45, hairline: 'rgba(255,255,255,0.12)' },
};

/** One tile of the dot field at 1x, as an SVG, for pages that repeat it. */
export function dotsTileSvg( scheme: DotScheme ) {
	const { background, dot } = DOTS[ scheme ];
	const half = DOTS.spacing / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${ DOTS.spacing }" height="${ DOTS.spacing }" viewBox="0 0 ${ DOTS.spacing } ${ DOTS.spacing }"><rect width="${ DOTS.spacing }" height="${ DOTS.spacing }" fill="${ background }"/><circle cx="${ half }" cy="${ half }" r="${ DOTS.radius }" fill="${ dot }"/></svg>\n`;
}

/**
 * The background at `width` × `height` pixels. `pixelRatio` is how many of
 * its pixels make one CSS pixel of the app next to it, so the dots come out
 * the size they are in Studio; the grid is centred on the canvas.
 */
function backgroundSvg(
	width: number,
	height: number,
	background: Background,
	pixelRatio: number
) {
	if ( 'dots' in background ) {
		const { background: fill, dot } = DOTS[ background.dots ];
		const step = DOTS.spacing * pixelRatio;
		return svg(
			width,
			height,
			`<defs><pattern id="d" patternUnits="userSpaceOnUse" x="${ width / 2 - step / 2 }" y="${
				height / 2 - step / 2
			}" width="${ step }" height="${ step }"><circle cx="${ step / 2 }" cy="${ step / 2 }" r="${
				DOTS.radius * pixelRatio
			}" fill="${ dot }"/></pattern></defs><rect width="100%" height="100%" fill="${ fill }"/><rect width="100%" height="100%" fill="url(#d)"/>`
		);
	}
	const [ from, to ] = background.colors;
	return svg(
		width,
		height,
		`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ from }"/><stop offset="1" stop-color="${ to }"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`
	);
}

/** `image` framed on the look's background, as a PNG. */
async function frameImage(
	image: Buffer,
	frame: Frame,
	background: Background,
	pixelRatio: number
): Promise< Buffer > {
	const { width = 0, height = 0 } = await sharp( image ).metadata();
	const [ padX, padY ] = Array.isArray( frame.padding )
		? [ Math.round( width * frame.padding[ 0 ] ), Math.round( height * frame.padding[ 1 ] ) ]
		: [ Math.round( width * frame.padding ), Math.round( width * frame.padding ) ];
	const radius = Math.round( width * frame.radius );
	const blur = Math.round( width * frame.blur );
	const auto = AUTO_EDGE[ isDark( background ) ? 'dark' : 'light' ];
	const shadowOpacity = frame.shadow === 'auto' ? auto.shadow : frame.shadow;
	const hairlineColor = frame.hairline === 'auto' ? auto.hairline : frame.hairline;
	const line = Math.max( 1, Math.round( width / 1400 ) );
	const W = width + padX * 2;
	const H = height + padY * 2;

	const shadow = await sharp(
		svg(
			W,
			H,
			`<rect x="${ padX }" y="${
				padY + blur / 2
			}" width="${ width }" height="${ height }" rx="${ radius }" fill="rgba(0,0,0,${ shadowOpacity })"/>`
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
		`<rect x="${ padX + line / 2 }" y="${ padY + line / 2 }" width="${ width - line }" height="${
			height - line
		}" rx="${ radius }" fill="none" stroke="${ hairlineColor }" stroke-width="${ line }"/>`
	);
	return sharp( backgroundSvg( W, H, background, pixelRatio * frame.dotScale ) )
		.composite( [
			{ input: shadow, left: 0, top: 0 },
			{ input: rounded, left: padX, top: padY },
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
	background: Background,
	pixelRatio: number
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
	// The still shrinks to fit, and the dots with it.
	return sharp( backgroundSvg( output.width, output.height, background, pixelRatio * scale ) )
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
		const background = resolveBackground( look.frame.background, look );
		const framed = await frameImage( png, look.frame, background, look.scale );
		if ( look.outputs?.length ) {
			for ( const output of look.outputs ) {
				out.push( [
					output.suffix ? `-${ output.suffix }` : '',
					await fitToOutput( framed, output, background, look.scale * look.frame.dotScale ),
				] );
			}
		} else {
			out.push( [ look.keepRaw ? '-framed' : '', framed ] );
		}
	}
	return out;
}
