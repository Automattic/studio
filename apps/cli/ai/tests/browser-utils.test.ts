import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChromiumLaunchAttempts, ensurePlaywrightChromiumInstalled } from '../browser-utils';

describe( 'browser-utils', () => {
	beforeEach( () => {
		vi.unstubAllEnvs();
	} );

	afterEach( () => {
		vi.unstubAllEnvs();
	} );

	it( 'prefers the resolved Chromium executable when it exists', () => {
		const executablePath = process.execPath;

		const options = buildChromiumLaunchAttempts( {
			executablePath: () => executablePath,
		} )[ 0 ];

		expect( options ).toEqual( {
			args: [ '--ignore-certificate-errors' ],
			executablePath,
		} );
	} );

	it( 'always includes a default Playwright launch fallback', () => {
		const candidates = buildChromiumLaunchAttempts( {
			executablePath: () => '/missing/chromium',
		} );

		expect( candidates.at( -1 ) ).toEqual( {
			args: [ '--ignore-certificate-errors' ],
		} );
	} );

	it( 'can resolve another local browser when Playwright executable is unavailable', () => {
		const options = buildChromiumLaunchAttempts( {
			executablePath: () => '/missing/chromium',
		} )[ 0 ];

		expect( options?.args ).toEqual( [ '--ignore-certificate-errors' ] );
	} );

	it( 'prefers an explicit MCP browser executable path override', () => {
		vi.stubEnv( 'STUDIO_MCP_BROWSER_EXECUTABLE_PATH', process.execPath );

		const options = buildChromiumLaunchAttempts( {
			executablePath: () => '/missing/chromium',
		} )[ 0 ];

		expect( options ).toEqual( {
			args: [ '--ignore-certificate-errors' ],
			executablePath: process.execPath,
		} );
	} );

	it( 'includes configured channels as fallbacks for external environments', () => {
		vi.stubEnv( 'STUDIO_MCP_BROWSER_CHANNEL', 'chrome' );

		const options = buildChromiumLaunchAttempts( {
			executablePath: () => '/missing/chromium',
		} );

		expect( options ).toContainEqual( {
			args: [ '--ignore-certificate-errors' ],
			channel: 'chrome',
		} );
	} );

	it( 'tries to install Playwright Chromium when the managed browser is missing', async () => {
		const installBrowser = vi.fn().mockResolvedValue( undefined );
		let installed = false;

		const error = await ensurePlaywrightChromiumInstalled(
			{
				executablePath: () => ( installed ? process.execPath : '/missing/chromium' ),
			},
			{},
			async () => {
				installed = true;
				await installBrowser();
			}
		);

		expect( error ).toBeNull();
		expect( installBrowser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'returns a helpful error when auto-install fails', async () => {
		const error = await ensurePlaywrightChromiumInstalled(
			{
				executablePath: () => '/missing/chromium',
			},
			{},
			async () => {
				throw new Error( 'network unavailable' );
			}
		);

		expect( error ).toContain( 'auto-install Playwright Chromium' );
		expect( error ).toContain( 'network unavailable' );
	} );

	it( 'skips Playwright auto-install when an explicit browser override is configured', async () => {
		vi.stubEnv( 'STUDIO_MCP_BROWSER_CHANNEL', 'chrome' );
		const installBrowser = vi.fn().mockResolvedValue( undefined );

		const error = await ensurePlaywrightChromiumInstalled(
			{
				executablePath: () => '/missing/chromium',
			},
			{
				configuredChannel: 'chrome',
			},
			installBrowser
		);

		expect( error ).toBeNull();
		expect( installBrowser ).not.toHaveBeenCalled();
	} );
} );
