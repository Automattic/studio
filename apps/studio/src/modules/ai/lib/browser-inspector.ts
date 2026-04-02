import { BrowserWindow } from 'electron';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { SiteServer } from 'src/site-server';

export interface ConsoleMessage {
	level: 'log' | 'warning' | 'error' | 'info' | 'debug';
	message: string;
	source: string;
	line: number;
	timestamp: number;
}

const CONSOLE_BUFFER_SIZE = 100;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SWEEP_INTERVAL_MS = 60 * 1000; // 1 minute
const NAVIGATION_TIMEOUT_MS = 15_000;
const RENDER_SETTLE_MS = 500;

const CONSOLE_LEVELS = [ 'log', 'warning', 'error', 'info', 'debug' ] as const;

/**
 * Manages hidden BrowserWindows for AI agent site inspection.
 * Provides screenshot, DOM reading, and console capture capabilities.
 */
class BrowserInspector {
	private static instance: BrowserInspector;
	private windows = new Map< string, BrowserWindow >();
	private consoleLogs = new Map< string, ConsoleMessage[] >();
	private currentUrls = new Map< string, string >();
	private lastUsed = new Map< string, number >();
	private operationQueues = new Map< string, Promise< unknown > >();
	private sweepTimer: ReturnType< typeof setInterval > | null = null;

	static getInstance(): BrowserInspector {
		if ( ! BrowserInspector.instance ) {
			BrowserInspector.instance = new BrowserInspector();
		}
		return BrowserInspector.instance;
	}

	private constructor() {
		this.sweepTimer = setInterval( () => this.sweepIdle(), SWEEP_INTERVAL_MS );
	}

	private sweepIdle() {
		const now = Date.now();
		for ( const [ siteId, lastUsedTime ] of this.lastUsed ) {
			if ( now - lastUsedTime > IDLE_TIMEOUT_MS ) {
				this.destroy( siteId );
			}
		}
	}

	private touch( siteId: string ) {
		this.lastUsed.set( siteId, Date.now() );
	}

	private async enqueue< T >( siteId: string, fn: () => Promise< T > ): Promise< T > {
		const prev = this.operationQueues.get( siteId ) ?? Promise.resolve();
		const next = prev.then( fn, fn );
		this.operationQueues.set( siteId, next );
		return next;
	}

	private getSiteUrl( siteId: string ): string {
		const server = SiteServer.get( siteId );
		if ( ! server || ! server.details.running ) {
			throw new Error( 'Site is not running.' );
		}
		return server.details.url;
	}

	private isUrlForSite( url: string, siteUrl: string ): boolean {
		try {
			const target = new URL( url, siteUrl );
			const site = new URL( siteUrl );
			return target.hostname === site.hostname && target.port === site.port;
		} catch {
			return false;
		}
	}

	private buildAutoLoginUrl( siteUrl: string, targetUrl: string ): string {
		const loginUrl = new URL( '/studio-auto-login', siteUrl );
		loginUrl.searchParams.append( 'redirect_to', targetUrl );
		return loginUrl.toString();
	}

	private async getOrCreate( siteId: string ): Promise< BrowserWindow > {
		const existing = this.windows.get( siteId );
		if ( existing && ! existing.isDestroyed() ) {
			return existing;
		}

		// Clean up stale entry
		if ( existing ) {
			this.windows.delete( siteId );
		}

		const win = new BrowserWindow( {
			show: false,
			width: 1280,
			height: 800,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			},
		} );

		// Capture console messages
		win.webContents.on( 'console-message', ( _event, level, message, line, sourceId ) => {
			const buffer = this.consoleLogs.get( siteId ) ?? [];
			buffer.push( {
				level: CONSOLE_LEVELS[ level ] ?? 'log',
				message,
				source: sourceId,
				line,
				timestamp: Date.now(),
			} );
			if ( buffer.length > CONSOLE_BUFFER_SIZE ) {
				buffer.shift();
			}
			this.consoleLogs.set( siteId, buffer );
		} );

		// Track current URL
		win.webContents.on( 'did-navigate', ( _event, url ) => {
			this.currentUrls.set( siteId, url );
		} );
		win.webContents.on( 'did-navigate-in-page', ( _event, url ) => {
			this.currentUrls.set( siteId, url );
		} );

		this.windows.set( siteId, win );
		this.consoleLogs.set( siteId, [] );

		// Navigate to site homepage via auto-login
		const siteUrl = this.getSiteUrl( siteId );
		const autoLoginUrl = this.buildAutoLoginUrl( siteUrl, siteUrl );
		await this.loadWithTimeout( win, autoLoginUrl );

		return win;
	}

	private async loadWithTimeout( win: BrowserWindow, url: string ): Promise< void > {
		return new Promise< void >( ( resolve, reject ) => {
			const timer = setTimeout( () => {
				reject( new Error( `Navigation timed out after ${ NAVIGATION_TIMEOUT_MS / 1000 }s` ) );
			}, NAVIGATION_TIMEOUT_MS );

			const onFinish = () => {
				clearTimeout( timer );
				win.webContents.removeListener( 'did-fail-load', onFail );
				resolve();
			};
			const onFail = ( _event: Electron.Event, errorCode: number, errorDescription: string ) => {
				clearTimeout( timer );
				win.webContents.removeListener( 'did-finish-load', onFinish );
				reject( new Error( `Navigation failed: ${ errorDescription } (code ${ errorCode })` ) );
			};

			win.webContents.once( 'did-finish-load', onFinish );
			win.webContents.once( 'did-fail-load', onFail );
			win.loadURL( url ).catch( reject );
		} );
	}

	async navigate( siteId: string, url: string ): Promise< string > {
		this.touch( siteId );
		return this.enqueue( siteId, async () => {
			const siteUrl = this.getSiteUrl( siteId );

			// Resolve relative paths against site URL
			let absoluteUrl = url;
			if ( url.startsWith( '/' ) ) {
				absoluteUrl = new URL( url, siteUrl ).toString();
			}

			if ( ! this.isUrlForSite( absoluteUrl, siteUrl ) ) {
				throw new Error(
					`URL "${ absoluteUrl }" is not on this site. Only same-origin navigation is allowed.`
				);
			}

			const win = await this.getOrCreate( siteId );
			const autoLoginUrl = this.buildAutoLoginUrl( siteUrl, absoluteUrl );
			await this.loadWithTimeout( win, autoLoginUrl );

			const finalUrl = this.currentUrls.get( siteId ) ?? absoluteUrl;

			// Sync the visible preview iframe
			await sendIpcEventToRenderer( 'browser-navigate', { siteId, url: absoluteUrl } );

			return finalUrl;
		} );
	}

	async reload( siteId: string ): Promise< void > {
		this.touch( siteId );
		return this.enqueue( siteId, async () => {
			const win = this.windows.get( siteId );
			if ( ! win || win.isDestroyed() ) {
				throw new Error( 'No browser window open for this site. Use browser_navigate first.' );
			}

			await new Promise< void >( ( resolve ) => {
				win.webContents.once( 'did-finish-load', () => resolve() );
				win.webContents.reload();
			} );

			const currentUrl = this.currentUrls.get( siteId );
			if ( currentUrl ) {
				await sendIpcEventToRenderer( 'browser-navigate', { siteId, url: currentUrl } );
			}
		} );
	}

	async screenshot( siteId: string ): Promise< { data: string; mimeType: string } > {
		this.touch( siteId );
		return this.enqueue( siteId, async () => {
			const win = await this.getOrCreate( siteId );

			// Brief delay for pending renders to settle
			await new Promise( ( resolve ) => setTimeout( resolve, RENDER_SETTLE_MS ) );

			const nativeImage = await win.webContents.capturePage();
			const pngBuffer = nativeImage.toPNG();
			return {
				data: pngBuffer.toString( 'base64' ),
				mimeType: 'image/png',
			};
		} );
	}

	async getPageContent( siteId: string ): Promise< string > {
		this.touch( siteId );
		return this.enqueue( siteId, async () => {
			const win = await this.getOrCreate( siteId );
			const content = await win.webContents.executeJavaScript( `
				( () => {
					const title = document.title;
					const url = document.URL;
					let text = ( document.body?.innerText ?? '' ).substring( 0, 50000 );

					// Build a simplified DOM outline: headings, links, forms, buttons
					const outline = [];
					const els = document.querySelectorAll( 'h1, h2, h3, h4, h5, h6, a[href], form, button, input[type="submit"]' );
					for ( const el of els ) {
						const tag = el.tagName.toLowerCase();
						const label = ( el.textContent ?? '' ).trim().substring( 0, 100 );
						if ( tag.startsWith( 'h' ) ) {
							outline.push( tag.toUpperCase() + ': ' + label );
						} else if ( tag === 'a' ) {
							outline.push( 'Link: ' + label + ' -> ' + el.getAttribute( 'href' ) );
						} else if ( tag === 'form' ) {
							outline.push( 'Form: action=' + ( el.getAttribute( 'action' ) ?? '' ) + ' method=' + ( el.getAttribute( 'method' ) ?? 'get' ) );
						} else if ( tag === 'button' || el.getAttribute( 'type' ) === 'submit' ) {
							outline.push( 'Button: ' + label );
						}
					}

					return JSON.stringify( { title, url, text, outline } );
				} )()
			` );

			const parsed = JSON.parse( content );
			const parts = [
				`Title: ${ parsed.title }`,
				`URL: ${ parsed.url }`,
				'',
				'--- Page Content ---',
				parsed.text,
			];

			if ( parsed.outline.length > 0 ) {
				parts.push( '', '--- Page Structure ---', ...parsed.outline );
			}

			return parts.join( '\n' );
		} );
	}

	getConsoleMessages( siteId: string ): ConsoleMessage[] {
		this.touch( siteId );
		return this.consoleLogs.get( siteId ) ?? [];
	}

	clearConsoleMessages( siteId: string ): void {
		this.consoleLogs.set( siteId, [] );
	}

	getCurrentUrl( siteId: string ): string | undefined {
		return this.currentUrls.get( siteId );
	}

	destroy( siteId: string ): void {
		const win = this.windows.get( siteId );
		if ( win && ! win.isDestroyed() ) {
			win.close();
		}
		this.windows.delete( siteId );
		this.consoleLogs.delete( siteId );
		this.currentUrls.delete( siteId );
		this.lastUsed.delete( siteId );
		this.operationQueues.delete( siteId );
	}

	destroyAll(): void {
		for ( const siteId of this.windows.keys() ) {
			this.destroy( siteId );
		}
		if ( this.sweepTimer ) {
			clearInterval( this.sweepTimer );
			this.sweepTimer = null;
		}
	}
}

export { BrowserInspector };
