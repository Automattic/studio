import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { drawAnnotations } from './annotate.ts';
import { renderLook } from './frame.ts';
import { boundingBoxOf, union, type Box } from './locators.ts';
import type { Ctx } from './context.ts';
import type { Capture, Look, Shot } from './schema.ts';

// Shown in place of the throwaway profile's home directory, e.g. in the
// "Local path" and "Default site directory" fields.
const DISPLAY_HOME = '/Users/username';

// Shown in place of the signed-in account's email address.
const DISPLAY_EMAIL = 'you@example.com';

// macOS draws the close, minimize and zoom buttons over Studio's frameless
// window itself, so they are not in what Electron captures; they are drawn in
// where the window puts them.
const WINDOW_CONTROLS = {
	size: 12,
	gap: 8,
	colors: [
		[ '#ff5f57', '#e0443e' ],
		[ '#febc2e', '#dea123' ],
		[ '#28c840', '#1aab29' ],
	],
};
const WINDOW_CONTROLS_ID = 'studio-capture-window-controls';

/**
 * The on-screen text to rewrite: paths inside the throwaway profile, so they
 * read like a normal home directory, and the signed-in account's email.
 */
const replacementsFor = ( ctx: Ctx ): [ string, string ][] => [
	...ctx.profile.homes.map( ( home ): [ string, string ] => [ home, DISPLAY_HOME ] ),
	...( ctx.email ? [ [ ctx.email, DISPLAY_EMAIL ] as [ string, string ] ] : [] ),
];

/**
 * Rewrites text in the rendered DOM, never the app's data. Returns whether
 * any of it was still on screen.
 */
export async function tidyText( ctx: Ctx, replacements = replacementsFor( ctx ) ) {
	return ctx.w.evaluate( ( pairs ) => {
		let found = false;
		const fix = ( s: string ) => {
			const out = pairs.reduce( ( text, [ from, to ] ) => text.split( from ).join( to ), s );
			found ||= out !== s;
			return out;
		};
		const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
		for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
			const value = fix( node.nodeValue ?? '' );
			if ( value !== node.nodeValue ) {
				node.nodeValue = value;
			}
		}
		for ( const el of document.querySelectorAll< HTMLInputElement | HTMLTextAreaElement >(
			'input, textarea'
		) ) {
			const value = fix( el.value );
			if ( value !== el.value ) {
				el.value = value;
			}
		}
		for ( const el of document.querySelectorAll( '[aria-label], [title]' ) ) {
			for ( const attr of [ 'aria-label', 'title' ] ) {
				const value = el.getAttribute( attr );
				if ( value && fix( value ) !== value ) {
					el.setAttribute( attr, fix( value ) );
				}
			}
		}
		return found;
	}, replacements );
}

/** Throws if the signed-in account's email is back on screen after a re-render. */
export async function assertEmailHidden( ctx: Ctx ) {
	if ( ctx.email && ( await tidyText( ctx, [ [ ctx.email, DISPLAY_EMAIL ] ] ) ) ) {
		throw new Error( 'The account email reappeared on screen during the capture.' );
	}
}

// What Studio shows when something it loads from the internet fails (the
// Blueprints list, say): a shot of that is a broken shot, not a picture of Studio.
const LOAD_ERRORS = [ 'Check your internet connection' ];

/** Throws if the window shows one of Studio's could-not-load messages. */
async function assertLoaded( ctx: Ctx ) {
	const text = await ctx.w.evaluate( () => document.body.innerText );
	const error = LOAD_ERRORS.find( ( message ) => text.includes( message ) );
	if ( error ) {
		const line = text
			.split( '\n' )
			.find( ( l ) => l.includes( error ) )
			?.trim();
		throw new Error( `The window shows a loading error: "${ line }". Check the network.` );
	}
}

const CARET_STYLE = 'studio-capture-carets';
const HIDE_CARETS = `(() => {
	if ( ! document.getElementById( '${ CARET_STYLE }' ) ) {
		const style = document.createElement( 'style' );
		style.id = '${ CARET_STYLE }';
		style.textContent = '* { caret-color: transparent !important; }';
		document.head.appendChild( style );
	}
})()`;

/** Hides text carets in the window and the site preview, which blink in and out of captures. */
async function hideCarets( ctx: Ctx ) {
	await ctx.w.evaluate( HIDE_CARETS );
	await ctx.studio.inPreviews( HIDE_CARETS );
}

/** Dismisses toasts, parks the pointer and waits for the UI to settle. */
async function prepareFrame( ctx: Ctx, capture: Capture ) {
	for ( const dismiss of await ctx.w.getByRole( 'button', { name: 'Dismiss' } ).all() ) {
		await dismiss.click().catch( () => {} );
	}
	if ( ! capture.keepMouse ) {
		await ctx.w.evaluate( () => ( document.activeElement as HTMLElement | null )?.blur?.() );
		await ctx.w.mouse.move( 2, 2 );
	}
	// The site preview keeps its scroll position between shots; show its top.
	await ctx.studio.inPreviews( 'window.scrollTo(0, 0)' );
	await hideCarets( ctx );
	await ctx.w.evaluate( () => document.fonts.ready );
	await ctx.w.waitForTimeout( capture.settle ?? 700 );
	await tidyText( ctx );
}

/**
 * Draws the macOS window controls when the look asks for them and Studio
 * Desktop runs on macOS, which draws them outside what Electron captures;
 * returns a function that removes them.
 */
export async function drawWindowControls( ctx: Ctx ) {
	const position = ctx.look.windowControls && ( await ctx.studio.windowButtonPosition() );
	if ( ! position ) {
		return () => Promise.resolve();
	}
	await ctx.w.evaluate(
		( { id, c, position: at } ) => {
			document.getElementById( id )?.remove();
			const layer = document.createElement( 'div' );
			layer.id = id;
			Object.assign( layer.style, {
				position: 'fixed',
				left: `${ at.x }px`,
				top: `${ at.y }px`,
				display: 'flex',
				gap: `${ c.gap }px`,
				pointerEvents: 'none',
				zIndex: '2147483647',
			} );
			for ( const [ fill, edge ] of c.colors ) {
				const dot = document.createElement( 'div' );
				Object.assign( dot.style, {
					width: `${ c.size }px`,
					height: `${ c.size }px`,
					borderRadius: '50%',
					background: fill,
					boxShadow: `inset 0 0 0 0.5px ${ edge }`,
				} );
				layer.appendChild( dot );
			}
			document.body.appendChild( layer );
		},
		{ id: WINDOW_CONTROLS_ID, c: WINDOW_CONTROLS, position }
	);
	return () =>
		ctx.w
			.evaluate( ( id ) => document.getElementById( id )?.remove(), WINDOW_CONTROLS_ID )
			.catch( () => {} );
}

/**
 * The crop for a target box: `pad` around it (a number, or `[x, y]`), grown to
 * include the annotation extents, widened to at least `aspect` (width over
 * height) since docs pages are wider than they are tall, and kept inside the
 * window.
 */
export function cropFor(
	box: Box,
	{ pad, aspect }: { pad: number | [ number, number ]; aspect: number },
	viewport: { width: number; height: number }
) {
	const [ padX, padY ] = Array.isArray( pad ) ? pad : [ pad, pad ];
	const target = {
		x: box.x - padX,
		y: box.y - padY,
		width: box.width + padX * 2,
		height: box.height + padY * 2,
	};
	const inside = ( n: number, max: number ) => Math.min( Math.max( 0, n ), max );
	return ( extents: Box[] ): Box => {
		const framed = union( [ target, ...extents ] );
		const x1 = inside( framed.x, viewport.width );
		const y1 = inside( framed.y, viewport.height );
		const x2 = inside( framed.x + framed.width, viewport.width );
		const y2 = inside( framed.y + framed.height, viewport.height );
		let x = x1;
		let width = x2 - x1;
		const height = y2 - y1;
		if ( width < height * aspect ) {
			width = Math.min( viewport.width, height * aspect );
			x = inside( x1 - ( width - ( x2 - x1 ) ) / 2, viewport.width - width );
		}
		x = Math.floor( x );
		const y = Math.floor( y1 );
		return { x, y, width: Math.ceil( x + width ) - x, height: Math.ceil( y2 ) - y };
	};
}

/** The clip for a shot's `capture.target`, or the whole window without one. */
async function clipFor(
	ctx: Ctx,
	capture: Capture
): Promise< ( extents: Box[] ) => Box | undefined > {
	if ( ! capture.target ) {
		return () => undefined;
	}
	const box = union(
		await Promise.all( [ capture.target ].flat().map( ( target ) => boundingBoxOf( ctx, target ) ) )
	);
	// Electron windows have no Playwright viewport; the clip must stay inside the window.
	const viewport = await ctx.w.evaluate( () => ( { width: innerWidth, height: innerHeight } ) );
	return cropFor(
		box,
		{ pad: capture.pad ?? ctx.look.crop.pad, aspect: capture.aspect ?? ctx.look.crop.aspect },
		viewport
	);
}

/** A PNG of the window, or of `clip` (window coordinates), at the look's scale. */
export function screenshotWindow( ctx: Ctx, clip?: Box ) {
	return ctx.studio.screenshot( clip );
}

/**
 * The still as the look's format. WebP is lossless when that is smaller
 * (shots of plain UI), otherwise at the look's quality, which at 90 keeps 2x
 * text sharp at a fifth of the lossless size.
 */
export async function encodeStill( png: Buffer, still: Look[ 'still' ] ) {
	if ( still.format === 'png' ) {
		return sharp( png ).png( { compressionLevel: 9 } ).toBuffer();
	}
	const [ lossless, lossy ] = await Promise.all( [
		sharp( png ).webp( { lossless: true, effort: 4 } ).toBuffer(),
		sharp( png ).webp( { quality: still.quality, effort: 6 } ).toBuffer(),
	] );
	return lossless.length <= lossy.length ? lossless : lossy;
}

const decode = ( image: Buffer ) =>
	sharp( image ).ensureAlpha().raw().toBuffer( { resolveWithObject: true } );

type FileStatus = 'new' | 'changed' | 'unchanged';
export interface FileResult {
	file: string;
	status: FileStatus;
	// Pixels that differ from the file it replaces, beyond anti-aliasing noise.
	diffPixels?: number;
	// A picture of the differences, in check mode.
	diff?: string;
}

export interface WriteMode {
	// Compare with the file on disk without writing it (a visual check).
	check?: boolean;
	// Where a visual check puts pictures of what changed.
	diffDir?: string;
}

/**
 * Writes `image` unless the file already holds the same picture, so unchanged
 * shots leave git clean. Pixels within anti-aliasing noise of each other count
 * as the same (pixelmatch's threshold), since a few vary from run to run. In
 * check mode nothing is written, and a changed image's differences are drawn
 * into `diffDir`.
 */
export async function writeIfChanged(
	file: string,
	image: Buffer,
	mode: WriteMode = {}
): Promise< FileResult > {
	const current = await readFile( file ).catch( () => null );
	if ( current?.equals( image ) ) {
		return { file, status: 'unchanged', diffPixels: 0 };
	}
	let result: FileResult = { file, status: current ? 'changed' : 'new' };
	if ( current ) {
		const [ a, b ] = await Promise.all( [ decode( current ), decode( image ) ] );
		if ( a.info.width === b.info.width && a.info.height === b.info.height ) {
			const output = mode.diffDir ? Buffer.alloc( a.data.length ) : undefined;
			const diffPixels = pixelmatch( a.data, b.data, output, a.info.width, a.info.height, {
				threshold: 0.1,
			} );
			if ( diffPixels === 0 ) {
				return { file, status: 'unchanged', diffPixels };
			}
			result.diffPixels = diffPixels;
			if ( mode.check && output && mode.diffDir ) {
				const diff = path.join( mode.diffDir, `${ path.parse( file ).name }.png` );
				await mkdir( mode.diffDir, { recursive: true } );
				await sharp( output, {
					raw: { width: a.info.width, height: a.info.height, channels: 4 },
				} ).toFile( diff );
				result = { ...result, diff };
			}
		}
	}
	if ( ! mode.check ) {
		await mkdir( path.dirname( file ), { recursive: true } );
		await writeFile( file, image );
	}
	return result;
}

/**
 * Captures a shot after its steps ran: `<name>`, and `<name>-annotated` when
 * it has annotations, each in every form the look makes of it (see
 * `renderLook`). Returns each file and whether it changed.
 */
export async function captureShot( ctx: Ctx, shot: Shot, outDir: string, mode: WriteMode = {} ) {
	const capture = shot.capture ?? {};
	await prepareFrame( ctx, capture );
	await assertLoaded( ctx );
	const clip = await clipFor( ctx, capture );
	const results: FileResult[] = [];
	// The capture takes the compositor's latest frame; wait for one that has the overlays.
	const painted = async () => {
		await ctx.w.evaluate(
			() => new Promise( ( done ) => requestAnimationFrame( () => requestAnimationFrame( done ) ) )
		);
		await ctx.w.waitForTimeout( 150 );
	};
	const ext = ctx.look.still.format;
	const save = async ( suffix: string, extents: Box[] ) => {
		let png: Buffer;
		for ( let attempt = 1; ; attempt++ ) {
			await tidyText( ctx );
			await painted();
			png = await screenshotWindow( ctx, clip( extents ) );
			// A re-render after the rewrite can put a profile path or the
			// account's email back on screen, and into this capture; take another.
			if ( ! ( await tidyText( ctx ) ) ) {
				break;
			}
			if ( attempt >= 3 ) {
				throw new Error(
					'A profile path or the account email kept reappearing on screen during the capture.'
				);
			}
		}
		for ( const [ variant, image ] of await renderLook( png, ctx.look ) ) {
			const file = path.join( outDir, `${ shot.name }${ suffix }${ variant }.${ ext }` );
			results.push(
				await writeIfChanged( file, await encodeStill( image, ctx.look.still ), mode )
			);
		}
	};
	const removeWindowControls = await drawWindowControls( ctx );
	try {
		await save( '', [] );
		if ( shot.annotate?.length ) {
			const overlay = await drawAnnotations( ctx, shot.annotate );
			try {
				await save( '-annotated', overlay.extents );
			} finally {
				await overlay.remove();
			}
		}
	} finally {
		await removeWindowControls();
	}
	return results;
}

/** Saves what the window showed when a shot failed, next to the output. */
export async function captureFailure( ctx: Ctx, name: string, outDir: string ) {
	const file = path.join( outDir, 'failures', `${ name }.png` );
	try {
		await mkdir( path.dirname( file ), { recursive: true } );
		await tidyText( ctx );
		await writeFile( file, await screenshotWindow( ctx ) );
	} catch {
		// The failure itself is what matters; the window may be gone.
	}
	return file;
}
