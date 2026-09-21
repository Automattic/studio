import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildChromiumLaunchAttempts,
	EditorPage,
	ensurePlaywrightChromiumInstalled,
} from '../browser-utils';

vi.mock( 'playwright', () => ( {
	chromium: { launch: vi.fn(), executablePath: () => process.execPath },
} ) );

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

	it( 'loads the block editor once for concurrent validations', async () => {
		const page = { goto: vi.fn(), waitForFunction: vi.fn(), isClosed: () => false };
		const newPage = vi.fn().mockResolvedValue( page );
		vi.mocked( chromium.launch ).mockResolvedValue( { newPage, close: vi.fn() } as never );

		const editor = new EditorPage( 'http://localhost:8881' );
		const pages = await Promise.all( [ editor.getPage(), editor.getPage(), editor.getPage() ] );

		expect( pages ).toEqual( [ page, page, page ] );
		expect( newPage ).toHaveBeenCalledTimes( 1 );
	} );
} );
