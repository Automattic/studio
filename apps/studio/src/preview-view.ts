/**
 * Wraps an Electron `WebContentsView` that hosts a Studio site preview.
 *
 * Replaces the iframe renderer preview with a native overlay attached to the
 * main window's `contentView`; the renderer positions it by reporting the
 * bounds of a placeholder `<div>` via IPC.
 *
 * Inspector events emitted by `apps/studio/src/preview-preload.ts` flow
 * through `ipcMain` and are forwarded to the host renderer keyed by view id.
 */

import { randomUUID } from 'crypto';
import { BrowserWindow, WebContentsView } from 'electron';
import * as path from 'path';
import { INSPECTOR_PAGE_SCRIPT } from 'src/preview-inspector-script';

export interface PreviewViewBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PreviewViewOptions {
	siteId: string;
	url: string;
	allowedOrigins: string[];
	bounds: PreviewViewBounds;
	ownerWebContentsId: number;
	enableInspector?: boolean;
	// Native view corner radius in CSS pixels. WebContentsView paints over
	// HTML and ignores parent CSS clipping; pass the same radius the React
	// container uses so the preview's corners match its frame.
	borderRadius?: number;
}

type InspectorEvent = {
	type: 'done';
	annotations?: unknown[];
};

const previewViews = new Map< string, PreviewView >();
const previewWebContentsIds = new Set< number >();
const previewViewIdsByWebContentsId = new Map< number, string >();

/**
 * The app installs a global `will-navigate` handler in `index.ts` that
 * `preventDefault`s anything outside the renderer's origin. The site
 * preview is supposed to load Studio site URLs, so its `webContents` opts
 * into a site-specific policy via this set and `isPreviewNavigationAllowed`.
 */
export function isPreviewWebContents( id: number ): boolean {
	return previewWebContentsIds.has( id );
}

export class PreviewView {
	public readonly id: string;
	public readonly ownerWebContentsId: number;
	public readonly siteId: string;
	private readonly window: BrowserWindow;
	private readonly view: WebContentsView;
	private readonly allowedOrigins: Set< string >;
	private readonly enableInspector: boolean;
	private destroyed = false;

	constructor( window: BrowserWindow, options: PreviewViewOptions ) {
		this.id = randomUUID();
		this.ownerWebContentsId = options.ownerWebContentsId;
		this.siteId = options.siteId;
		this.window = window;
		this.allowedOrigins = new Set( options.allowedOrigins );
		this.enableInspector = options.enableInspector ?? false;

		this.view = new WebContentsView( {
			webPreferences: {
				preload: path.resolve( __dirname, '../preload/preview-preload.js' ),
				contextIsolation: true,
				nodeIntegration: false,
			},
		} );

		previewWebContentsIds.add( this.view.webContents.id );
		previewViewIdsByWebContentsId.set( this.view.webContents.id, this.id );

		window.contentView.addChildView( this.view );
		this.view.setBounds( roundBounds( options.bounds ) );
		if ( typeof options.borderRadius === 'number' ) {
			this.view.setBorderRadius( Math.max( 0, Math.round( options.borderRadius ) ) );
		}

		// Re-inject the inspector after every successful navigation so the
		// toolbar survives in-page link clicks and full reloads.
		this.view.webContents.on( 'did-finish-load', () => {
			this.injectInspector();
		} );

		// Forward inspector events to the host renderer (apps/ui). The
		// `viewId` lets the host route to the matching `SitePreview` instance.
		this.view.webContents.ipc.on( 'studio-inspector:event', ( _event, payload: unknown ) => {
			if ( this.destroyed || this.window.isDestroyed() ) return;
			if ( ! isInspectorEvent( payload ) ) return;
			this.window.webContents.send( 'preview-view:event', {
				viewId: this.id,
				payload,
			} );
		} );

		void this.view.webContents.loadURL( options.url ).catch( () => undefined );
	}

	private injectInspector(): void {
		if ( this.destroyed || ! this.enableInspector ) return;
		if ( ! this.isAllowedURL( this.view.webContents.getURL() ) ) return;
		this.view.webContents.executeJavaScript( INSPECTOR_PAGE_SCRIPT, false ).catch( () => {
			// Transient injection failures (e.g. frame swapped mid-eval)
			// are recoverable on the next did-finish-load.
		} );
	}

	setBounds( bounds: PreviewViewBounds ): void {
		if ( this.destroyed ) return;
		this.view.setBounds( roundBounds( bounds ) );
	}

	async loadURL( url: string ): Promise< void > {
		if ( this.destroyed ) return;
		if ( ! this.isAllowedURL( url ) ) {
			throw new Error( 'Preview navigation blocked: URL is outside the site preview origin.' );
		}
		await this.view.webContents.loadURL( url ).catch( () => undefined );
	}

	isAllowedURL( url: string ): boolean {
		try {
			const parsed = new URL( url );
			return (
				[ 'http:', 'https:' ].includes( parsed.protocol ) &&
				this.allowedOrigins.has( parsed.origin )
			);
		} catch {
			return false;
		}
	}

	destroy(): void {
		if ( this.destroyed ) return;
		this.destroyed = true;
		previewWebContentsIds.delete( this.view.webContents.id );
		previewViewIdsByWebContentsId.delete( this.view.webContents.id );
		try {
			this.window.contentView.removeChildView( this.view );
		} catch {
			// Window may already be destroyed.
		}
		const wc = this.view.webContents as { close?: () => void; isDestroyed: () => boolean };
		if ( ! wc.isDestroyed() && typeof wc.close === 'function' ) {
			wc.close();
		}
	}
}

function isInspectorEvent( payload: unknown ): payload is InspectorEvent {
	if ( ! payload || typeof payload !== 'object' ) return false;
	const event = payload as InspectorEvent;
	if ( event.type !== 'done' ) return false;
	if ( event.annotations !== undefined && ! Array.isArray( event.annotations ) ) return false;
	return true;
}

// Bounds passed to `setBounds` must be integers; sub-pixel values produce
// blurry compositing edges and Electron will reject them on some platforms.
function roundBounds( bounds: PreviewViewBounds ): PreviewViewBounds {
	return {
		x: Math.round( bounds.x ),
		y: Math.round( bounds.y ),
		width: Math.max( 0, Math.round( bounds.width ) ),
		height: Math.max( 0, Math.round( bounds.height ) ),
	};
}

export function registerPreviewView( view: PreviewView ): void {
	previewViews.set( view.id, view );
}

export function getPreviewView(
	viewId: string,
	ownerWebContentsId?: number
): PreviewView | undefined {
	const view = previewViews.get( viewId );
	if ( ! view ) return undefined;
	if ( ownerWebContentsId !== undefined && view.ownerWebContentsId !== ownerWebContentsId ) {
		return undefined;
	}
	return view;
}

export function isPreviewNavigationAllowed( webContentsId: number, url: string ): boolean {
	const viewId = previewViewIdsByWebContentsId.get( webContentsId );
	if ( ! viewId ) return false;
	return previewViews.get( viewId )?.isAllowedURL( url ) ?? false;
}

export async function loadPreviewWebContentsURL(
	webContentsId: number,
	url: string
): Promise< boolean > {
	const viewId = previewViewIdsByWebContentsId.get( webContentsId );
	if ( ! viewId ) return false;
	const view = previewViews.get( viewId );
	if ( ! view || ! view.isAllowedURL( url ) ) return false;
	await view.loadURL( url );
	return true;
}

export function disposePreviewViewsForOwner( ownerWebContentsId: number ): void {
	for ( const [ viewId, view ] of previewViews ) {
		if ( view.ownerWebContentsId === ownerWebContentsId ) {
			view.destroy();
			previewViews.delete( viewId );
		}
	}
}

export function disposePreviewView( viewId: string ): void {
	const view = previewViews.get( viewId );
	if ( ! view ) return;
	view.destroy();
	previewViews.delete( viewId );
}
