import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { drawAnnotations } from './annotate.mjs';
import { boundingBoxOf, union } from './locators.mjs';

// Shown in place of the throwaway profile's home directory, e.g. in the
// "Local path" and "Default site directory" fields.
const DISPLAY_HOME = '/Users/username';

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
const WINDOW_CONTROLS_ID = 'studio-docs-window-controls';

/**
 * Rewrites any on-screen path inside the throwaway profile so it reads like a
 * normal home directory. Only the rendered DOM changes, never the app's data.
 */
async function tidyPaths( window, homes ) {
	await window.evaluate(
		( { homes, display } ) => {
			const fix = ( s ) => homes.reduce( ( out, home ) => out.split( home ).join( display ), s );
			const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
			for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
				if ( homes.some( ( h ) => node.nodeValue.includes( h ) ) ) {
					node.nodeValue = fix( node.nodeValue );
				}
			}
			for ( const el of document.querySelectorAll( 'input, textarea' ) ) {
				if ( homes.some( ( h ) => el.value.includes( h ) ) ) {
					el.value = fix( el.value );
				}
			}
			for ( const el of document.querySelectorAll( '[aria-label], [title]' ) ) {
				for ( const attr of [ 'aria-label', 'title' ] ) {
					const value = el.getAttribute( attr );
					if ( value && homes.some( ( h ) => value.includes( h ) ) ) {
						el.setAttribute( attr, fix( value ) );
					}
				}
			}
		},
		{ homes, display: DISPLAY_HOME }
	);
}

/** Dismisses toasts, parks the pointer and waits for the UI to settle. */
async function prepareFrame( ctx, capture ) {
	for ( const dismiss of await ctx.w.getByRole( 'button', { name: 'Dismiss' } ).all() ) {
		await dismiss.click().catch( () => {} );
	}
	if ( ! capture.keepMouse ) {
		await ctx.w.evaluate( () => document.activeElement?.blur?.() );
		await ctx.w.mouse.move( 2, 2 );
	}
	// The site preview keeps its scroll position between shots; show its top.
	await ctx.w.evaluate( () =>
		Promise.all(
			[ ...document.querySelectorAll( 'webview' ) ].map( ( view ) =>
				view.executeJavaScript( 'window.scrollTo(0, 0)' ).catch( () => null )
			)
		)
	);
	await ctx.w.evaluate( () => document.fonts.ready );
	await ctx.w.waitForTimeout( capture.settle ?? 700 );
	await tidyPaths( ctx.w, ctx.profile.homes );
}

/** Draws the macOS window controls on macOS; returns a function that removes them. */
async function drawWindowControls( ctx ) {
	const position =
		process.platform === 'darwin' &&
		( await ctx.app.evaluate( ( { BrowserWindow } ) =>
			BrowserWindow.getAllWindows()[ 0 ].getWindowButtonPosition()
		) );
	if ( ! position ) {
		return () => {};
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

// Docs pages are wider than they are tall, so a crop is never taller than
// this ratio allows: a tall target is framed with more of the window beside it.
const MIN_ASPECT = 3 / 2;

/**
 * The clip for a cropped shot: `capture.target` (a locator, or a list of them
 * to frame together, such as a menu and the button that opened it) plus `pad`
 * (a number, or `[x, y]`), grown to include the annotation extents, widened
 * to at least `aspect` (width over height, 3:2 unless the shot says) and kept
 * inside the window.
 */
async function clipFor( ctx, capture ) {
	const box = union(
		await Promise.all( [ capture.target ].flat().map( ( target ) => boundingBoxOf( ctx, target ) ) )
	);
	const [ padX, padY ] = Array.isArray( capture.pad )
		? capture.pad
		: [ capture.pad ?? 48, capture.pad ?? 48 ];
	const target = {
		x: box.x - padX,
		y: box.y - padY,
		width: box.width + padX * 2,
		height: box.height + padY * 2,
	};
	const aspect = capture.aspect ?? MIN_ASPECT;
	// Electron windows have no Playwright viewport; the clip must stay inside the window.
	const viewport = await ctx.w.evaluate( () => ( { width: innerWidth, height: innerHeight } ) );
	const inside = ( n, max ) => Math.min( Math.max( 0, n ), max );
	return ( extents ) => {
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

/**
 * A PNG of the window, or of `clip` (window coordinates), from Electron's own
 * capture. Playwright's screenshot draws the site preview's `<webview>` at the
 * wrong scale, while this is what Studio's site thumbnails use.
 */
async function screenshotWindow( ctx, clip ) {
	for ( let attempt = 1; ; attempt++ ) {
		try {
			const base64 = await ctx.app.evaluate( async ( { BrowserWindow }, clip ) => {
				const image = await BrowserWindow.getAllWindows()[ 0 ].webContents.capturePage( clip );
				return image.toPNG().toString( 'base64' );
			}, clip );
			return Buffer.from( base64, 'base64' );
		} catch ( error ) {
			// The compositor occasionally has no frame to hand out (UnknownVizError).
			if ( attempt >= 5 ) {
				throw error;
			}
			await ctx.w.waitForTimeout( 200 );
		}
	}
}

/**
 * The shot as WebP, for the web: lossless when that is smaller (shots of
 * plain UI), otherwise quality 90, which keeps 2x text sharp at a fifth of
 * the lossless size.
 */
async function toWebp( png ) {
	const [ lossless, lossy ] = await Promise.all( [
		sharp( png ).webp( { lossless: true, effort: 4 } ).toBuffer(),
		sharp( png ).webp( { quality: 90, effort: 6 } ).toBuffer(),
	] );
	return lossless.length <= lossy.length ? lossless : lossy;
}

const decode = ( image ) =>
	sharp( image ).ensureAlpha().raw().toBuffer( { resolveWithObject: true } );

/**
 * Writes `image` unless the file already holds the same picture, so unchanged
 * shots leave git clean. Pixels within anti-aliasing noise of each other count
 * as the same (pixelmatch's threshold), since a few vary from run to run.
 */
async function writeIfChanged( file, image ) {
	const current = await readFile( file ).catch( () => null );
	if ( current?.equals( image ) ) {
		return false;
	}
	if ( current ) {
		const [ a, b ] = await Promise.all( [ decode( current ), decode( image ) ] );
		if (
			a.info.width === b.info.width &&
			a.info.height === b.info.height &&
			pixelmatch( a.data, b.data, null, a.info.width, a.info.height, { threshold: 0.1 } ) === 0
		) {
			return false;
		}
	}
	await mkdir( path.dirname( file ), { recursive: true } );
	await writeFile( file, image );
	return true;
}

/**
 * Captures a shot after its steps ran: `<name>.webp`, and `<name>-annotated.webp`
 * when it has annotations. Returns each file and whether it changed.
 */
export async function captureShot( ctx, shot, outDir ) {
	const capture = shot.capture ?? {};
	await prepareFrame( ctx, capture );
	const clip = capture.target ? await clipFor( ctx, capture ) : () => undefined;
	const results = [];
	// The capture takes the compositor's latest frame; wait for one that has the overlays.
	const painted = async () => {
		await ctx.w.evaluate(
			() => new Promise( ( done ) => requestAnimationFrame( () => requestAnimationFrame( done ) ) )
		);
		await ctx.w.waitForTimeout( 150 );
	};
	const save = async ( suffix, extents ) => {
		const file = path.join( outDir, `${ shot.name }${ suffix }.webp` );
		await painted();
		const image = await toWebp( await screenshotWindow( ctx, clip( extents ) ) );
		results.push( { file, changed: await writeIfChanged( file, image ) } );
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
export async function captureFailure( ctx, shot, outDir ) {
	const file = path.join( outDir, 'failures', `${ shot.name }.png` );
	try {
		await mkdir( path.dirname( file ), { recursive: true } );
		await writeFile( file, await screenshotWindow( ctx ) );
	} catch {
		// The failure itself is what matters; the window may be gone.
	}
	return file;
}
