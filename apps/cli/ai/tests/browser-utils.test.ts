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

	it( 'merges launch overrides into every attempt so headed callers keep the install fallback', () => {
		const overrides = {
			headless: false,
			args: [ '--ignore-certificate-errors', '--window-size=1280,800' ],
		};

		const attempts = buildChromiumLaunchAttempts(
			{ executablePath: () => process.execPath },
			overrides
		);

		// Both the resolved-executable attempt and the default fallback must
		// carry the caller's overrides.
		expect( attempts ).toHaveLength( 2 );
		expect( attempts[ 0 ] ).toEqual( {
			headless: false,
			args: [ '--ignore-certificate-errors', '--window-size=1280,800' ],
			executablePath: process.execPath,
		} );
		expect( attempts.at( -1 ) ).toEqual( {
			headless: false,
			args: [ '--ignore-certificate-errors', '--window-size=1280,800' ],
		} );
	} );

	it( 'tries to install Playwright Chromium when the managed browser is missing', async () => {
		const installBrowser = vi.fn().mockResolvedValue( undefined );
		let installed = false;

		const error = await ensurePlaywrightChromiumInstalled(
			{
				executablePath: () => ( installed ? process.execPath : '/missing/chromium' ),
			},
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
			async () => {
				throw new Error( 'network unavailable' );
			}
		);

		expect( error ).toContain( 'auto-install Playwright Chromium' );
		expect( error ).toContain( 'network unavailable' );
	} );

	it( 'still auto-installs Playwright Chromium after a default launch fallback fails', async () => {
		const installBrowser = vi.fn().mockResolvedValue( undefined );
		let installed = false;

		const error = await ensurePlaywrightChromiumInstalled(
			{
				executablePath: () => ( installed ? process.execPath : '/missing/chromium' ),
			},
			async () => {
				installed = true;
				await installBrowser();
			}
		);

		expect( error ).toBeNull();
		expect( installBrowser ).toHaveBeenCalledTimes( 1 );
	} );
} );
