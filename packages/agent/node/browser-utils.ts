/**
 * Shared browser management for AI tools.
 *
 * Provides a lazily-launched Playwright Chromium singleton used by both the
 * screenshot tool and the block validator.  A future Electron BrowserWindow
 * backend could be added behind the same interface.
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

type Browser = Awaited< ReturnType< ( typeof import('playwright') )[ 'chromium' ][ 'launch' ] > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;
type Chromium = Awaited< typeof import('playwright') >[ 'chromium' ];
type ChromiumLaunchOptions = Parameters< Chromium[ 'launch' ] >[ 0 ];
type InstallBrowserFn = () => Promise< void >;

const DEFAULT_BROWSER_ARGS = [ '--ignore-certificate-errors' ];
const BROWSER_LAUNCH_TIMEOUT_MS = 30_000;
const BROWSER_INSTALL_TIMEOUT_MS = 15 * 60_000;

let install: { promise: Promise< void >; startedAt: number } | null = null;
let lastInstallError: string | null = null;

export async function withTimeout< T >(
	promise: Promise< T >,
	ms: number,
	label: string
): Promise< T > {
	let timer: ReturnType< typeof setTimeout > | undefined;
	try {
		return await Promise.race( [
			promise,
			new Promise< never >( ( _, reject ) => {
				timer = setTimeout(
					() => reject( new Error( `${ label } timed out after ${ ms / 1000 }s` ) ),
					ms
				);
			} ),
		] );
	} finally {
		clearTimeout( timer );
	}
}

function downloadingError(): Error {
	const seconds = Math.floor( ( Date.now() - ( install?.startedAt ?? Date.now() ) ) / 1000 );
	return new Error(
		`Studio is downloading the browser that block validation and screenshots need (started ${ seconds }s ago). Try again in a minute.`
	);
}

let browserPromise: Promise< Browser > | null = null;
const execFileAsync = promisify( execFile );

export function buildChromiumLaunchAttempts(
	chromium: Pick< Chromium, 'executablePath' >,
	overrides: ChromiumLaunchOptions = {}
): ChromiumLaunchOptions[] {
	const attempts: ChromiumLaunchOptions[] = [];
	const executablePath = chromium.executablePath();
	const base: ChromiumLaunchOptions = {
		args: DEFAULT_BROWSER_ARGS,
		...overrides,
		timeout: BROWSER_LAUNCH_TIMEOUT_MS,
	};

	if ( executablePath && existsSync( executablePath ) ) {
		attempts.push( { ...base, executablePath } );
	} else {
		attempts.push( { ...base, channel: 'chrome' }, { ...base, channel: 'msedge' } );
	}

	attempts.push( { ...base } );

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
		timeout: BROWSER_INSTALL_TIMEOUT_MS,
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
 * Launch a Chromium browser, starting a background install of managed Chromium
 * if it is missing. Accepts launch `overrides` (e.g. `headless: false` and custom
 * `args`) so callers that need their own window configuration still get the
 * executable-path fallback and on-demand install behaviour. Throws a
 * diagnostic error if no browser can be launched.
 */
export async function launchChromiumWithInstall(
	overrides: ChromiumLaunchOptions = {},
	{
		toolContext = 'Studio MCP screenshot/validation tools',
		chromium,
		installBrowser,
	}: {
		toolContext?: string;
		chromium?: Pick< Chromium, 'launch' | 'executablePath' >;
		installBrowser?: InstallBrowserFn;
	} = {}
): Promise< Browser > {
	if ( install ) {
		throw downloadingError();
	}
	chromium ??= ( await import( 'playwright' ) ).chromium;
	const launchErrors: string[] = [];
	const browser = await tryLaunchChromium( chromium, launchErrors, overrides );
	if ( browser ) {
		return browser;
	}

	if ( ! existsSync( chromium.executablePath() ) ) {
		const previousFailure = lastInstallError;
		if ( ! install ) {
			lastInstallError = null;
			install = {
				startedAt: Date.now(),
				promise: ensurePlaywrightChromiumInstalled( chromium, installBrowser )
					.then( ( error ) => {
						lastInstallError = error;
					} )
					.finally( () => {
						install = null;
					} ),
			};
		}
		throw previousFailure ? new Error( previousFailure ) : downloadingError();
	}

	throw new Error(
		`Unable to launch a browser for ${ toolContext }. ` +
			`Tried ${ launchErrors.map( ( error ) => error.split( ': ', 1 )[ 0 ] ).join( ', ' ) }. ` +
			'If Playwright Chromium is missing, run `studio mcp` again with network access so Studio can install it automatically. ' +
			`Launch errors: ${ launchErrors.join( ' | ' ) }`
	);
}

/**
 * Returns (and lazily launches) a shared Chromium browser instance.
 * The browser is cleaned up automatically on process exit.
 */
export async function getSharedBrowser(): Promise< Browser > {
	if ( ! browserPromise ) {
		browserPromise = ( async () => {
			const browser = await launchChromiumWithInstall();

			const cleanup = () => {
				browser.close().catch( () => {} );
				browserPromise = null;
			};
			process.on( 'exit', cleanup );
			process.on( 'SIGINT', cleanup );
			process.on( 'SIGTERM', cleanup );

			return browser;
		} )().catch( ( error ) => {
			browserPromise = null;
			throw error;
		} );
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
	launchErrors: string[],
	overrides: ChromiumLaunchOptions = {}
): Promise< Browser | undefined > {
	for ( const attempt of buildChromiumLaunchAttempts( chromium, overrides ) ) {
		if ( ! attempt ) {
			continue;
		}
		const attemptedTarget = attempt.executablePath
			? `executablePath=${ attempt.executablePath }`
			: attempt.channel
			? `channel=${ attempt.channel }`
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

/**
 * A long-lived page that stays open on a site's block editor so repeated
 * validation calls don't have to re-navigate and re-load all block scripts.
 */
export class EditorPage {
	private page: Page | null = null;
	private loading: Promise< Page > | null = null;
	private readonly siteUrl: string;

	constructor( siteUrl: string ) {
		this.siteUrl = siteUrl;
	}

	/** Get or create a page with the block editor loaded. */
	async getPage(): Promise< Page > {
		if ( this.page && ! this.page.isClosed() ) {
			return this.page;
		}
		// Concurrent auto-logins overwrite each other's session tokens, so share one load.
		this.loading ??= this.load().finally( () => ( this.loading = null ) );
		return this.loading;
	}

	private async load(): Promise< Page > {
		const browser = await getSharedBrowser();
		const page = await browser.newPage( {
			ignoreHTTPSErrors: true,
		} );

		const loginUrl = `${ this.siteUrl }/studio-auto-login?redirect_to=/wp-admin/post-new.php`;
		await page.goto( loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 } );

		// Wait for the block editor scripts to be fully loaded and blocks registered.
		// wp is set early as a global but wp.blocks is populated later, so every
		// level must be checked to avoid "Cannot read properties of undefined".
		try {
			await page.waitForFunction(
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
				{ timeout: 30_000 }
			);
		} catch ( error ) {
			const diag = await getPageDiagnostics( page );
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
