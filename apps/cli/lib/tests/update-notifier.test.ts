/* eslint-disable no-control-regex */
import { type MockInstance, vi } from 'vitest';
import { readCliConfig } from 'cli/lib/cli-config/core';
import {
	formatUpdateBanner,
	setupUpdateNotifier,
	standaloneUpdateCommand,
} from 'cli/lib/update-notifier';

// Stub the config writer so standalone checks don't touch disk / the lockfile.
vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('cli/lib/cli-config/core') >();
	return {
		...actual,
		updateCliConfigWithPartial: vi.fn().mockResolvedValue( undefined ),
		// Reject so the update check finds no cache and exercises the crash-safe path
		// (a failed config read must never throw out of the notifier).
		readCliConfig: vi.fn().mockRejectedValue( new Error( 'no config in test' ) ),
	};
} );

const stripAnsi = ( str: string ) => str.replace( /\u001B\[[0-9;]*m/g, '' );

describe( 'formatUpdateBanner', () => {
	it( 'should include version numbers', () => {
		const plain = stripAnsi( formatUpdateBanner( '1.7.8', '1.8.0', 'npm update -g wp-studio' ) );
		expect( plain ).toContain( '1.7.8' );
		expect( plain ).toContain( '1.8.0' );
	} );

	it( 'should include the changelog URL', () => {
		const plain = stripAnsi( formatUpdateBanner( '1.7.8', '1.8.0', 'npm update -g wp-studio' ) );
		expect( plain ).toContain(
			'https://developer.wordpress.com/docs/developer-tools/studio/changelog/'
		);
	} );

	it( 'should render the npm update command when given it', () => {
		const plain = stripAnsi( formatUpdateBanner( '1.7.8', '1.8.0', 'npm update -g wp-studio' ) );
		expect( plain ).toContain( 'npm update -g wp-studio' );
	} );

	it( 'should use a custom update command when provided', () => {
		const plain = stripAnsi(
			formatUpdateBanner(
				'1.7.8',
				'1.8.0',
				'curl -fsSL https://wordpress.studio/install.sh | bash'
			)
		);
		expect( plain ).toContain( 'curl -fsSL https://wordpress.studio/install.sh | bash' );
		expect( plain ).not.toContain( 'npm update -g wp-studio' );
	} );

	it( 'should be wrapped in a box', () => {
		const plain = stripAnsi( formatUpdateBanner( '1.0.0', '2.0.0', 'npm update -g wp-studio' ) );
		expect( plain ).toContain( '╭' );
		expect( plain ).toContain( '╰' );
		expect( plain ).toContain( '│' );
	} );
} );

describe( 'standaloneUpdateCommand', () => {
	it( 'uses the bare installer for a production version (macOS/Linux)', () => {
		expect( standaloneUpdateCommand( '1.11.0', 'darwin' ) ).toBe(
			'curl -fsSL https://wordpress.studio/install.sh | bash'
		);
		expect( standaloneUpdateCommand( '1.11.0', 'linux' ) ).toBe(
			'curl -fsSL https://wordpress.studio/install.sh | bash'
		);
	} );

	it( 'pins the nightly channel for a dev version', () => {
		expect( standaloneUpdateCommand( '1.12.0-dev81', 'linux' ) ).toBe(
			'curl -fsSL https://wordpress.studio/install.sh | STUDIO_CLI_VERSION=nightly bash'
		);
	} );

	it( 'pins the beta channel for a beta version', () => {
		expect( standaloneUpdateCommand( '2.0.0-beta1', 'darwin' ) ).toBe(
			'curl -fsSL https://wordpress.studio/install.sh | STUDIO_CLI_VERSION=beta bash'
		);
	} );

	it( 'uses the PowerShell installer on Windows', () => {
		expect( standaloneUpdateCommand( '1.11.0', 'win32' ) ).toBe(
			'irm https://wordpress.studio/install.ps1 | iex'
		);
		expect( standaloneUpdateCommand( '1.12.0-dev81', 'win32' ) ).toBe(
			"$env:STUDIO_CLI_VERSION='nightly'; irm https://wordpress.studio/install.ps1 | iex"
		);
	} );
} );

describe( 'setupUpdateNotifier', () => {
	const originalSend = process.send;
	const originalArgv = process.argv;
	let stderrWriteSpy: MockInstance;

	beforeEach( () => {
		process.send = undefined;
		stderrWriteSpy = vi.spyOn( process.stderr, 'write' ).mockImplementation( () => true );
	} );

	afterEach( () => {
		process.send = originalSend;
		process.argv = originalArgv;
		vi.unstubAllGlobals();
		stderrWriteSpy.mockRestore();
		vi.clearAllMocks();
	} );

	it( 'should not show a banner in IPC mode', async () => {
		process.send = vi.fn();
		const fetchMock = vi.fn();
		vi.stubGlobal( 'fetch', fetchMock );
		await setupUpdateNotifier( '1.0.0', 'standalone' );
		expect( fetchMock ).not.toHaveBeenCalled();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
	} );

	it( 'should not show a banner when --json is passed', async () => {
		process.argv = [ ...originalArgv, '--json' ];
		const fetchMock = vi.fn();
		vi.stubGlobal( 'fetch', fetchMock );
		await setupUpdateNotifier( '1.0.0', 'standalone' );
		expect( fetchMock ).not.toHaveBeenCalled();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
	} );

	it( 'should not show a banner for an embedded build', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal( 'fetch', fetchMock );
		await setupUpdateNotifier( '1.0.0', 'embedded' );
		expect( fetchMock ).not.toHaveBeenCalled();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
	} );

	describe( 'standalone', () => {
		const originalPlatform = process.platform;

		// The banner's install command is OS-specific (curl on unix, irm on Windows), so pin
		// the platform — otherwise these assertions are non-deterministic across the CI matrix
		// (they failed on the Windows runner).
		beforeEach( () => {
			Object.defineProperty( process, 'platform', { value: 'linux', configurable: true } );
		} );

		afterEach( () => {
			Object.defineProperty( process, 'platform', {
				value: originalPlatform,
				configurable: true,
			} );
		} );

		it( 'shows a curl-install banner when the endpoint reports a newer version', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue( {
					ok: true,
					status: 200,
					json: async () => ( { version: '2.0.0' } ),
				} )
			);

			await setupUpdateNotifier( '1.0.0', 'standalone' );

			expect( stderrWriteSpy ).toHaveBeenCalled();
			const output = stripAnsi(
				stderrWriteSpy.mock.calls.map( ( call ) => String( call[ 0 ] ) ).join( '' )
			);
			expect( output ).toContain( '2.0.0' );
			expect( output ).toContain( 'curl -fsSL https://wordpress.studio/install.sh | bash' );
			expect( output ).not.toContain( 'npm update -g wp-studio' );
		} );

		it( 'queries the Studio CLI product with the running platform and version', async () => {
			const fetchMock = vi.fn().mockResolvedValue( {
				ok: true,
				status: 200,
				json: async () => ( { version: '2.0.0' } ),
			} );
			vi.stubGlobal( 'fetch', fetchMock );

			await setupUpdateNotifier( '1.2.3', 'standalone' );

			const requestedUrl = new URL( String( fetchMock.mock.calls[ 0 ]?.[ 0 ] ) );
			expect( requestedUrl.origin + requestedUrl.pathname ).toBe(
				'https://public-api.wordpress.com/wpcom/v2/studio-app/updates'
			);
			expect( requestedUrl.searchParams.get( 'product' ) ).toBe( 'wordpress-com-studio-cli' );
			expect( requestedUrl.searchParams.get( 'version' ) ).toBe( '1.2.3' );
			expect( requestedUrl.searchParams.get( 'platform' ) ).toBe( process.platform );
			expect( requestedUrl.searchParams.get( 'studioArch' ) ).toBe( process.arch );
		} );

		it( 'shows no banner when the endpoint replies 204 (up to date)', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue( {
					ok: true,
					status: 204,
					json: async () => ( {} ),
				} )
			);

			await setupUpdateNotifier( '1.0.0', 'standalone' );

			expect( stderrWriteSpy ).not.toHaveBeenCalled();
		} );

		it( 'shows no banner and does not throw on network failure', async () => {
			vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'network down' ) ) );

			await expect( setupUpdateNotifier( '1.0.0', 'standalone' ) ).resolves.toBeUndefined();
			expect( stderrWriteSpy ).not.toHaveBeenCalled();
		} );

		it( 'refetches instead of trusting a fresh cache from a different channel', async () => {
			// Nightly cache left in the shared ~/.studio by a prior install; the running CLI is
			// production. The stale 1.12.0-dev131 must not be offered — we refetch (server: 204).
			vi.mocked( readCliConfig ).mockResolvedValueOnce( {
				standaloneUpdateCheck: { lastChecked: Date.now(), latestVersion: '1.12.0-dev131' },
			} as never );
			const fetchMock = vi.fn().mockResolvedValue( {
				ok: true,
				status: 204,
				json: async () => ( {} ),
			} );
			vi.stubGlobal( 'fetch', fetchMock );

			await setupUpdateNotifier( '1.11.0', 'standalone' );

			expect( fetchMock ).toHaveBeenCalled();
			expect( stderrWriteSpy ).not.toHaveBeenCalled();
		} );

		it( 'trusts a fresh same-channel cache without re-fetching', async () => {
			vi.mocked( readCliConfig ).mockResolvedValueOnce( {
				standaloneUpdateCheck: { lastChecked: Date.now(), latestVersion: '1.13.0' },
			} as never );
			const fetchMock = vi.fn();
			vi.stubGlobal( 'fetch', fetchMock );

			await setupUpdateNotifier( '1.11.0', 'standalone' );

			expect( fetchMock ).not.toHaveBeenCalled();
			const output = stripAnsi(
				stderrWriteSpy.mock.calls.map( ( call ) => String( call[ 0 ] ) ).join( '' )
			);
			expect( output ).toContain( '1.13.0' );
		} );
	} );
} );
