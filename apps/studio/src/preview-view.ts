/**
 * Wraps an Electron `WebContentsView` that hosts a Studio site preview.
 *
 * Replaces the deprecated `<webview>` tag in the renderer. The view is a
 * native overlay attached to the main window's `contentView`; the renderer
 * positions it by reporting the bounds of a placeholder `<div>` via IPC.
 *
 * Inspector events emitted by `apps/studio/src/preview-preload.ts` flow
 * through `ipcMain` and are forwarded to the host renderer keyed by view id.
 */

import { randomUUID } from 'crypto';
import { BrowserWindow, WebContentsView } from 'electron';
import * as path from 'path';

export interface PreviewViewBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PreviewViewOptions {
	url: string;
	bounds: PreviewViewBounds;
	// JS source executed in the guest page after every successful navigation.
	// Used to mount the annotate inspector inside the WordPress page.
	inspectorScript?: string;
	// Native view corner radius in CSS pixels. WebContentsView paints over
	// HTML and ignores parent CSS clipping; pass the same radius the React
	// container uses so the preview's corners match its frame.
	borderRadius?: number;
}

const previewViews = new Map< string, PreviewView >();
const previewWebContentsIds = new Set< number >();

/**
 * The app installs a global `will-navigate` handler in `index.ts` that
 * `preventDefault`s anything outside the renderer's origin. The site
 * preview is supposed to load arbitrary WordPress URLs, so its
 * `webContents` opts out of the policy via this set — the global handler
 * checks `isPreviewWebContents` and bails early for matching ids.
 */
export function isPreviewWebContents( id: number ): boolean {
	return previewWebContentsIds.has( id );
}

export class PreviewView {
	public readonly id: string;
	private readonly window: BrowserWindow;
	private readonly view: WebContentsView;
	private inspectorScript?: string;
	private destroyed = false;

	constructor( window: BrowserWindow, options: PreviewViewOptions ) {
		this.id = randomUUID();
		this.window = window;
		this.inspectorScript = options.inspectorScript;

		this.view = new WebContentsView( {
			webPreferences: {
				preload: path.resolve( __dirname, '../preload/preview-preload.js' ),
				contextIsolation: true,
				nodeIntegration: false,
			},
		} );

		previewWebContentsIds.add( this.view.webContents.id );

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
			this.window.webContents.send( 'preview-view:event', {
				viewId: this.id,
				payload,
			} );
		} );

		void this.view.webContents.loadURL( options.url ).catch( () => undefined );
	}

	private injectInspector(): void {
		if ( this.destroyed || ! this.inspectorScript ) return;
		this.view.webContents.executeJavaScript( this.inspectorScript, false ).catch( () => {
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
		await this.view.webContents.loadURL( url ).catch( () => undefined );
	}

	sendInspectorCommand( command: unknown ): void {
		if ( this.destroyed || this.view.webContents.isDestroyed() ) return;
		this.view.webContents.send( 'studio-inspector:command', command );
	}

	destroy(): void {
		if ( this.destroyed ) return;
		this.destroyed = true;
		previewWebContentsIds.delete( this.view.webContents.id );
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

export function getPreviewView( viewId: string ): PreviewView | undefined {
	return previewViews.get( viewId );
}

export function disposePreviewView( viewId: string ): void {
	const view = previewViews.get( viewId );
	if ( ! view ) return;
	view.destroy();
	previewViews.delete( viewId );
}
