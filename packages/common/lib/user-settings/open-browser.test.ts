import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAppConfig } from '@studio/common/lib/app-config';
import { openSiteInBrowser } from './open-browser';

vi.mock( 'node:child_process', () => ( { spawn: vi.fn() } ) );
vi.mock( '@studio/common/lib/app-config', () => ( { readAppConfig: vi.fn() } ) );
vi.mock( 'node:fs', () => ( {
	default: {
		existsSync: vi.fn( () => true ),
		statSync: () => ( { isFile: () => true } ),
		accessSync: () => {},
		constants: { X_OK: 1 },
	},
} ) );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
} );

describe( 'site browser selection', () => {
	it( 'uses the system browser when unset or unknown', async () => {
		const fallback = vi.fn();
		for ( const preferredBrowser of [ undefined, 'unknown' ] ) {
			vi.mocked( readAppConfig ).mockResolvedValue( { preferredBrowser } );
			await openSiteInBrowser( 'https://example.test/wp-admin/', fallback );
		}
		expect( fallback ).toHaveBeenCalledTimes( 2 );
	} );
	it( 'opens the selected macOS browser without shell interpolation', async () => {
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		vi.mocked( readAppConfig ).mockResolvedValue( { preferredBrowser: 'chrome' } );
		const child = Object.assign( new EventEmitter(), { unref: vi.fn() } );
		vi.mocked( spawn ).mockImplementation( () => {
			queueMicrotask( () => {
				child.emit( 'spawn' );
				child.emit( 'exit', 0 );
			} );
			return child as never;
		} );
		const fallback = vi.fn();
		await openSiteInBrowser( 'https://example.test/?x=a&y=b', fallback );
		expect( spawn ).toHaveBeenCalledWith(
			'open',
			[ '-a', '/Applications/Google Chrome.app', 'https://example.test/?x=a&y=b' ],
			{ detached: true, stdio: 'ignore' }
		);
		expect( fallback ).not.toHaveBeenCalled();
	} );
	it( 'rejects non-web protocols', async () => {
		await expect( openSiteInBrowser( 'file:///etc/passwd', vi.fn() ) ).rejects.toThrow(
			'Unsupported browser URL'
		);
	} );
	it.each( [ 'win32', 'linux' ] as const )(
		'launches the selected browser on %s',
		async ( platform ) => {
			vi.spyOn( process, 'platform', 'get' ).mockReturnValue( platform );
			vi.stubEnv( 'ProgramFiles', 'C:\\Program Files' );
			vi.stubEnv( 'PATH', '/usr/bin' );
			vi.mocked( readAppConfig ).mockResolvedValue( { preferredBrowser: 'chrome' } );
			const child = Object.assign( new EventEmitter(), { unref: vi.fn() } );
			vi.mocked( spawn ).mockImplementation( () => {
				queueMicrotask( () => child.emit( 'spawn' ) );
				return child as never;
			} );
			await openSiteInBrowser( 'https://example.test/?x=a&y=b', vi.fn() );
			expect( spawn ).toHaveBeenCalledWith(
				platform === 'win32'
					? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
					: '/usr/bin/google-chrome',
				[ 'https://example.test/?x=a&y=b' ],
				{ detached: true, stdio: 'ignore' }
			);
			expect( child.unref ).toHaveBeenCalled();
		}
	);
	it( 'reports a selected browser that is no longer installed', async () => {
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		vi.mocked( fs.existsSync ).mockReturnValue( false );
		vi.mocked( readAppConfig ).mockResolvedValue( { preferredBrowser: 'chrome' } );
		const fallback = vi.fn();
		await expect( openSiteInBrowser( 'https://example.test/', fallback ) ).rejects.toThrow(
			'Google Chrome is no longer installed'
		);
		expect( fallback ).not.toHaveBeenCalled();
	} );
} );
