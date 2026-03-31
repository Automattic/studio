/**
 * Shared browser management for AI tools.
 *
 * Provides a lazily-launched Playwright Chromium singleton used by both the
 * screenshot tool and the block validator.  A future Electron BrowserWindow
 * backend could be added behind the same interface.
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

type Browser = Awaited< ReturnType< ( typeof import('playwright') )[ 'chromium' ][ 'launch' ] > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;
type Chromium = Awaited< typeof import('playwright') >[ 'chromium' ];
type ChromiumLaunchOptions = Parameters< Chromium[ 'launch' ] >[ 0 ];
type InstallBrowserFn = () => Promise< void >;
type SupportedChannel = ( typeof SUPPORTED_CHANNELS )[ number ];
type BrowserOverrides = {
	executablePath?: string;
	configuredChannel?: string;
	channel?: SupportedChannel;
};

const DEFAULT_BROWSER_ARGS = [ '--ignore-certificate-errors' ];
const SUPPORTED_CHANNELS = [
	'chrome',
	'chrome-beta',
	'chrome-dev',
	'msedge',
	'msedge-beta',
	'msedge-dev',
] as const;
const ENV_EXECUTABLE_KEYS = [
	'STUDIO_MCP_BROWSER_EXECUTABLE_PATH',
	'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH',
	'CHROME_EXECUTABLE_PATH',
] as const;
const ENV_CHANNEL_KEYS = [ 'STUDIO_MCP_BROWSER_CHANNEL', 'PLAYWRIGHT_CHROMIUM_CHANNEL' ] as const;

let browserPromise: Promise< Browser > | null = null;
const execFileAsync = promisify( execFile );
const SYSTEM_BROWSER_CANDIDATES_BY_PLATFORM: Record< string, string[] > = {
	darwin: [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
		'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
	],
	linux: [
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/snap/bin/chromium',
		'/usr/bin/microsoft-edge',
		'/usr/bin/brave-browser',
	],
	win32: [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files\\Chromium\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
		'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	],
};

function getFirstEnvValue( keys: readonly string[] ): string | undefined {
	for ( const key of keys ) {
		const value = process.env[ key ]?.trim();
		if ( value ) {
			return value;
		}
	}
}

function getBrowserOverrides(): BrowserOverrides {
	const executablePath = getFirstEnvValue( ENV_EXECUTABLE_KEYS );
	const configuredChannel = getFirstEnvValue( ENV_CHANNEL_KEYS );
	const channel = SUPPORTED_CHANNELS.includes( configuredChannel as SupportedChannel )
		? ( configuredChannel as SupportedChannel )
		: undefined;

	return {
		executablePath,
		configuredChannel,
		channel,
	};
}

function describeLaunchAttempt( attempt: ChromiumLaunchOptions | undefined ): string {
	if ( ! attempt ) {
		return 'undefined';
	}
	if ( attempt.executablePath ) {
		return `executablePath=${ attempt.executablePath }`;
	}
	if ( attempt.channel ) {
		return `channel=${ attempt.channel }`;
	}
	return 'playwright-default';
}

export function buildChromiumLaunchAttempts(
	chromium: Pick< Chromium, 'executablePath' >,
	overrides: BrowserOverrides = getBrowserOverrides()
): ChromiumLaunchOptions[] {
	const attempts: ChromiumLaunchOptions[] = [];
	const seen = new Set< string >();

	const addExecutableAttempt = ( executablePath?: string ) => {
		if ( ! executablePath || ! existsSync( executablePath ) || seen.has( executablePath ) ) {
			return;
		}
		seen.add( executablePath );
		attempts.push( {
			args: DEFAULT_BROWSER_ARGS,
			executablePath,
		} );
	};

	addExecutableAttempt( overrides.executablePath );
	addExecutableAttempt( chromium.executablePath() );

	for ( const executablePath of SYSTEM_BROWSER_CANDIDATES_BY_PLATFORM[ os.platform() ] ?? [] ) {
		addExecutableAttempt( executablePath );
	}

	for ( const channel of [ overrides.channel, ...SUPPORTED_CHANNELS ] ) {
		if ( ! channel || seen.has( channel ) ) {
			continue;
		}
		seen.add( channel );
		attempts.push( {
			args: DEFAULT_BROWSER_ARGS,
			channel,
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
	overrides: BrowserOverrides = getBrowserOverrides(),
	installBrowser: InstallBrowserFn = installPlaywrightChromium
): Promise< string | null > {
	if ( overrides.executablePath || overrides.configuredChannel ) {
		return null;
	}

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
			const overrides = getBrowserOverrides();
			const installError = await ensurePlaywrightChromiumInstalled( chromium, overrides );
			const launchCandidates = buildChromiumLaunchAttempts( chromium, overrides );
			const launchErrors: string[] = [];
			let browser: Browser | undefined;

			for ( const attempt of launchCandidates ) {
				if ( ! attempt ) {
					continue;
				}
				const attemptedTarget = describeLaunchAttempt( attempt );

				try {
					browser = await chromium.launch( attempt );
					break;
				} catch ( error ) {
					launchErrors.push(
						`${ attemptedTarget }: ${ error instanceof Error ? error.message : String( error ) }`
					);
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
						'Set STUDIO_MCP_BROWSER_EXECUTABLE_PATH to a local Chrome/Chromium-compatible browser, ' +
						'or STUDIO_MCP_BROWSER_CHANNEL to a Playwright-supported channel like "chrome". ' +
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
	private readonly siteUrl: string;

	constructor( siteUrl: string ) {
		this.siteUrl = siteUrl;
	}

	/** Get or create a page with the block editor loaded. */
	async getPage(): Promise< Page > {
		if ( this.page && ! this.page.isClosed() ) {
			return this.page;
		}

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
