import { describe, expect, it, vi } from 'vitest';
import {
	findTailscaleCli,
	parseTailscaleStatus,
	readTailscaleState,
	tailscaleEnv,
} from '../tailscale';

// The fields of `tailscale status --json` that remote mode reads, as
// Tailscale prints them (Go field names; `DNSName` ends with a dot).
const RUNNING_WITH_HTTPS = {
	BackendState: 'Running',
	Self: {
		DNSName: 'my-mac.tail1234.ts.net.',
		TailscaleIPs: [ '100.101.102.103', 'fd7a:115c:a1e0::1' ],
		Online: true,
	},
	CertDomains: [ 'my-mac.tail1234.ts.net' ],
	Peer: {},
};

describe( 'findTailscaleCli', () => {
	it( 'finds tailscale on PATH first', () => {
		const exists = vi.fn( ( file: string ) => file === '/opt/homebrew/bin/tailscale' );
		expect(
			findTailscaleCli( {
				platform: 'darwin',
				env: { PATH: '/usr/bin:/opt/homebrew/bin' },
				exists,
			} )
		).toBe( '/opt/homebrew/bin/tailscale' );
	} );

	it( "falls back to the macOS app's bundled CLI", () => {
		expect(
			findTailscaleCli( {
				platform: 'darwin',
				env: { PATH: '/usr/bin' },
				exists: ( file ) => file === '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
			} )
		).toBe( '/Applications/Tailscale.app/Contents/MacOS/Tailscale' );
	} );

	it( 'falls back to the Windows install folder', () => {
		expect(
			findTailscaleCli( {
				platform: 'win32',
				env: { Path: 'C:\\Windows', ProgramFiles: 'D:\\Programs' },
				exists: ( file ) => file === 'D:\\Programs\\Tailscale\\tailscale.exe',
			} )
		).toBe( 'D:\\Programs\\Tailscale\\tailscale.exe' );
	} );

	it( 'finds tailscale.exe on the Windows Path', () => {
		expect(
			findTailscaleCli( {
				platform: 'win32',
				env: { Path: 'C:\\Windows;C:\\Program Files\\Tailscale' },
				exists: ( file ) => file === 'C:\\Program Files\\Tailscale\\tailscale.exe',
			} )
		).toBe( 'C:\\Program Files\\Tailscale\\tailscale.exe' );
	} );

	it( 'returns undefined on Linux when tailscale is not on PATH', () => {
		expect(
			findTailscaleCli( { platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false } )
		).toBeUndefined();
	} );
} );

describe( 'tailscaleEnv', () => {
	it( 'tells the macOS app binary to act as the CLI', () => {
		expect( tailscaleEnv( { HOME: '/Users/someone' } ) ).toEqual( {
			HOME: '/Users/someone',
			TAILSCALE_BE_CLI: '1',
		} );
	} );
} );

describe( 'parseTailscaleStatus', () => {
	it( 'reads a running computer with HTTPS certificates', () => {
		expect( parseTailscaleStatus( RUNNING_WITH_HTTPS ) ).toEqual( {
			installed: true,
			running: true,
			ipv4: '100.101.102.103',
			dnsName: 'my-mac.tail1234.ts.net',
			httpsReady: true,
		} );
	} );

	it( 'is not ready for HTTPS when the tailnet gives no certificate for this name', () => {
		expect( parseTailscaleStatus( { ...RUNNING_WITH_HTTPS, CertDomains: null } ) ).toMatchObject( {
			running: true,
			httpsReady: false,
		} );
	} );

	it( 'reads a signed-out computer as not running', () => {
		expect( parseTailscaleStatus( { BackendState: 'NeedsLogin', Self: { DNSName: '' } } ) ).toEqual(
			{
				installed: true,
				running: false,
				ipv4: undefined,
				dnsName: undefined,
				httpsReady: false,
			}
		);
	} );

	it( 'reads an unexpected shape as not running', () => {
		expect( parseTailscaleStatus( { BackendState: 42 } ) ).toEqual( {
			installed: true,
			running: false,
			httpsReady: false,
		} );
		expect( parseTailscaleStatus( 'not json' ) ).toMatchObject( { running: false } );
	} );
} );

describe( 'readTailscaleState', () => {
	it( 'says Tailscale is not installed when there is no CLI', async () => {
		const run = vi.fn();
		await expect( readTailscaleState( { find: () => undefined, run } ) ).resolves.toEqual( {
			installed: false,
		} );
		expect( run ).not.toHaveBeenCalled();
	} );

	it( 'runs `status --json` without the peers, as the CLI, and parses it', async () => {
		const run = vi.fn().mockResolvedValue( JSON.stringify( RUNNING_WITH_HTTPS ) );
		await expect(
			readTailscaleState( { find: () => '/usr/bin/tailscale', run } )
		).resolves.toMatchObject( { running: true, httpsReady: true } );
		expect( run ).toHaveBeenCalledWith(
			'/usr/bin/tailscale',
			[ 'status', '--json', '--peers=false' ],
			expect.objectContaining( {
				env: expect.objectContaining( { TAILSCALE_BE_CLI: '1' } ),
				timeout: 5000,
				maxBuffer: 16 * 1024 * 1024,
			} )
		);
	} );

	it( 'reads a CLI that fails or prints no JSON as not running', async () => {
		await expect(
			readTailscaleState( {
				find: () => '/usr/bin/tailscale',
				run: vi.fn().mockRejectedValue( new Error( 'failed to connect to local tailscaled' ) ),
			} )
		).resolves.toEqual( { installed: true, running: false, httpsReady: false } );
		await expect(
			readTailscaleState( {
				find: () => '/usr/bin/tailscale',
				run: vi.fn().mockResolvedValue( 'Tailscale is stopped.' ),
			} )
		).resolves.toEqual( { installed: true, running: false, httpsReady: false } );
	} );
} );
