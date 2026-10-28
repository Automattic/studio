import { buildBridgeScript, getSiteOrigin, getSiteUrl } from './playground';

interface PageCapture {
	dataUrl: string;
	// The page's full height, and the slice the capture covers.
	pageHeight: number;
	offset: number;
	height: number;
}

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
	// Captures from `offset` down, at most `maxHeight` pixels (the viewport by default).
	capture( options?: { offset?: number; maxHeight?: number } ): Promise< PageCapture >;
	close(): void;
}

const LOAD_TIMEOUT_MS = 90_000;

// A page of a running site, or a document of its own (`html`), which loads in
// a sandboxed frame without the app's origin and answers through the same
// bridge script.
export async function openSitePage(
	target: { scope: string; path: string } | { html: string },
	{ width = 1280, height = 800, settleMs = 600 } = {}
): Promise< SitePage > {
	const iframe = document.createElement( 'iframe' );
	iframe.setAttribute( 'aria-hidden', 'true' );
	iframe.style.cssText = `position:fixed;left:-${
		width + 100
	}px;top:0;width:${ width }px;height:${ height }px;border:0;`;
	const origin = 'html' in target ? 'null' : getSiteOrigin();
	const loaded = waitForMessage( iframe, origin, 'studio-web:loaded', () => true );
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
		const relative = target.path.replace( /^\/?(scope:[^/]+\/?)?/, '/' );
		iframe.src = `${ getSiteUrl( target.scope ) }${ relative }`;
	}
	document.body.appendChild( iframe );
	try {
		await loaded;
	} catch ( error ) {
		iframe.remove();
		throw error;
	}
	// Give web fonts and late layout a moment to settle.
	await new Promise( ( resolve ) => setTimeout( resolve, settleMs ) );

	async function request< T >( action: string, payload: Record< string, unknown > ): Promise< T > {
		const id = crypto.randomUUID();
		const response = waitForMessage(
			iframe,
			origin,
			'studio-web:response',
			( data ) => data.id === id
		);
		iframe.contentWindow?.postMessage(
			{ type: 'studio-web:request', id, action, payload },
			origin === 'null' ? '*' : origin
		);
		const { result, error } = ( await response ) as { result?: T; error?: string };
		if ( error ) {
			throw new Error( error );
		}
		return result as T;
	}

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
		if ( data.type === 'studio-web:loaded' ) {
			listeners.onPage();
		} else if ( data.type === 'studio-web:console' && typeof data.message === 'string' ) {
			listeners.onLog( data.message );
		}
	};
	window.addEventListener( 'message', onMessage );
	return {
		run( source: string ) {
			iframe.contentWindow?.postMessage(
				{ type: 'studio-web:request', id: crypto.randomUUID(), action: 'run', payload: { source } },
				getSiteOrigin()
			);
		},
		dispose: () => window.removeEventListener( 'message', onMessage ),
	};
}

// Opens a page, runs `task` on it, and closes it.
export async function withSitePage< T >(
	scope: string,
	path: string,
	options: Parameters< typeof openSitePage >[ 1 ],
	task: ( page: SitePage ) => Promise< T >
): Promise< T > {
	const page = await openSitePage( { scope, path }, options );
	try {
		return await task( page );
	} finally {
		page.close();
	}
}

function waitForMessage(
	iframe: HTMLIFrameElement,
	origin: string,
	type: string,
	matches: ( data: Record< string, unknown > ) => boolean
): Promise< Record< string, unknown > > {
	return new Promise( ( resolve, reject ) => {
		const timer = setTimeout( () => {
			window.removeEventListener( 'message', onMessage );
			reject( new Error( `Timed out waiting for ${ type }` ) );
		}, LOAD_TIMEOUT_MS );
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
