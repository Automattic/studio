import { handleDeeplink } from 'src/lib/deeplink/deeplink-handler';
import { getMainWindow } from 'src/main-window';
import type { WebContents } from 'electron';

// Links that arrive before Studio can act on them wait here: one that launches
// Studio, or one sent while no renderer is listening for link events yet.
const pending: string[] = [];
let started = false;
let listener: WebContents | null = null;

function isReady() {
	return started && !! listener && ! listener.isDestroyed();
}

function flush() {
	if ( isReady() ) {
		pending.splice( 0 ).forEach( ( url ) => void handleDeeplink( url ) );
	}
}

export function openDeeplink( url: string ) {
	if ( isReady() ) {
		void handleDeeplink( url );
		return;
	}
	pending.push( url );
	if ( started ) {
		// The window was closed (macOS keeps Studio running); its new renderer flushes the link.
		void getMainWindow();
	}
}

export function markStudioStarted() {
	started = true;
	flush();
}

export function markDeeplinkListener( webContents: WebContents ) {
	listener = webContents;
	flush();
}
