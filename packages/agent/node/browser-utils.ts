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
type Chromium = Awaited< typeof import('playwright') >[ 'chromium' ];
type ChromiumLaunchOptions = Parameters< Chromium[ 'launch' ] >[ 0 ];
type InstallBrowserFn = () => Promise< void >;

const DEFAULT_BROWSER_ARGS = [ '--ignore-certificate-errors' ];

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
	};

	if ( executablePath && existsSync( executablePath ) ) {
		attempts.push( { ...base, executablePath } );
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
 * Launch a Chromium browser, auto-installing Playwright's managed Chromium if
 * it is missing. Accepts launch `overrides` (e.g. `headless: false` and custom
 * `args`) so callers that need their own window configuration still get the
 * executable-path fallback and on-demand install behaviour. Throws a
 * diagnostic error if no browser can be launched.
 */
export async function launchChromiumWithInstall(
	overrides: ChromiumLaunchOptions = {},
	toolContext = 'Studio MCP screenshot/validation tools'
): Promise< Browser > {
	const { chromium } = await import( 'playwright' );
	const launchErrors: string[] = [];
	let browser = await tryLaunchChromium( chromium, launchErrors, overrides );
	let installError: string | null = null;

	if ( ! browser ) {
		installError = await ensurePlaywrightChromiumInstalled( chromium );
		if ( ! installError ) {
			browser = await tryLaunchChromium( chromium, launchErrors, overrides );
		}
	}

	if ( ! browser ) {
		const repairGuidance =
			installError ??
			'If Playwright Chromium is missing, run `studio mcp` again with network access so Studio can install it automatically.';

		throw new Error(
			`Unable to launch a browser for ${ toolContext }. ` +
				`Tried ${ launchErrors.map( ( error ) => error.split( ': ', 1 )[ 0 ] ).join( ', ' ) }. ` +
				`${ repairGuidance } ` +
				`Launch errors: ${ launchErrors.join( ' | ' ) }`
		);
	}

	return browser;
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
	launchErrors: string[],
	overrides: ChromiumLaunchOptions = {}
): Promise< Browser | undefined > {
	for ( const attempt of buildChromiumLaunchAttempts( chromium, overrides ) ) {
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
