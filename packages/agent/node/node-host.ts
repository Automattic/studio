import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
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
	pathToFileURL: ( file ) => pathToFileURL( file ).href,
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
	remove: ( file ) => rm( file, { recursive: true, force: true } ),
};

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_TIMEOUT_MS = 2500;

const playwrightPages: HostPages = {
	async open( target, options = {} ) {
		const browser = await getSharedBrowser();
		const page = await browser.newPage( {
			viewport: options.viewport,
			deviceScaleFactor: options.deviceScaleFactor,
			ignoreHTTPSErrors: true,
		} );
		let documentFile: string | undefined;
		try {
			if ( options.reducedMotion || options.colorScheme ) {
				await page.emulateMedia( {
					...( options.reducedMotion ? { reducedMotion: 'reduce' as const } : {} ),
					...( options.colorScheme ? { colorScheme: options.colorScheme } : {} ),
				} );
			}
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
				await page
					.waitForLoadState( 'networkidle', { timeout: PAGE_SETTLE_TIMEOUT_MS } )
					.catch( () => {} );
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
				url: () => page.url(),
				status: () => status,
				isClosed: () => page.isClosed(),
				close: async () => {
					await page.close();
					if ( documentFile ) {
						await rm( path.dirname( documentFile ), { recursive: true, force: true } );
					}
				},
			} as HostPage;
			return hostPage;
		} catch ( error ) {
			await page.close().catch( () => {} );
			if ( documentFile ) {
				await unlink( documentFile ).catch( () => {} );
			}
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
