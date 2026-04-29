/**
 * Shared browser management for AI tools.
 *
 * Provides a lazily-launched Playwright Chromium singleton used by both the
 * screenshot tool and the block validator.  A future Electron BrowserWindow
 * backend could be added behind the same interface.
 */

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import type { ConsoleMessage, Request, Response } from 'playwright';

type Browser = Awaited< ReturnType< ( typeof import('playwright') )[ 'chromium' ][ 'launch' ] > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;
type Chromium = Awaited< typeof import('playwright') >[ 'chromium' ];
type ChromiumLaunchOptions = Parameters< Chromium[ 'launch' ] >[ 0 ];
type InstallBrowserFn = () => Promise< void >;

const DEFAULT_BROWSER_ARGS = [ '--ignore-certificate-errors' ];
const EDITOR_READY_TIMEOUT_MS = 30_000;
const MAX_ARTIFACT_EVENTS = 200;

interface EditorDocumentState {
	url: string;
	title: string;
	readyState: string;
	hasWp: boolean;
	bodyClass: string;
}

interface EditorLoadResponse {
	url(): string;
	status(): number;
	statusText(): string;
}

class EditorLoadFailure extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'EditorLoadFailure';
	}
}

function pushLimited< T >( items: T[], item: T ): void {
	items.push( item );
	if ( items.length > MAX_ARTIFACT_EVENTS ) {
		items.shift();
	}
}

function serializeError( error: unknown ): { name?: string; message: string; stack?: string } {
	if ( error instanceof Error ) {
		return {
			name: error.name,
			message: error.message,
			...( error.stack ? { stack: error.stack } : {} ),
		};
	}
	return { message: String( error ) };
}

export class ValidationArtifacts {
	readonly directory: string;

	private readonly startedAt = new Date().toISOString();
	private readonly consoleMessages: unknown[] = [];
	private readonly pageErrors: unknown[] = [];
	private readonly requestFailures: unknown[] = [];
	private readonly errorResponses: unknown[] = [];
	private attachedPage: Page | null = null;
	private tracingStarted = false;
	private tracingStopped = false;
	private consoleHandler?: ( message: ConsoleMessage ) => void;
	private pageErrorHandler?: ( error: Error ) => void;
	private requestFailedHandler?: ( request: Request ) => void;
	private responseHandler?: ( response: Response ) => void;

	private constructor( directory: string ) {
		this.directory = directory;
	}

	static async create( input: {
		siteUrl: string;
		content: string;
		source: string;
	} ): Promise< ValidationArtifacts > {
		const directory = path.join(
			os.tmpdir(),
			'studio-validate-blocks',
			`${ Date.now() }-${ process.pid }-${ randomUUID().slice( 0, 8 ) }`
		);
		await mkdir( directory, { recursive: true } );
		await writeFile( path.join( directory, 'input.html' ), input.content );
		await writeFile(
			path.join( directory, 'input-metadata.json' ),
			JSON.stringify(
				{
					siteUrl: input.siteUrl,
					source: input.source,
					startedAt: new Date().toISOString(),
					contentLength: input.content.length,
				},
				null,
				2
			)
		);
		return new ValidationArtifacts( directory );
	}

	async attachPage( page: Page ): Promise< void > {
		if ( this.attachedPage === page ) {
			return;
		}
		this.detachPage();
		this.attachedPage = page;

		this.consoleHandler = ( message ) => {
			pushLimited( this.consoleMessages, {
				type: message.type(),
				text: message.text(),
				location: message.location(),
				timestamp: new Date().toISOString(),
			} );
		};
		this.pageErrorHandler = ( error ) => {
			pushLimited( this.pageErrors, {
				...serializeError( error ),
				timestamp: new Date().toISOString(),
			} );
		};
		this.requestFailedHandler = ( request ) => {
			pushLimited( this.requestFailures, {
				url: request.url(),
				method: request.method(),
				resourceType: request.resourceType(),
				failure: request.failure(),
				timestamp: new Date().toISOString(),
			} );
		};
		this.responseHandler = ( response ) => {
			const status = response.status();
			if ( status < 400 ) {
				return;
			}
			pushLimited( this.errorResponses, {
				url: response.url(),
				status,
				statusText: response.statusText(),
				requestMethod: response.request().method(),
				requestResourceType: response.request().resourceType(),
				timestamp: new Date().toISOString(),
			} );
		};

		page.on( 'console', this.consoleHandler );
		page.on( 'pageerror', this.pageErrorHandler );
		page.on( 'requestfailed', this.requestFailedHandler );
		page.on( 'response', this.responseHandler );

		try {
			await page.context().tracing.start( {
				screenshots: true,
				snapshots: true,
				sources: true,
			} );
			this.tracingStarted = true;
		} catch ( error ) {
			pushLimited( this.pageErrors, {
				message: `Could not start Playwright tracing: ${ serializeError( error ).message }`,
				timestamp: new Date().toISOString(),
			} );
		}
	}

	async discard(): Promise< void > {
		await this.stopTracing().catch( () => {} );
		this.detachPage();
		await rm( this.directory, { recursive: true, force: true } );
	}

	async captureFailure(
		page: Page | null,
		error: unknown,
		details: Record< string, unknown > = {}
	): Promise< string > {
		await mkdir( this.directory, { recursive: true } );

		if ( page && ! page.isClosed() ) {
			await this.writePageArtifacts( page );
		}
		await this.stopTracing( path.join( this.directory, 'trace.zip' ) ).catch(
			async ( traceError ) => {
				await writeFile(
					path.join( this.directory, 'trace-error.txt' ),
					serializeError( traceError ).message
				).catch( () => {} );
			}
		);

		await writeFile(
			path.join( this.directory, 'metadata.json' ),
			JSON.stringify(
				{
					startedAt: this.startedAt,
					failedAt: new Date().toISOString(),
					error: serializeError( error ),
					details,
					consoleMessages: this.consoleMessages,
					pageErrors: this.pageErrors,
					requestFailures: this.requestFailures,
					errorResponses: this.errorResponses,
				},
				null,
				2
			)
		).catch( () => {} );

		this.detachPage();
		return this.directory;
	}

	private async writePageArtifacts( page: Page ): Promise< void > {
		await page
			.screenshot( { path: path.join( this.directory, 'screenshot.png' ), fullPage: true } )
			.catch( async ( error ) => {
				await writeFile(
					path.join( this.directory, 'screenshot-error.txt' ),
					serializeError( error ).message
				).catch( () => {} );
			} );

		await page
			.content()
			.then( ( content ) => writeFile( path.join( this.directory, 'page.html' ), content ) )
			.catch( async ( error ) => {
				await writeFile(
					path.join( this.directory, 'page-html-error.txt' ),
					serializeError( error ).message
				).catch( () => {} );
			} );

		await page
			.evaluate( () => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const wp = ( window as any ).wp;
				return {
					url: window.location.href,
					title: document.title,
					readyState: document.readyState,
					bodyClass: document.body?.className ?? '',
					bodyText: document.body?.innerText?.slice( 0, 2000 ) ?? '',
					hasWp: typeof wp !== 'undefined',
					hasWpBlocks: !! wp?.blocks,
					hasGetBlockTypes: typeof wp?.blocks?.getBlockTypes === 'function',
					blockTypeCount: wp?.blocks?.getBlockTypes?.()?.length ?? 0,
					scripts: Array.from( document.scripts ).map( ( script ) => ( {
						src: script.src,
						type: script.type,
						async: script.async,
						defer: script.defer,
					} ) ),
					resources: performance
						.getEntriesByType( 'resource' )
						.filter(
							( entry ) =>
								entry.name.includes( '/wp-admin/' ) ||
								entry.name.includes( '/wp-includes/' ) ||
								entry.name.includes( 'load-scripts.php' ) ||
								entry.name.includes( 'load-styles.php' )
						)
						.map( ( entry ) => ( {
							name: entry.name,
							initiatorType: ( entry as PerformanceResourceTiming ).initiatorType,
							duration: entry.duration,
							startTime: entry.startTime,
							transferSize: ( entry as PerformanceResourceTiming ).transferSize,
							encodedBodySize: ( entry as PerformanceResourceTiming ).encodedBodySize,
							decodedBodySize: ( entry as PerformanceResourceTiming ).decodedBodySize,
						} ) ),
				};
			} )
			.then( ( state ) =>
				writeFile(
					path.join( this.directory, 'page-state.json' ),
					JSON.stringify( state, null, 2 )
				)
			)
			.catch( async ( error ) => {
				await writeFile(
					path.join( this.directory, 'page-state-error.txt' ),
					serializeError( error ).message
				).catch( () => {} );
			} );
	}

	private async stopTracing( tracePath?: string ): Promise< void > {
		if ( ! this.tracingStarted || this.tracingStopped || ! this.attachedPage ) {
			return;
		}
		this.tracingStopped = true;
		await this.attachedPage.context().tracing.stop( tracePath ? { path: tracePath } : undefined );
	}

	private detachPage(): void {
		if ( ! this.attachedPage ) {
			return;
		}
		if ( this.consoleHandler ) {
			this.attachedPage.off( 'console', this.consoleHandler );
		}
		if ( this.pageErrorHandler ) {
			this.attachedPage.off( 'pageerror', this.pageErrorHandler );
		}
		if ( this.requestFailedHandler ) {
			this.attachedPage.off( 'requestfailed', this.requestFailedHandler );
		}
		if ( this.responseHandler ) {
			this.attachedPage.off( 'response', this.responseHandler );
		}
		this.attachedPage = null;
	}
}

let browserPromise: Promise< Browser > | null = null;
const execFileAsync = promisify( execFile );

export function buildChromiumLaunchAttempts(
	chromium: Pick< Chromium, 'executablePath' >
): ChromiumLaunchOptions[] {
	const attempts: ChromiumLaunchOptions[] = [];
	const executablePath = chromium.executablePath();

	if ( executablePath && existsSync( executablePath ) ) {
		attempts.push( {
			args: DEFAULT_BROWSER_ARGS,
			executablePath,
		} );
	}

	attempts.push( {
		args: DEFAULT_BROWSER_ARGS,
	} );

	return attempts;
}

async function installPlaywrightChromium(): Promise< void > {
	const packageJsonPath = fileURLToPath( import.meta.resolve( 'playwright/package.json' ) );
	const cliPath = path.join( path.dirname( packageJsonPath ), 'cli.js' );

	await execFileAsync( process.execPath, [ cliPath, 'install', 'chromium' ], {
		env: {
			...process.env,
			CI: process.env.CI ?? '1',
		},
		maxBuffer: 10 * 1024 * 1024,
	} );
}

export async function ensurePlaywrightChromiumInstalled(
	chromium: Pick< Chromium, 'executablePath' >,
	installBrowser: InstallBrowserFn = installPlaywrightChromium
): Promise< string | null > {
	const executablePath = chromium.executablePath();
	if ( existsSync( executablePath ) ) {
		return null;
	}

	try {
		await installBrowser();
	} catch ( error ) {
		return (
			'Studio MCP could not auto-install Playwright Chromium. ' +
			`${ error instanceof Error ? error.message : String( error ) }`
		);
	}

	if ( ! existsSync( chromium.executablePath() ) ) {
		return 'Studio MCP attempted to install Playwright Chromium, but the browser executable is still unavailable.';
	}

	return null;
}

/**
 * Returns (and lazily launches) a shared Chromium browser instance.
 * The browser is cleaned up automatically on process exit.
 */
export async function getSharedBrowser(): Promise< Browser > {
	if ( ! browserPromise ) {
		browserPromise = ( async () => {
			const { chromium } = await import( 'playwright' );
			const launchErrors: string[] = [];
			let browser = await tryLaunchChromium( chromium, launchErrors );
			let installError: string | null = null;

			if ( ! browser ) {
				installError = await ensurePlaywrightChromiumInstalled( chromium );
				if ( ! installError ) {
					browser = await tryLaunchChromium( chromium, launchErrors );
				}
			}

			if ( ! browser ) {
				const repairGuidance =
					installError ??
					'If Playwright Chromium is missing, run `studio mcp` again with network access so Studio can install it automatically.';

				throw new Error(
					'Unable to launch a browser for Studio MCP screenshot/validation tools. ' +
						`Tried ${ launchErrors
							.map( ( error ) => error.split( ': ', 1 )[ 0 ] )
							.join( ', ' ) }. ` +
						`${ repairGuidance } ` +
						`Launch errors: ${ launchErrors.join( ' | ' ) }`
				);
			}

			const cleanup = () => {
				browser.close().catch( () => {} );
				browserPromise = null;
			};
			process.on( 'exit', cleanup );
			process.on( 'SIGINT', cleanup );
			process.on( 'SIGTERM', cleanup );

			return browser;
		} )();
	}
	return browserPromise;
}

/**
 * Close the shared browser instance (if any) so the Node.js event loop can
 * drain and the process can exit naturally without calling process.exit().
 */
export async function closeSharedBrowser(): Promise< void > {
	if ( browserPromise ) {
		const browser = await browserPromise;
		await browser.close().catch( () => {} );
		browserPromise = null;
	}
}

async function tryLaunchChromium(
	chromium: Pick< Chromium, 'launch' | 'executablePath' >,
	launchErrors: string[]
): Promise< Browser | undefined > {
	for ( const attempt of buildChromiumLaunchAttempts( chromium ) ) {
		if ( ! attempt ) {
			continue;
		}
		const attemptedTarget = attempt.executablePath
			? `executablePath=${ attempt.executablePath }`
			: 'playwright-default';

		try {
			return await chromium.launch( attempt );
		} catch ( error ) {
			launchErrors.push(
				`${ attemptedTarget }: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
}

/** Collect diagnostic info from the page to help debug editor load failures. */
async function getPageDiagnostics( page: Page ): Promise< string > {
	try {
		const url = page.url();
		const info = await page.evaluate( () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const wp = ( window as any ).wp;
			return {
				hasWp: typeof wp !== 'undefined',
				hasWpBlocks: !! ( wp && wp.blocks ),
				hasGetBlockTypes: !! ( wp && wp.blocks && typeof wp.blocks.getBlockTypes === 'function' ),
				blockTypeCount: wp?.blocks?.getBlockTypes?.()?.length ?? 0,
				title: document.title,
				bodyClasses: document.body?.className?.slice( 0, 200 ) ?? '',
			};
		} );
		return `url=${ url }, title="${ info.title }", wp=${ info.hasWp }, wp.blocks=${ info.hasWpBlocks }, getBlockTypes=${ info.hasGetBlockTypes }, blockTypes=${ info.blockTypeCount }, body="${ info.bodyClasses }"`;
	} catch ( e ) {
		return `(diagnostics failed: ${ e instanceof Error ? e.message : String( e ) })`;
	}
}

export function getKnownEditorLoadFailureFromDocument( state: EditorDocumentState ): string | null {
	if (
		state.url.includes( '/wp-admin/post-new.php' ) &&
		state.readyState !== 'loading' &&
		! state.hasWp &&
		state.title === '' &&
		state.bodyClass === ''
	) {
		return `WordPress block editor loaded a blank document (${ state.url })`;
	}
	return null;
}

export function getKnownEditorLoadFailureFromResponse(
	response: EditorLoadResponse
): string | null {
	const status = response.status();
	if ( status >= 500 ) {
		return `Block editor request failed (${ status } ${ response.statusText() } ${ response.url() })`;
	}
	return null;
}

async function getEditorDocumentState( page: Page ): Promise< EditorDocumentState > {
	return page.evaluate( () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const wp = ( window as any ).wp;
		return {
			url: window.location.href,
			title: document.title,
			readyState: document.readyState,
			hasWp: typeof wp !== 'undefined',
			bodyClass: document.body?.className ?? '',
		};
	} );
}

function delay( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

async function throwIfKnownEditorDocumentFailure( page: Page ): Promise< void > {
	const documentFailure = getKnownEditorLoadFailureFromDocument(
		await getEditorDocumentState( page )
	);
	if ( documentFailure ) {
		throw new EditorLoadFailure( documentFailure );
	}
}

async function loadAndWaitForEditorReady(
	page: Page,
	loadPage: () => Promise< unknown >
): Promise< void > {
	let rejectKnownFailure: ( error: EditorLoadFailure ) => void = () => {};
	const knownFailure = new Promise< never >( ( _resolve, reject ) => {
		rejectKnownFailure = reject;
	} );

	const onResponse = ( response: Response ) => {
		const responseFailure = getKnownEditorLoadFailureFromResponse( response );
		if ( responseFailure ) {
			rejectKnownFailure( new EditorLoadFailure( responseFailure ) );
		}
	};

	page.on( 'response', onResponse );

	try {
		await Promise.race( [
			( async () => {
				await loadPage();
				await throwIfKnownEditorDocumentFailure( page );

				let stopWatchingDocument = false;
				const watchForBlankDocument = async () => {
					while ( ! stopWatchingDocument ) {
						await delay( 250 );
						try {
							await throwIfKnownEditorDocumentFailure( page );
						} catch ( error ) {
							if ( error instanceof EditorLoadFailure ) {
								throw error;
							}
						}
					}
				};

				// Wait for the block editor scripts to be fully loaded and blocks registered.
				// wp is set early as a global but wp.blocks is populated later, so every
				// level must be checked to avoid "Cannot read properties of undefined".
				try {
					await Promise.race( [
						page.waitForFunction(
							() => {
								try {
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									const wp = ( window as any ).wp;
									return (
										wp &&
										wp.blocks &&
										typeof wp.blocks.getBlockTypes === 'function' &&
										wp.blocks.getBlockTypes().length > 0
									);
								} catch {
									return false;
								}
							},
							{ timeout: EDITOR_READY_TIMEOUT_MS }
						),
						watchForBlankDocument(),
					] );
				} finally {
					stopWatchingDocument = true;
				}
				await page.evaluate( async () => {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const loadBlockEditor = ( window as any )._wpLoadBlockEditor;
					if ( loadBlockEditor?.then ) {
						await loadBlockEditor;
					}
				} );
			} )(),
			knownFailure,
		] );
	} finally {
		page.off( 'response', onResponse );
	}
}

/**
 * A long-lived page that stays open on a site's block editor so repeated
 * validation calls don't have to re-navigate and re-load all block scripts.
 */
export class EditorPage {
	private page: Page | null = null;
	private readonly siteUrl: string;

	constructor( siteUrl: string ) {
		this.siteUrl = siteUrl;
	}

	/** Get or create a page with the block editor loaded. */
	async getPage( artifacts?: ValidationArtifacts ): Promise< Page > {
		if ( this.page && ! this.page.isClosed() ) {
			await artifacts?.attachPage( this.page );
			return this.page;
		}

		const browser = await getSharedBrowser();
		const page = await browser.newPage( {
			ignoreHTTPSErrors: true,
		} );
		await artifacts?.attachPage( page );

		const loginUrl = `${ this.siteUrl }/studio-auto-login?redirect_to=/wp-admin/post-new.php`;

		try {
			try {
				await loadAndWaitForEditorReady( page, () =>
					page.goto( loginUrl, {
						waitUntil: 'domcontentloaded',
						timeout: EDITOR_READY_TIMEOUT_MS,
					} )
				);
			} catch ( error ) {
				if ( ! ( error instanceof EditorLoadFailure ) ) {
					throw error;
				}
				await loadAndWaitForEditorReady( page, () =>
					page.reload( { waitUntil: 'domcontentloaded', timeout: EDITOR_READY_TIMEOUT_MS } )
				);
			}
		} catch ( error ) {
			const diag = await getPageDiagnostics( page );
			await artifacts
				?.captureFailure( page, error, {
					stage: 'load-editor',
					diagnostics: diag,
				} )
				.catch( () => {} );
			await page.close();
			throw new Error(
				`Block editor failed to load (${ diag }): ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}

		this.page = page;
		return page;
	}

	async close(): Promise< void > {
		if ( this.page && ! this.page.isClosed() ) {
			await this.page.close();
		}
		this.page = null;
	}
}
