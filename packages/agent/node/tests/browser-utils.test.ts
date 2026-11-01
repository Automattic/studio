import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildChromiumLaunchAttempts,
	EditorPage,
	ensurePlaywrightChromiumInstalled,
	launchChromiumWithInstall,
	withTimeout,
} from '@studio/agent/node/browser-utils';

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
		const launch = vi.fn().mockImplementation( async ( options ) => {
			if ( options.channel === 'chrome' ) {
				return browser;
			}
			throw new Error( 'browser missing' );
		} );
		const installBrowser = vi.fn();

		await expect(
			launchChromiumWithInstall( {}, undefined, {
				chromium: { executablePath: () => '/missing/chromium', launch },
				installBrowser,
			} )
		).resolves.toBe( browser );
		expect( installBrowser ).not.toHaveBeenCalled();
	} );

	it( 'returns promptly during a single background install and launches after it finishes', async () => {
		let finishInstall!: () => void;
		let installed = false;
		const browser = { close: vi.fn() };
		const launch = vi.fn().mockImplementation( async () => {
			if ( installed ) {
				return browser;
			}
			throw new Error( 'browser missing' );
		} );
		const installBrowser = vi.fn(
			() =>
				new Promise< void >( ( resolve ) => {
					finishInstall = () => {
						installed = true;
						resolve();
					};
				} )
		);
		const dependencies = {
			chromium: {
				executablePath: () => ( installed ? process.execPath : '/missing/chromium' ),
				launch,
			},
			installBrowser,
		};

		try {
			await Promise.all(
				[ 1, 2 ].map( () =>
					expect(
						withTimeout(
							launchChromiumWithInstall( {}, undefined, dependencies ),
							200,
							'Test call'
						)
					).rejects.toThrow( 'Studio is downloading the browser' )
				)
			);
			await expect( launchChromiumWithInstall( {}, undefined, dependencies ) ).rejects.toThrow(
				'Try again in a minute'
			);
			expect( installBrowser ).toHaveBeenCalledTimes( 1 );
		} finally {
			finishInstall();
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
		await expect( launchChromiumWithInstall( {}, undefined, dependencies ) ).resolves.toBe(
			browser
		);
	} );

	it( 'reports a failed background install and permits one new attempt', async () => {
		let finishRetry!: () => void;
		let installed = false;
		const installBrowser = vi
			.fn()
			.mockRejectedValueOnce( new Error( 'network unavailable' ) )
			.mockImplementation(
				() =>
					new Promise< void >( ( resolve ) => {
						finishRetry = () => {
							installed = true;
							resolve();
						};
					} )
			);
		const dependencies = {
			chromium: {
				executablePath: () => ( installed ? process.execPath : '/missing/chromium' ),
				launch: vi.fn().mockRejectedValue( new Error( 'browser missing' ) ),
			},
			installBrowser,
		};
		await expect( launchChromiumWithInstall( {}, undefined, dependencies ) ).rejects.toThrow(
			'downloading'
		);
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		try {
			await expect( launchChromiumWithInstall( {}, undefined, dependencies ) ).rejects.toThrow(
				'could not auto-install Playwright Chromium. network unavailable'
			);
			await expect( launchChromiumWithInstall( {}, undefined, dependencies ) ).rejects.toThrow(
				'downloading'
			);
			expect( installBrowser ).toHaveBeenCalledTimes( 2 );
		} finally {
			finishRetry();
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );

	it( 'bounds a stalled evaluation with a labelled error', async () => {
		vi.useFakeTimers();
		try {
			const result = expect(
				withTimeout(
					new Promise( () => {} ),
					60_000,
					'Block validation evaluating blocks in the editor'
				)
			).rejects.toThrow( 'Block validation evaluating blocks in the editor timed out after 60s' );
			await vi.advanceTimersByTimeAsync( 60_000 );
			await result;
		} finally {
			vi.useRealTimers();
		}
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
