import type { BrowserHistoryEntry } from '@/features/sites/site-preview/browser-state';

// Electron's `<webview>` is a custom element with non-standard methods. Type
// just the surface we use so this file compiles without an `electron` dep.
export interface WebviewTag extends HTMLElement {
	loadURL( url: string ): Promise< void >;
	executeJavaScript( code: string, userGesture?: boolean ): Promise< unknown >;
	canGoBack?(): boolean;
	canGoForward?(): boolean;
	getWebContentsId?(): number;
	goBack?(): void;
	goForward?(): void;
	reload?(): void;
	isLoading?(): boolean;
}

export interface WebviewConsoleEvent extends Event {
	level: number;
	message: string;
}

export interface WebviewPageTitleUpdatedEvent extends Event {
	title?: string;
}

export interface WebviewFailLoadEvent extends Event {
	errorCode: number;
	isMainFrame: boolean;
}

// Chromium's ERR_ABORTED: a load replaced by another one, not a failure.
export const ERR_ABORTED = -3;

// Best-effort UA sniff: webview is only meaningful inside Electron. Outside
// (e.g. running apps/ui standalone in a regular browser) the tag is inert, so
// we render a plain iframe instead and skip the inspector.
export const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) return false;
	return /\bElectron\//.test( navigator.userAgent );
};

interface PreviewWindow extends Window {
	ipcApi?: {
		clearWebviewCache?: ( webContentsId: number ) => Promise< void >;
		getWebviewNavigationHistory?: ( webContentsId: number ) => Promise< {
			activeIndex: number;
			entries: BrowserHistoryEntry[];
		} >;
		goToWebviewNavigationHistoryEntry?: ( webContentsId: number, index: number ) => Promise< void >;
	};
}

export function getPreviewIpc() {
	return ( window as PreviewWindow ).ipcApi;
}

export function getWebviewContentsId( webview: WebviewTag ): number {
	const webContentsId = webview.getWebContentsId?.();
	if ( ! webContentsId ) {
		throw new Error( 'Preview webview is not ready.' );
	}
	return webContentsId;
}

// Reloading always drops the HTTP cache: it keeps edited CSS/JS from being
// served stale, and it's the only way to shake a cached 301 (Chrome keeps those
// through every reload variant). When such a redirect has already moved the
// webview onto another origin, reload() would reload *that*, so navigate.
export async function reloadPreview(
	webview: WebviewTag,
	intendedUrl: string,
	currentUrl: string
): Promise< void > {
	const ipcApi = getPreviewIpc();
	try {
		await ipcApi?.clearWebviewCache?.( getWebviewContentsId( webview ) );
	} catch {
		// No IPC bridge, or the webview isn't ready.
	}
	if ( isOffOriginRedirect( currentUrl, intendedUrl ) ) {
		await webview.loadURL( intendedUrl ).catch( () => undefined );
		return;
	}
	webview.reload?.();
}

export function isOffOriginRedirect( settledUrl: string, intendedUrl: string ): boolean {
	try {
		return new URL( settledUrl ).origin !== new URL( intendedUrl ).origin;
	} catch {
		return false;
	}
}

export function safeWebviewBoolean(
	webview: WebviewTag | null,
	method: 'canGoBack' | 'canGoForward'
) {
	try {
		return typeof webview?.[ method ] === 'function' ? Boolean( webview[ method ]() ) : false;
	} catch {
		return false;
	}
}

export function safeWebviewIsLoading( webview: WebviewTag | null, fallback: boolean ) {
	try {
		return typeof webview?.isLoading === 'function' ? webview.isLoading() : fallback;
	} catch {
		return fallback;
	}
}
