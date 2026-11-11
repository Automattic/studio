import {
	STUDIO_CHAT_MAX_IMAGE_BYTES,
	type StudioChatImage,
} from '@studio/agent/protocol/chat-images';
import { buildBridgeScript, getSiteOrigin, getSiteUrl } from './playground';
import type { InspectorSelection } from '@studio/agent/protocol/inspector/selection';

// A page of a running site, loaded in an off-screen frame of a given size. The
// site's bridge script (see playground.ts) runs page scripts and captures in it.
export interface SitePage {
	// Runs a self-contained function in the page with JSON-serializable args.
	evaluate< A extends unknown[], R >(
		script: ( ...args: A ) => R,
		...args: A
	): Promise< Awaited< R > >;
	waitFor( condition: () => boolean, timeoutMs?: number ): Promise< void >;
	setColorScheme( scheme: 'light' | 'dark' ): Promise< void >;
	// Captures from `offset` down, at most `maxHeight` pixels (the viewport by
	// default), as a JPEG data URL.
	capture( options?: { offset?: number; maxHeight?: number } ): Promise< string >;
	close(): void;
}

const LOAD_TIMEOUT_MS = 90_000;
// Matches the Desktop app's: a page that navigated away never answers.
const CAPTURE_TIMEOUT_MS = 10_000;
const SETTLE_MS = 600;

// A page of a running site, or a document of its own (`html`), which loads in
// a sandboxed frame without the app's origin and answers through the same
// bridge script.
export async function openSitePage(
	target: { scope: string; path: string } | { html: string },
	{ width = 1280, height = 800 } = {}
): Promise< SitePage > {
	const iframe = document.createElement( 'iframe' );
	iframe.setAttribute( 'aria-hidden', 'true' );
	iframe.style.cssText = `position:fixed;left:-${
		width + 100
	}px;top:0;width:${ width }px;height:${ height }px;border:0;`;
	const origin = 'html' in target ? 'null' : getSiteOrigin();
	const loaded = waitForMessage( iframe, origin, 'studio:loaded', () => true );
	if ( 'html' in target ) {
		iframe.setAttribute( 'sandbox', 'allow-scripts' );
		const bridge = `<script>${ buildBridgeScript( window.location.origin ).replace(
			/<\//g,
			'<\\/'
		) }</script>`;
		iframe.srcdoc = /<\/body>/i.test( target.html )
			? target.html.replace( /<\/body>/i, `${ bridge }</body>` )
			: `${ target.html }${ bridge }`;
	} else {
		iframe.src = `${ getSiteUrl( target.scope ) }${ target.path }`;
	}
	document.body.appendChild( iframe );
	try {
		await loaded;
	} catch ( error ) {
		iframe.remove();
		throw error;
	}
	// Give web fonts and late layout a moment to settle.
	await new Promise( ( resolve ) => setTimeout( resolve, SETTLE_MS ) );

	const request = < T >( action: string, payload: Record< string, unknown > ) =>
		requestFrame< T >( iframe, origin, action, payload );

	return {
		evaluate: ( script, ...args ) => request( 'evaluate', { source: script.toString(), args } ),
		waitFor: async ( condition, timeoutMs ) => {
			await request( 'wait-for', { source: condition.toString(), timeoutMs } );
		},
		setColorScheme: async ( scheme ) => {
			await request( 'color-scheme', { scheme } );
		},
		capture: ( options = {} ) => request( 'capture', options ),
		close: () => iframe.remove(),
	};
}

// Follows a preview frame's pages: each load, and the inspector's messages.
export function connectPreviewFrame(
	iframe: HTMLIFrameElement,
	listeners: { onPage(): void; onLog( message: string ): void }
) {
	const onMessage = ( event: MessageEvent ) => {
		const data = event.data as { type?: string; message?: unknown } | null;
		if ( event.origin !== getSiteOrigin() || event.source !== iframe.contentWindow || ! data ) {
			return;
		}
		if ( data.type === 'studio:loaded' ) {
			listeners.onPage();
		} else if ( data.type === 'studio:console' && typeof data.message === 'string' ) {
			listeners.onLog( data.message );
		}
	};
	window.addEventListener( 'message', onMessage );
	return {
		run( source: string ) {
			iframe.contentWindow?.postMessage(
				{ type: 'studio:request', id: crypto.randomUUID(), action: 'run', payload: { source } },
				getSiteOrigin()
			);
		},
		dispose: () => window.removeEventListener( 'message', onMessage ),
	};
}

// Captures the area of the preview frame's page that an annotation selected,
// with its drawing over it, as the annotation's chat image.
export async function capturePreviewRegion(
	iframe: HTMLIFrameElement,
	selection: InspectorSelection
): Promise< StudioChatImage > {
	const { rect, scroll, drawing } = selection;
	const scale = Math.min(
		window.devicePixelRatio || 1,
		2000 / Math.max( rect.width, rect.height )
	);
	const dataUrl = await requestFrame< string >(
		iframe,
		getSiteOrigin(),
		'capture-region',
		{
			id: selection.id,
			url: selection.target.url,
			viewport: selection.target.viewport,
			scroll,
			rect,
			scale,
		},
		CAPTURE_TIMEOUT_MS
	);
	const image = new Image();
	image.src = dataUrl;
	await image.decode();
	let canvas = document.createElement( 'canvas' );
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext( '2d' )!;
	context.drawImage( image, 0, 0 );
	if ( drawing ) {
		// Strokes are in document coordinates.
		context.scale( canvas.width / rect.width, canvas.height / rect.height );
		context.translate( -( scroll.left + rect.left ), -( scroll.top + rect.top ) );
		context.strokeStyle = drawing.color;
		context.lineWidth = drawing.width;
		context.lineCap = 'round';
		context.lineJoin = 'round';
		for ( const stroke of drawing.strokes ) {
			context.beginPath();
			stroke.forEach( ( point, index ) =>
				index ? context.lineTo( point.x, point.y ) : context.moveTo( point.x, point.y )
			);
			context.stroke();
		}
	}
	let png = await toPng( canvas );
	while (
		png.size > STUDIO_CHAT_MAX_IMAGE_BYTES &&
		Math.max( canvas.width, canvas.height ) > 128
	) {
		const smaller = document.createElement( 'canvas' );
		smaller.width = Math.max( 1, Math.floor( canvas.width * 0.75 ) );
		smaller.height = Math.max( 1, Math.floor( canvas.height * 0.75 ) );
		smaller.getContext( '2d' )!.drawImage( canvas, 0, 0, smaller.width, smaller.height );
		canvas = smaller;
		png = await toPng( canvas );
	}
	if ( png.size > STUDIO_CHAT_MAX_IMAGE_BYTES ) {
		throw new Error( 'The annotation screenshot is too large.' );
	}
	const bytes = new Uint8Array( await png.arrayBuffer() );
	let binary = '';
	for ( let index = 0; index < bytes.length; index += 0x8000 ) {
		binary += String.fromCharCode( ...bytes.subarray( index, index + 0x8000 ) );
	}
	return {
		id: crypto.randomUUID(),
		name: drawing ? 'Drawing.png' : 'Selected area.png',
		mimeType: 'image/png',
		size: png.size,
		width: canvas.width,
		height: canvas.height,
		dataBase64: btoa( binary ),
	};
}

function toPng( canvas: HTMLCanvasElement ): Promise< Blob > {
	return new Promise( ( resolve, reject ) =>
		canvas.toBlob(
			( blob ) => ( blob ? resolve( blob ) : reject( new Error( 'Could not encode the image.' ) ) ),
			'image/png'
		)
	);
}

// Opens a page, runs `task` on it, and closes it.
export async function withSitePage< T >(
	scope: string,
	path: string,
	task: ( page: SitePage ) => Promise< T >
): Promise< T > {
	const page = await openSitePage( { scope, path } );
	try {
		return await task( page );
	} finally {
		page.close();
	}
}

// Asks a frame's bridge script to run an action, and returns its result.
async function requestFrame< T >(
	iframe: HTMLIFrameElement,
	origin: string,
	action: string,
	payload: Record< string, unknown >,
	timeoutMs = LOAD_TIMEOUT_MS
): Promise< T > {
	const id = crypto.randomUUID();
	const response = waitForMessage(
		iframe,
		origin,
		'studio:response',
		( data ) => data.id === id,
		timeoutMs
	);
	iframe.contentWindow?.postMessage(
		{ type: 'studio:request', id, action, payload },
		origin === 'null' ? '*' : origin
	);
	const { result, error } = ( await response ) as { result?: T; error?: string };
	if ( error ) {
		throw new Error( error );
	}
	return result as T;
}

function waitForMessage(
	iframe: HTMLIFrameElement,
	origin: string,
	type: string,
	matches: ( data: Record< string, unknown > ) => boolean,
	timeoutMs = LOAD_TIMEOUT_MS
): Promise< Record< string, unknown > > {
	return new Promise( ( resolve, reject ) => {
		const timer = setTimeout( () => {
			window.removeEventListener( 'message', onMessage );
			reject( new Error( `Timed out waiting for ${ type }` ) );
		}, timeoutMs );
		function onMessage( event: MessageEvent ) {
			const data = event.data as Record< string, unknown > | null;
			if (
				event.origin !== origin ||
				event.source !== iframe.contentWindow ||
				! data ||
				data.type !== type ||
				! matches( data )
			) {
				return;
			}
			clearTimeout( timer );
			window.removeEventListener( 'message', onMessage );
			resolve( data );
		}
		window.addEventListener( 'message', onMessage );
	} );
}
