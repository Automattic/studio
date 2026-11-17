import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getSharedBrowser, openSharedPage } from '@studio/agent/node/browser-utils';
import { annotateInBrowser } from '@studio/agent/node/inspector/inspector-inject';
import type {
	HostFiles,
	HostPage,
	HostPages,
	HostPath,
	StudioAgentHost,
} from '@studio/agent/shared/host';

const nodePath: HostPath = {
	join: path.join,
	resolve: path.resolve,
	relative: path.relative,
	dirname: path.dirname,
	basename: path.basename,
	extname: path.extname,
	isAbsolute: path.isAbsolute,
	sep: path.sep,
	fileURLToPath: ( url ) => fileURLToPath( url ),
};

const nodeFiles: HostFiles = {
	read: async ( file ) => new Uint8Array( await readFile( file ) ),
	readText: ( file ) => readFile( file, 'utf8' ),
	write: async ( file, data ) => {
		await mkdir( path.dirname( file ), { recursive: true } );
		await writeFile( file, data );
	},
	exists: ( file ) =>
		stat( file ).then(
			() => true,
			() => false
		),
	isDirectory: ( file ) =>
		stat( file ).then(
			( stats ) => stats.isDirectory(),
			() => false
		),
	mkdir: async ( directory ) => {
		await mkdir( directory, { recursive: true } );
	},
	list: async ( directory ) =>
		( await readdir( directory, { withFileTypes: true } ) ).map( ( entry ) => ( {
			name: entry.name,
			directory: entry.isDirectory(),
		} ) ),
	walk: async ( directory ) =>
		( await readdir( directory, { recursive: true, withFileTypes: true } ) )
			.filter( ( entry ) => ! entry.isDirectory() )
			.map( ( entry ) =>
				path
					.relative( directory, path.join( entry.parentPath, entry.name ) )
					.split( path.sep )
					.join( '/' )
			),
};

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_TIMEOUT_MS = 2500;

type Page = Awaited< ReturnType< typeof openSharedPage > >;

// The requests a page has open, from before it navigates: what it loads
// without them is all it loads, where waiting for 500ms of no network
// activity ('networkidle') adds that half second to every page.
function trackRequests( page: Page ): () => number {
	const open = new Set< unknown >();
	const done = ( request: unknown ) => open.delete( request );
	page.on( 'request', ( request ) => open.add( request ) );
	page.on( 'requestfinished', done );
	page.on( 'requestfailed', done );
	return () => open.size;
}

// Settled once no request the page made is open across a paint: what it
// loads, and what its scripts fetch as it loads.
async function waitForPageToSettle( page: Page, openRequests: () => number ): Promise< void > {
	const end = Date.now() + PAGE_SETTLE_TIMEOUT_MS;
	const paint = () =>
		page
			.evaluate(
				() =>
					new Promise< void >( ( resolve ) =>
						requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) )
					)
			)
			.catch( () => {} );
	await paint();
	while ( openRequests() > 0 && Date.now() < end ) {
		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		if ( openRequests() === 0 ) {
			await paint();
		}
	}
}

const playwrightPages: HostPages = {
	async open( target, options = {} ) {
		const page = await openSharedPage( {
			viewport: options.viewport,
			deviceScaleFactor: options.deviceScaleFactor,
			ignoreHTTPSErrors: true,
		} );
		let documentFile: string | undefined;
		const close = async () => {
			await page.close();
			if ( documentFile ) {
				await rm( path.dirname( documentFile ), { recursive: true, force: true } );
			}
		};
		try {
			if ( options.reducedMotion || options.colorScheme ) {
				await page.emulateMedia( {
					...( options.reducedMotion ? { reducedMotion: 'reduce' as const } : {} ),
					...( options.colorScheme ? { colorScheme: options.colorScheme } : {} ),
				} );
			}
			const openRequests = trackRequests( page );
			if ( options.initScript ) {
				await page.addInitScript( options.initScript );
			}
			let url: string;
			if ( 'html' in target ) {
				// A file rather than page.setContent, so the document's file: references load.
				documentFile = path.join(
					await mkdtemp( path.join( os.tmpdir(), 'studio-page-' ) ),
					'index.html'
				);
				// The BOM makes the browser read the file as UTF-8 even when the
				// document does not declare a charset.
				await writeFile( documentFile, `\ufeff${ target.html }` );
				url = pathToFileURL( documentFile ).href;
			} else if ( target.signIn ) {
				const { origin, pathname, search } = new URL( target.url );
				url = `${ origin }/studio-auto-login?redirect_to=${ encodeURIComponent(
					pathname + search
				) }`;
			} else {
				url = target.url;
			}
			const response =
				options.waitUntil === 'networkidle'
					? await page.goto( url, { waitUntil: 'networkidle', timeout: PAGE_LOAD_TIMEOUT_MS } )
					: await page.goto( url, {
							waitUntil: 'domcontentloaded',
							timeout: PAGE_LOAD_TIMEOUT_MS,
					  } );
			if ( options.waitUntil !== 'networkidle' ) {
				await waitForPageToSettle( page, openRequests );
			}
			const status = response?.status() ?? 0;
			const hostPage: HostPage = {
				evaluate: ( script: ( arg?: unknown ) => unknown, arg?: unknown ) =>
					page.evaluate( script, arg ),
				waitFor: async ( condition, timeoutMs ) => {
					await page.waitForFunction( condition, undefined, { timeout: timeoutMs } );
				},
				hover: async ( selector ) => {
					if ( selector ) {
						await page.hover( selector, { timeout: 2000 } );
					} else {
						await page.mouse.move( 0, 0 );
					}
				},
				screenshot: async ( { format, quality, fullPage, clip } ) =>
					new Uint8Array(
						await page.screenshot( {
							type: format,
							...( format === 'jpeg' && quality !== undefined ? { quality } : {} ),
							...( fullPage ? { fullPage } : {} ),
							...( clip ? { clip } : {} ),
						} )
					),
				viewportSize: () => page.viewportSize(),
				setViewportSize: ( size ) => page.setViewportSize( size ),
				url: () => page.url(),
				status: () => status,
				html: async () =>
					'html' in target ? undefined : response?.text().catch( () => undefined ),
				isClosed: () => page.isClosed(),
				close,
			} as HostPage;
			return hostPage;
		} catch ( error ) {
			await close().catch( () => {} );
			throw error;
		}
	},
	async fetchText( url ) {
		const browser = await getSharedBrowser();
		const context = await browser.newContext( { ignoreHTTPSErrors: true } );
		try {
			const response = await context.request.get( url, {
				failOnStatusCode: false,
				timeout: 10_000,
			} );
			return { status: response.status(), body: await response.text() };
		} finally {
			await context.close();
		}
	},
};

/**
 * Where the agent's images are saved. The `studio code` command points it at a
 * per-session sidecar directory (`<session>.screenshots/` next to the session
 * JSONL) so images referenced by persisted chat artifacts survive OS temp
 * cleanup and are removed together with the session. Without one, images go to
 * a throwaway temp directory.
 */
async function resolveImageDirectory(
	directory: () => Promise< string | null > | string | null
): Promise< string > {
	try {
		const resolved = await directory();
		if ( resolved ) {
			await mkdir( resolved, { recursive: true } );
			return resolved;
		}
	} catch ( error ) {
		// Fall through to the temp directory so the capture still succeeds, but
		// say so: files there are purged by the OS, so persisted artifacts will
		// eventually show as unavailable and this line is the only clue why.
		console.warn( '[screenshots] falling back to a temporary directory:', error );
	}
	return mkdtemp( path.join( os.tmpdir(), 'studio-screenshot-' ) );
}

/**
 * The parts of a host that Node provides the same way everywhere: the file
 * system, Playwright's Chromium, the annotation browser, and images saved to
 * `imagesDirectory`.
 */
export function nodeHostServices( {
	imagesDirectory = () => null,
}: {
	imagesDirectory?: () => Promise< string | null > | string | null;
} = {} ): Pick< StudioAgentHost, 'path' | 'files' | 'pages' | 'saveImage' | 'annotate' > {
	return {
		path: nodePath,
		files: nodeFiles,
		pages: playwrightPages,
		saveImage: async ( bytes, name ) => {
			const file = path.join( await resolveImageDirectory( imagesDirectory ), name );
			await writeFile( file, bytes );
			return { path: file, url: pathToFileURL( file ).href };
		},
		annotate: annotateInBrowser,
	};
}
