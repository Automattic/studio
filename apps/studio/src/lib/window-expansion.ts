import { screen } from 'electron';
import { WORKBENCH_EXPAND_HEIGHT, WORKBENCH_EXPAND_WIDTH } from 'src/constants';
import type { BrowserWindow, Rectangle } from 'electron';

// Native animated `setBounds` is macOS-only; elsewhere we tween manually.
const TWEEN_DURATION_MS = 350;
const TWEEN_STEP_MS = 16;
// macOS derives the animation duration from the resize distance and doesn't
// expose it; this backstop resolves the promise if `resized` never fires.
const NATIVE_ANIMATION_TIMEOUT_MS = 600;

function clamp( value: number, min: number, max: number ): number {
	return Math.min( Math.max( value, min ), Math.max( min, max ) );
}

/**
 * Bounds for growing a window to the workbench's comfortable size: never
 * shrinks an axis, grows around the window's center, and stays inside the
 * display's work area. Returns null when the window is already large enough.
 */
export function computeExpandedBounds( current: Rectangle, workArea: Rectangle ): Rectangle | null {
	const width = Math.min( Math.max( current.width, WORKBENCH_EXPAND_WIDTH ), workArea.width );
	const height = Math.min( Math.max( current.height, WORKBENCH_EXPAND_HEIGHT ), workArea.height );
	if ( width === current.width && height === current.height ) {
		return null;
	}

	const centerX = current.x + current.width / 2;
	const centerY = current.y + current.height / 2;
	const x = clamp(
		Math.round( centerX - width / 2 ),
		workArea.x,
		workArea.x + workArea.width - width
	);
	const y = clamp(
		Math.round( centerY - height / 2 ),
		workArea.y,
		workArea.y + workArea.height - height
	);

	return { x, y, width, height };
}

async function animateNative( window: BrowserWindow, target: Rectangle ): Promise< void > {
	window.setBounds( target, true );
	await new Promise< void >( ( resolve ) => {
		// `finish` only runs after the timer below is set.
		const finish = () => {
			clearTimeout( timeout );
			window.removeListener( 'resized', finish );
			resolve();
		};
		const timeout = setTimeout( finish, NATIVE_ANIMATION_TIMEOUT_MS );
		window.once( 'resized', finish );
	} );
}

async function animateTween( window: BrowserWindow, target: Rectangle ): Promise< void > {
	const start = window.getBounds();
	const startedAt = Date.now();
	await new Promise< void >( ( resolve ) => {
		const timer = setInterval( () => {
			if ( window.isDestroyed() ) {
				clearInterval( timer );
				resolve();
				return;
			}
			const progress = Math.min( 1, ( Date.now() - startedAt ) / TWEEN_DURATION_MS );
			const eased = 1 - Math.pow( 1 - progress, 3 );
			window.setBounds( {
				x: Math.round( start.x + ( target.x - start.x ) * eased ),
				y: Math.round( start.y + ( target.y - start.y ) * eased ),
				width: Math.round( start.width + ( target.width - start.width ) * eased ),
				height: Math.round( start.height + ( target.height - start.height ) * eased ),
			} );
			if ( progress >= 1 ) {
				clearInterval( timer );
				resolve();
			}
		}, TWEEN_STEP_MS );
	} );
}

/**
 * Smoothly grows the window to the workbench's comfortable size. Resolves once
 * the animation settles. No-ops when fullscreen, maximized, or already big
 * enough. The existing `resized` listener persists the final bounds.
 */
export async function expandWindowForWorkbench( window: BrowserWindow ): Promise< void > {
	if ( window.isDestroyed() || window.isFullScreen() || window.isMaximized() ) {
		return;
	}
	const bounds = window.getBounds();
	const { workArea } = screen.getDisplayMatching( bounds );
	const target = computeExpandedBounds( bounds, workArea );
	if ( ! target ) {
		return;
	}
	if ( process.platform === 'darwin' ) {
		await animateNative( window, target );
		return;
	}
	await animateTween( window, target );
}
