/**
 * Frames stills for places that show them on a page of their own, where the
 * app's white edges would wash out: rounded corners, a hairline, a soft
 * shadow and a margin of the look's background (a color, a gradient, or
 * Studio's own dot field). Everything scales with the
 * image's width, so small crops and full windows look alike. A crop that cuts
 * the window at a corner or along one edge runs off the image there instead,
 * with the margin on its other sides. A look's
 * `outputs` then fit the framed still into fixed-size canvases, such as the
 * 1200×630 of a social card.
 */
import sharp from 'sharp';
import type { Box } from './locators.ts';
import type { FrameMode, Look } from './schema.ts';

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

/** A dot grid laid out on a canvas: dots every `step` pixels, one at (`x`, `y`). */
type Grid = { step: number; x: number; y: number };

/**
 * The background at `width` × `height` pixels. `pixelRatio` is how many of
 * its pixels make one CSS pixel of the app next to it, so the dots come out
 * the size they are in Studio, on a grid centred on the canvas; a `grid` lays
 * them out instead, the dots keeping their size against the spacing.
 */
function backgroundSvg(
	width: number,
	height: number,
	background: Background,
	pixelRatio: number,
	grid?: Grid
) {
	if ( 'dots' in background ) {
		const { background: fill, dot } = DOTS[ background.dots ];
		const { step, x, y } = grid ?? {
			step: DOTS.spacing * pixelRatio,
			x: width / 2,
			y: height / 2,
		};
		return svg(
			width,
			height,
			`<defs><pattern id="d" patternUnits="userSpaceOnUse" x="${ x - step / 2 }" y="${
				y - step / 2
			}" width="${ step }" height="${ step }"><circle cx="${ step / 2 }" cy="${ step / 2 }" r="${
				( DOTS.radius * step ) / DOTS.spacing
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

/** Which of the window's edges a still reaches; a crop cuts the others. */
export type Edges = { top: boolean; right: boolean; bottom: boolean; left: boolean };

export const WHOLE_WINDOW: Edges = { top: true, right: true, bottom: true, left: true };

/** The window edges a clip (window coordinates) reaches; all of them without one. */
export function edgesOf(
	clip: Box | undefined,
	viewport: { width: number; height: number }
): Edges {
	if ( ! clip ) {
		return WHOLE_WINDOW;
	}
	return {
		top: clip.y <= 0,
		left: clip.x <= 0,
		right: clip.x + clip.width >= viewport.width - 1,
		bottom: clip.y + clip.height >= viewport.height - 1,
	};
}

/** The sides a frame leaves open, the window running off the image there. */
type Cut = Edges;

const NO_CUT: Cut = { top: false, right: false, bottom: false, left: false };

/**
 * How a still is framed, by the window edges it reaches: the whole window is
 * centred on the background; a crop that cuts one side, or two that meet at a
 * corner, runs off the image there, as if looking at that part of the window;
 * a crop that cuts opposite sides has no window shape left to frame, so it is
 * framed only when the shot asks (`always`, centred). `null` is no frame.
 */
export function framingFor( edges: Edges, mode: FrameMode = 'auto' ): Cut | null {
	if ( mode === 'never' ) {
		return null;
	}
	const cut = {
		top: ! edges.top,
		right: ! edges.right,
		bottom: ! edges.bottom,
		left: ! edges.left,
	};
	if ( ( cut.left && cut.right ) || ( cut.top && cut.bottom ) ) {
		return mode === 'always' ? NO_CUT : null;
	}
	return cut;
}

const isCut = ( cut: Cut ) => cut.top || cut.right || cut.bottom || cut.left;

/**
 * Draws `image` at (`left`, `top`) on a `width` × `height` background with the
 * frame's corners, hairline and shadow, which run off the canvas on the `cut`
 * sides. `scaleWidth` is the width the frame's shares are of.
 */
async function compose(
	image: Buffer,
	canvas: { width: number; height: number; left: number; top: number },
	cut: Cut,
	frame: Frame,
	background: Background,
	pixelRatio: number,
	scaleWidth: number,
	grid?: Grid
): Promise< Buffer > {
	const { width = 0, height = 0 } = await sharp( image ).metadata();
	const radius = Math.round( scaleWidth * frame.radius );
	const blur = Math.round( scaleWidth * frame.blur );
	const auto = AUTO_EDGE[ isDark( background ) ? 'dark' : 'light' ];
	const shadowOpacity = frame.shadow === 'auto' ? auto.shadow : frame.shadow;
	const hairlineColor = frame.hairline === 'auto' ? auto.hairline : frame.hairline;
	const line = Math.max( 1, Math.round( scaleWidth / 1400 ) );
	// The window's rounded rectangle reaches this far past a cut side, so its
	// corners, edge and shadow there fall outside the image.
	const past = radius + blur * 4 + line * 2 + 2;
	const ext = {
		top: cut.top ? past : 0,
		right: cut.right ? past : 0,
		bottom: cut.bottom ? past : 0,
		left: cut.left ? past : 0,
	};
	const W = canvas.width;
	const H = canvas.height;
	const x = canvas.left - ext.left;
	const y = canvas.top - ext.top;
	const w = width + ext.left + ext.right;
	const h = height + ext.top + ext.bottom;

	const shadow = await sharp(
		svg(
			W,
			H,
			`<rect x="${ x }" y="${
				y + blur / 2
			}" width="${ w }" height="${ h }" rx="${ radius }" fill="rgba(0,0,0,${ shadowOpacity })"/>`
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
					`<rect x="${ -ext.left }" y="${ -ext.top }" width="${ w }" height="${ h }" rx="${ radius }" fill="#fff"/>`
				),
				blend: 'dest-in',
			},
		] )
		.png()
		.toBuffer();
	const hairline = svg(
		W,
		H,
		`<rect x="${ x + line / 2 }" y="${ y + line / 2 }" width="${ w - line }" height="${
			h - line
		}" rx="${ radius }" fill="none" stroke="${ hairlineColor }" stroke-width="${ line }"/>`
	);
	return sharp( backgroundSvg( W, H, background, pixelRatio, grid ) )
		.composite( [
			{ input: shadow, left: 0, top: 0 },
			{ input: rounded, left: canvas.left, top: canvas.top },
			{ input: hairline, left: 0, top: 0 },
		] )
		.png()
		.toBuffer();
}

/**
 * `image` framed on the look's background, as a PNG: an even margin all
 * round, or with a `cut`, none on the cut sides and the same one in pixels on
 * the others.
 */
async function frameImage(
	image: Buffer,
	frame: Frame,
	background: Background,
	pixelRatio: number,
	cut: Cut = NO_CUT
): Promise< Buffer > {
	const { width = 0, height = 0 } = await sharp( image ).metadata();
	let pad: Record< keyof Cut, number >;
	if ( isCut( cut ) ) {
		const share = Array.isArray( frame.padding ) ? frame.padding[ 0 ] : frame.padding;
		const margin = Math.round( Math.max( width, height ) * share );
		pad = {
			top: cut.top ? 0 : margin,
			right: cut.right ? 0 : margin,
			bottom: cut.bottom ? 0 : margin,
			left: cut.left ? 0 : margin,
		};
	} else {
		const [ padX, padY ] = Array.isArray( frame.padding )
			? [ Math.round( width * frame.padding[ 0 ] ), Math.round( height * frame.padding[ 1 ] ) ]
			: [ Math.round( width * frame.padding ), Math.round( width * frame.padding ) ];
		pad = { top: padY, right: padX, bottom: padY, left: padX };
	}
	return compose(
		image,
		{
			width: width + pad.left + pad.right,
			height: height + pad.top + pad.bottom,
			left: pad.left,
			top: pad.top,
		},
		cut,
		frame,
		background,
		pixelRatio * frame.dotScale,
		width
	);
}

/**
 * A cut still in an output's canvas, running off it on the cut sides with the
 * output's margin on the others: scaled to fill the canvas where it can be
 * trimmed further on a cut side, and to fit across it where it can't. The
 * margin is the output's share of the canvas's mean side, so a wide card gets
 * as much as a square; whole rows of dots fill it, spaced about as they are
 * in the app at 1×, an equal step from the canvas's edge and the window's.
 */
async function anchorInOutput(
	image: Buffer,
	output: Output,
	cut: Cut,
	frame: Frame,
	background: Background,
	pixelRatio: number
): Promise< Buffer > {
	const { width = 0, height = 0 } = await sharp( image ).metadata();
	const margin = Math.round( ( output.margin * ( output.width + output.height ) ) / 2 );
	const room = {
		width: output.width - ( cut.left ? 0 : margin ) - ( cut.right ? 0 : margin ),
		height: output.height - ( cut.top ? 0 : margin ) - ( cut.bottom ? 0 : margin ),
	};
	const trimX = cut.left || cut.right;
	const trimY = cut.top || cut.bottom;
	let scale: number;
	if ( trimX && trimY ) {
		scale = Math.max( room.width / width, room.height / height );
	} else if ( trimY ) {
		scale = room.width / width;
	} else {
		scale = room.height / height;
	}
	const scaled = { width: Math.round( width * scale ), height: Math.round( height * scale ) };
	const shown = {
		width: Math.min( scaled.width, room.width ),
		height: Math.min( scaled.height, room.height ),
	};
	const fitted = await sharp( image )
		.resize( scaled.width, scaled.height )
		.extract( {
			left: cut.left ? scaled.width - shown.width : 0,
			top: cut.top ? scaled.height - shown.height : 0,
			width: shown.width,
			height: shown.height,
		} )
		.png()
		.toBuffer();
	const place = ( start: boolean, end: boolean, size: number, total: number ) => {
		if ( start ) {
			return 0;
		}
		return end ? total - size : Math.round( ( total - size ) / 2 );
	};
	const step = margin / Math.max( 1, Math.round( margin / ( DOTS.spacing * frame.dotScale ) ) );
	const grid = {
		step,
		x: cut.left ? output.width - margin + step / 2 : step / 2,
		y: cut.top ? output.height - margin + step / 2 : step / 2,
	};
	return compose(
		fitted,
		{
			width: output.width,
			height: output.height,
			left: place( cut.left, cut.right, shown.width, output.width ),
			top: place( cut.top, cut.bottom, shown.height, output.height ),
		},
		cut,
		frame,
		background,
		pixelRatio * frame.dotScale * scale,
		scaled.width,
		grid
	);
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
 * (`''`, unless the look frames it and `keepRaw` is off), and when the look
 * frames it (see `framingFor`), `-framed` or one per output.
 */
export async function renderLook(
	png: Buffer,
	look: Look,
	{ edges = WHOLE_WINDOW, frame = 'auto' }: { edges?: Edges; frame?: FrameMode } = {}
): Promise< [ string, Buffer ][] > {
	const out: [ string, Buffer ][] = [];
	const cut = look.frame ? framingFor( edges, frame ) : null;
	if ( ! look.frame || ! cut || look.keepRaw ) {
		out.push( [ '', png ] );
	}
	if ( ! look.frame || ! cut ) {
		return out;
	}
	const background = resolveBackground( look.frame.background, look );
	if ( ! look.outputs?.length ) {
		out.push( [
			look.keepRaw ? '-framed' : '',
			await frameImage( png, look.frame, background, look.scale, cut ),
		] );
		return out;
	}
	const framed = isCut( cut ) ? null : await frameImage( png, look.frame, background, look.scale );
	for ( const output of look.outputs ) {
		out.push( [
			output.suffix ? `-${ output.suffix }` : '',
			framed
				? await fitToOutput( framed, output, background, look.scale * look.frame.dotScale )
				: await anchorInOutput( png, output, cut, look.frame, background, look.scale ),
		] );
	}
	return out;
}
