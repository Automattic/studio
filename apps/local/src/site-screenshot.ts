// A fresh screenshot of a running site, for the phone's preview. Unlike the
// desktop app's capture, it stores nothing: the site's stored preview stays
// the one the desktop app took.

interface CaptureOptions {
	width: number;
	height: number;
	scale?: number;
	format?: 'png' | 'jpeg';
}

// Rejects with `code: 'no-browser'` when no browser is installed to take it.
export type CapturePreview = ( url: string, options: CaptureOptions ) => Promise< Buffer >;

// The sizes the computer takes a shot at, by layout. The phone cannot ask for
// others.
export const SCREENSHOT_LAYOUTS = {
	phone: { width: 393, height: 852, scale: 3 },
	desktop: { width: 1280, height: 800, scale: 2 },
} as const;

export type ScreenshotLayout = keyof typeof SCREENSHOT_LAYOUTS;

export type ScreenshotAnswer =
	| { image: string; takenAt: number }
	| { image: null; reason: 'stopped' | 'no-browser' | 'failed' };

// The phone's API client gives up after 10 s. Counted from when the request
// came, this answers before it does.
const SCREENSHOT_LIMIT_MS = 8000;

function isNoBrowser( error: unknown ): boolean {
	return (
		typeof error === 'object' && error !== null && 'code' in error && error.code === 'no-browser'
	);
}

// One capture per site and layout at a time: a request that comes while one
// is under way waits for that one, even after an earlier request gave up on
// it, so a slow site never has two pages open in the browser for one shot.
export function createScreenshotTaker( capture: CapturePreview | undefined, now = Date.now ) {
	const taking = new Map< string, Promise< Buffer > >();

	// `since`: when the request came, so the time spent before the shot counts.
	return async function take(
		site: { id: string; url: string; running: boolean },
		layout: ScreenshotLayout,
		since = now()
	): Promise< ScreenshotAnswer > {
		if ( ! site.running ) {
			return { image: null, reason: 'stopped' };
		}
		if ( ! capture ) {
			return { image: null, reason: 'no-browser' };
		}
		const key = `${ site.id } ${ layout }`;
		let shot = taking.get( key );
		if ( ! shot ) {
			const started = capture( site.url, { ...SCREENSHOT_LAYOUTS[ layout ], format: 'jpeg' } );
			const forget = () => {
				if ( taking.get( key ) === started ) {
					taking.delete( key );
				}
			};
			started.then( forget, forget );
			taking.set( key, started );
			shot = started;
		}
		let timer: ReturnType< typeof setTimeout > | undefined;
		const limit = new Promise< never >( ( _resolve, reject ) => {
			timer = setTimeout(
				() => reject( new Error( 'Screenshot took too long.' ) ),
				Math.max( 0, SCREENSHOT_LIMIT_MS - ( now() - since ) )
			);
		} );
		try {
			const jpeg = await Promise.race( [ shot, limit ] );
			return { image: `data:image/jpeg;base64,${ jpeg.toString( 'base64' ) }`, takenAt: now() };
		} catch ( error ) {
			return { image: null, reason: isNoBrowser( error ) ? 'no-browser' : 'failed' };
		} finally {
			clearTimeout( timer );
		}
	};
}
