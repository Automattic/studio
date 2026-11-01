/**
 * Drives Studio Desktop, the Electron app, with Playwright's Electron support.
 * Stubs replace main-process IPC handlers, and captures come from Electron's
 * own `capturePage`, which draws the site preview's `<webview>` right.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { guardElectron } from '../guard.ts';
import { REPO_ROOT, cliMain, findStudioApp, platform } from '../locate.ts';
import { readJson } from '../paths.ts';
import type { Box } from '../locators.ts';
import type { LaunchOptions, RemoteTrees, Studio, Stubs } from './types.ts';

// The account's preview-site count and limit: Jurassic Ninja's, or WordPress.com's for
// accounts that create previews there (Automatticians first; `fetchSnapshotUsage` in Studio).
const USAGE = 'https://public-api.wordpress.com/wpcom/v2/jurassic-ninja/usage';
const WPCOM_USAGE = 'https://public-api.wordpress.com/wpcom/v2/wow-funnel/pending';
// The account's AI credits, `STUDIO_ASSISTANT_QUOTA_URL` in the Studio source.
const AI_QUOTA = 'https://public-api.wordpress.com/wpcom/v2/studio-app/ai-assistant/quota';

/**
 * An unpackaged build (`STUDIO_APP_DIR=apps/studio`) runs in a copy of the
 * repo's Electron, for when `npm run package` isn't available (on macOS it
 * needs Xcode). A production build looks for the CLI and a Node binary in the
 * app's resources, so the copy gets links to the CLI and this Node. The copy
 * is cached under the temp directory, per Electron version and link targets.
 */
async function prepareElectron() {
	const electronDir = path.join( REPO_ROOT, 'node_modules/electron' );
	const dist = path.join( electronDir, 'dist' );
	if ( ! existsSync( path.join( electronDir, 'path.txt' ) ) ) {
		throw new Error(
			`Electron not found in ${ dist }. Run \`node node_modules/electron/install.js\` at the repo root (or \`npx studio-capture setup\`).`
		);
	}
	const exe = ( await readFile( path.join( electronDir, 'path.txt' ), 'utf8' ) ).trim();
	const { version } = await readJson< { version: string } >(
		path.join( electronDir, 'package.json' )
	);
	const cli = cliMain();
	const links = createHash( 'sha1' )
		.update( `${ cli }\n${ process.execPath }` )
		.digest( 'hex' )
		.slice( 0, 8 );
	const dir = path.join( tmpdir(), `studio-capture-electron-${ version }-${ links }` );
	const ready = path.join( dir, '.ready' );
	if ( ! existsSync( ready ) ) {
		await rm( dir, { recursive: true, force: true } );
		await cp( dist, dir, { recursive: true, verbatimSymlinks: true } );
		const resources = path.join( dir, platform().resources );
		await mkdir( path.join( resources, 'bin' ), { recursive: true } );
		const node = path.join( resources, 'bin', process.platform === 'win32' ? 'node.exe' : 'node' );
		await ( process.platform === 'win32'
			? cp( process.execPath, node )
			: symlink( process.execPath, node ) );
		await symlink( path.dirname( cli ), path.join( resources, 'cli' ), 'junction' );
		await writeFile( ready, '' );
	}
	return path.join( dir, exe );
}

async function resolveApp(): Promise< { executablePath: string; args: string[] } > {
	const app = findStudioApp();
	if ( ! app ) {
		throw new Error(
			'No Studio app found. Set STUDIO_APP_DIR=apps/studio after building it, set STUDIO_APP, or install Studio (`npx studio-capture doctor` lists what is missing).'
		);
	}
	if ( app.kind === 'dir' ) {
		if ( ! existsSync( path.join( app.path, 'dist/main/index.js' ) ) ) {
			throw new Error(
				`Studio build not found in ${ app.path }/dist. Build it first (\`npx studio-capture setup\`).`
			);
		}
		return { executablePath: await prepareElectron(), args: [ app.path ] };
	}
	if ( ! existsSync( app.path ) ) {
		throw new Error( `Studio app not found at "${ app.path }" (${ app.source }).` );
	}
	return { executablePath: app.path, args: [] };
}

/**
 * Chromium switches for Linux: no sandbox where it can't run (as root, as in
 * most containers), and /tmp for shared memory, which containers keep small.
 */
function linuxArgs() {
	if ( process.platform !== 'linux' ) {
		return [];
	}
	const root = process.getuid?.() === 0;
	return [
		...( root || process.env.STUDIO_CAPTURE_NO_SANDBOX ? [ '--no-sandbox' ] : [] ),
		'--disable-dev-shm-usage',
	];
}

/**
 * On Linux and Windows, Studio shows an app-menu button and leaves room for
 * the system's window buttons, which a virtual display doesn't draw: an
 * empty gap. Captures show the window without either, as the browser app
 * and the Mac app (whose traffic lights `windowControls` draws) look.
 */
const CHROMELESS = `(() => {
	const overlay = navigator.windowControlsOverlay;
	if ( overlay ) {
		Object.defineProperty( overlay, 'visible', { configurable: true, get: () => false } );
		overlay.dispatchEvent?.( new Event( 'geometrychange' ) );
	}
	const hide = () => {
		if ( document.getElementById( 'studio-capture-chromeless' ) ) {
			return;
		}
		const style = document.createElement( 'style' );
		style.id = 'studio-capture-chromeless';
		style.textContent = 'button[aria-label="Menu"]:has(svg.lucide-menu) { display: none !important; }';
		document.head.appendChild( style );
	};
	if ( document.head ) {
		hide();
	} else {
		document.addEventListener( 'DOMContentLoaded', hide );
	}
})()`;

function electronStubs( app: ElectronApplication, window: Page ): Stubs {
	const answer = ( name: string, value: unknown ) =>
		app.evaluate(
			( { ipcMain }, { handler, data } ) => {
				ipcMain.removeHandler( handler );
				ipcMain.handle( handler, () => data );
			},
			{ handler: name, data: value }
		);
	return {
		syncableSites: ( sites ) => answer( 'fetchSyncableWpcomSites', sites ),
		previewSites: ( snapshots ) => answer( 'fetchSnapshots', snapshots ),
		async connectedSites( connected, trees: RemoteTrees, hosting ) {
			await app.evaluate(
				( { ipcMain }, { list, files, info } ) => {
					const handle = ( name: string, handler: Parameters< typeof ipcMain.handle >[ 1 ] ) => {
						ipcMain.removeHandler( name );
						ipcMain.handle( name, handler );
					};
					handle( 'getConnectedWpcomSites', ( _event, localSiteId?: string ) =>
						list.filter( ( site ) => ! localSiteId || site.localSiteId === localSiteId )
					);
					handle( 'getHostingPhpVersion', () => info.phpVersion );
					handle( 'getLatestRewindId', () => info.rewindId );
					handle(
						'listRemoteFileTree',
						( _event, _remoteId: unknown, _rewindId: unknown, dir: string ) => files[ dir ] ?? {}
					);
				},
				{ list: connected, files: trees, info: hosting }
			);
		},
		async agentRuns() {
			await app.evaluate( ( { ipcMain } ) => {
				const state = globalThis as typeof globalThis & {
					captureAgentRun?: { runId: string; sessionId: string };
				};
				ipcMain.removeHandler( 'continueAiSession' );
				ipcMain.handle( 'continueAiSession', ( _event, sessionId: string ) => {
					state.captureAgentRun = { runId: `capture-run-${ Date.now() }`, sessionId };
					return { runId: state.captureAgentRun.runId };
				} );
			} );
		},
		lastAgentRun: () =>
			app.evaluate(
				() =>
					(
						globalThis as typeof globalThis & {
							captureAgentRun?: { runId: string; sessionId: string };
						}
					 ).captureAgentRun
			),
		async sendAgentEvent( payload ) {
			await app.evaluate(
				( { BrowserWindow }, event ) =>
					BrowserWindow.getAllWindows().forEach( ( win ) =>
						win.webContents.send( 'ai-agent-event', event )
					),
				payload
			);
			await window.waitForTimeout( 0 );
		},
	};
}

export async function launchElectron( {
	profile,
	look,
	authToken,
	account,
}: LaunchOptions ): Promise< Studio > {
	const { executablePath, args } = await resolveApp();
	const app = await electron.launch( {
		executablePath,
		args: [
			...args,
			`--user-data-dir=${ profile.dirs.userData }`,
			// Captures are at the look's scale whatever the display is.
			`--force-device-scale-factor=${ look.scale }`,
			...linuxArgs(),
		],
		env: profile.env as Record< string, string >,
		timeout: 60_000,
	} );
	let window: Page;
	try {
		window = await app.firstWindow( { timeout: 60_000 } );
		await app.evaluate( ( { BrowserWindow }, size ) => {
			const win = BrowserWindow.getAllWindows()[ 0 ];
			win?.setContentSize( size.width, size.height );
			win?.center();
		}, look.window );
		await window.waitForLoadState( 'domcontentloaded' );
		if ( process.platform !== 'darwin' ) {
			await app.context().addInitScript( CHROMELESS );
			await window.evaluate( CHROMELESS );
		}
		if ( authToken ) {
			await guardElectron( app );
		}
		const routes: { url: string; json: unknown }[] = [];
		if ( account?.aiQuota ) {
			routes.push( { url: AI_QUOTA, json: account.aiQuota } );
		}
		if ( account?.previewSiteUrls ) {
			const urls = account.previewSiteUrls;
			routes.push(
				{
					url: USAGE,
					json: { site_count: urls.length, site_limit: 10, site_creation_blocked: false },
				},
				{
					url: WPCOM_USAGE,
					json: { preview_sites: urls, preview_site_limit: 10, preview_sites_blocked: false },
				}
			);
		}
		if ( routes.length ) {
			for ( const { url, json } of routes ) {
				await app.context().route( url, ( route ) => route.fulfill( { json } ) );
			}
			// Nothing fetched before the routes were in place is shown.
			await window.reload( { waitUntil: 'domcontentloaded' } );
		}
	} catch ( error ) {
		// Otherwise Electron keeps running, signed in, on a profile about to be removed.
		await app.close().catch( () => {} );
		throw error;
	}

	return {
		driver: 'electron',
		window,
		version: await app.evaluate( ( { app: electronApp } ) => electronApp.getVersion() ),
		stubs: electronStubs( app, window ),
		async screenshot( clip?: Box ) {
			for ( let attempt = 1; ; attempt++ ) {
				try {
					const base64 = await app.evaluate( async ( { BrowserWindow }, rect ) => {
						const image = await BrowserWindow.getAllWindows()[ 0 ].webContents.capturePage( rect );
						return image.toPNG().toString( 'base64' );
					}, clip );
					return Buffer.from( base64, 'base64' );
				} catch ( error ) {
					// The compositor occasionally has no frame to hand out (UnknownVizError).
					if ( attempt >= 5 ) {
						throw error;
					}
					await window.waitForTimeout( 200 );
				}
			}
		},
		async windowButtonPosition() {
			if ( process.platform !== 'darwin' ) {
				return null;
			}
			return app.evaluate( ( { BrowserWindow } ) =>
				BrowserWindow.getAllWindows()[ 0 ].getWindowButtonPosition()
			);
		},
		inPreviews< T >( code: string ) {
			return window.evaluate( async ( source ) => {
				const views = [ ...document.querySelectorAll( 'webview' ) ] as ( HTMLElement & {
					executeJavaScript?: ( js: string ) => Promise< unknown >;
				} )[];
				const out = [];
				for ( const view of views ) {
					// The element is there before it's attached and can run scripts.
					if ( typeof view.executeJavaScript !== 'function' ) {
						continue;
					}
					const box = view.getBoundingClientRect();
					try {
						// Throws, rather than rejects, until the webview's dom-ready.
						const result = await view.executeJavaScript( source );
						out.push( { result, offset: { x: box.x, y: box.y } } );
					} catch {
						// Not ready yet: as if there were no preview.
					}
				}
				return out;
			}, code ) as Promise< { result: T; offset: { x: number; y: number } }[] >;
		},
		async startFrames( { fps, width } ) {
			await app.evaluate(
				( { BrowserWindow }, options ) => {
					const contents = BrowserWindow.getAllWindows()[ 0 ].webContents;
					const recording = {
						frames: [] as { at: number; jpeg: Buffer }[],
						busy: false,
						start: Date.now(),
						timer: undefined as ReturnType< typeof setInterval > | undefined,
					};
					recording.timer = setInterval( async () => {
						if ( recording.busy ) {
							return;
						}
						recording.busy = true;
						try {
							const at = Date.now() - recording.start;
							const image = await contents.capturePage();
							const resized =
								image.getSize().width > options.width
									? image.resize( { width: options.width, quality: 'best' } )
									: image;
							recording.frames.push( { at, jpeg: resized.toJPEG( 90 ) } );
						} catch {
							// The compositor occasionally has no frame to hand out; take the next.
						} finally {
							recording.busy = false;
						}
					}, 1000 / options.fps );
					( globalThis as Record< string, unknown > ).captureRecording = recording;
				},
				{ fps, width }
			);
			return async () => {
				const count = await app.evaluate( async () => {
					const recording = ( globalThis as Record< string, unknown > ).captureRecording as {
						frames: unknown[];
						busy: boolean;
						timer: ReturnType< typeof setInterval >;
					};
					clearInterval( recording.timer );
					while ( recording.busy ) {
						await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );
					}
					return recording.frames.length;
				} );
				const frames: { at: number; jpeg: Buffer }[] = [];
				// Fetched in batches: one evaluate result holds the frames as base64.
				for ( let start = 0; start < count; start += 20 ) {
					const batch = await app.evaluate(
						( _electron, range ) => {
							const recording = ( globalThis as Record< string, unknown > ).captureRecording as {
								frames: { at: number; jpeg: Buffer }[];
							};
							return recording.frames
								.slice( range.start, range.start + 20 )
								.map( ( frame ) => ( { at: frame.at, jpeg: frame.jpeg.toString( 'base64' ) } ) );
						},
						{ start }
					);
					frames.push(
						...batch.map( ( frame ) => ( {
							at: frame.at,
							jpeg: Buffer.from( frame.jpeg, 'base64' ),
						} ) )
					);
				}
				await app.evaluate( () => {
					delete ( globalThis as Record< string, unknown > ).captureRecording;
				} );
				return frames;
			};
		},
		// Quitting Studio stops its daemon when no sites are running.
		close: () => app.close().catch( () => {} ),
	};
}
