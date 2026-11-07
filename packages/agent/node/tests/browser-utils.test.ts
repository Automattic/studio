import { execFile } from 'child_process';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildChromiumLaunchAttempts,
	EditorPage,
	ensurePlaywrightChromiumInstalled,
	withTimeout,
} from '@studio/agent/node/browser-utils';

vi.mock( 'playwright', () => ( {
	chromium: { launch: vi.fn(), executablePath: vi.fn() },
} ) );

vi.mock( 'child_process', () => ( { execFile: vi.fn() } ) );

describe( 'browser-utils', () => {
	beforeEach( () => {
		vi.resetModules();
		vi.resetAllMocks();
		vi.mocked( chromium.executablePath ).mockReturnValue( process.execPath );
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
			timeout: 30_000,
		} );
	} );

	it( 'always includes a default Playwright launch fallback', () => {
		const candidates = buildChromiumLaunchAttempts( {
			executablePath: () => '/missing/chromium',
		} );

		expect( candidates.at( -1 ) ).toEqual( {
			args: [ '--ignore-certificate-errors' ],
			timeout: 30_000,
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

	it( 'uses installed Chrome without downloading Chromium', async () => {
		const browser = { close: vi.fn() };
		const { launchChromiumWithInstall } = await import( '@studio/agent/node/browser-utils' );
		vi.mocked( chromium.executablePath ).mockReturnValue( '/missing/chromium' );
		const launch = vi.mocked( chromium.launch ).mockImplementation( async ( options ) => {
			if ( options?.channel === 'chrome' ) {
				return browser as never;
			}
			throw new Error( 'browser missing' );
		} );

		await expect( launchChromiumWithInstall() ).resolves.toBe( browser );
		expect( launch ).toHaveBeenCalledWith(
			expect.objectContaining( { channel: 'chrome', timeout: 30_000 } )
		);
		expect( execFile ).not.toHaveBeenCalled();
	} );

	it( 'returns promptly during a single background install and launches after it finishes', async () => {
		const { launchChromiumWithInstall } = await import( '@studio/agent/node/browser-utils' );
		let finishInstall!: () => void;
		let installed = false;
		const browser = { close: vi.fn() };
		const launch = vi.mocked( chromium.launch ).mockImplementation( async () => {
			if ( installed ) {
				return browser as never;
			}
			throw new Error( 'browser missing' );
		} );
		vi.mocked( chromium.executablePath ).mockImplementation( () =>
			installed ? process.execPath : '/missing/chromium'
		);
		vi.mocked( execFile ).mockImplementation( ( _file, _args, _options, callback ) => {
			finishInstall = () => {
				installed = true;
				callback!( null, '', '' );
			};
			return {} as never;
		} );

		try {
			await expect( withTimeout( launchChromiumWithInstall(), 200, 'Test call' ) ).rejects.toThrow(
				'Studio is downloading the browser'
			);
			await Promise.all(
				[ 1, 2 ].map( () =>
					expect( withTimeout( launchChromiumWithInstall(), 200, 'Test call' ) ).rejects.toThrow(
						'Studio is downloading the browser'
					)
				)
			);
			await expect( withTimeout( launchChromiumWithInstall(), 200, 'Test call' ) ).rejects.toThrow(
				'Try again in a minute'
			);
			expect( execFile ).toHaveBeenCalledTimes( 1 );
			expect( execFile ).toHaveBeenCalledWith(
				process.execPath,
				[ expect.stringMatching( /cli\.js$/ ), 'install', 'chromium' ],
				expect.objectContaining( { timeout: 15 * 60_000 } ),
				expect.any( Function )
			);
			for ( const [ options ] of launch.mock.calls ) {
				expect( options ).toEqual( expect.objectContaining( { timeout: 30_000 } ) );
			}
		} finally {
			finishInstall();
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
		await expect( launchChromiumWithInstall() ).resolves.toBe( browser );
		expect( execFile ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'loads the block editor once for concurrent validations', async () => {
		const page = {
			on: vi.fn(),
			goto: vi.fn(),
			waitForLoadState: vi.fn(),
			url: () => 'http://localhost:8881/wp-admin/post-new.php',
			waitForFunction: vi.fn(),
			isClosed: () => false,
		};
		const newPage = vi.fn().mockResolvedValue( page );
		vi.mocked( chromium.launch ).mockResolvedValue( {
			newPage,
			close: vi.fn().mockResolvedValue( undefined ),
		} as never );

		const editor = new EditorPage( 'http://localhost:8881' );
		const pages = await Promise.all( [ editor.getPage(), editor.getPage(), editor.getPage() ] );

		expect( pages ).toEqual( [ page, page, page ] );
		expect( newPage ).toHaveBeenCalledTimes( 1 );
	} );
} );
