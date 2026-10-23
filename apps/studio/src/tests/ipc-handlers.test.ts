/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent, shell } from 'electron';
import { existsSync } from 'fs';
import { normalize } from 'path';
import { startSite } from '@studio/common/sites/lifecycle';
import { readSite, readSitePath } from '@studio/common/sites/site-path';
import { readFile } from 'atomically';
import { vol } from 'memfs';
import { vi } from 'vitest';
import {
	createSite,
	getFileSize,
	isFullscreen,
	openURL,
	readBlueprintFile,
	startServer,
} from 'src/ipc-handlers';
import { getSite } from 'src/lib/sites';
import { getMainWindow } from 'src/main-window';
import { createSiteViaCli } from 'src/modules/cli/lib/cli-site-creator';

vi.mock( 'fs' );
vi.mock( 'fs/promises', async () => {
	const { fs } = await import( 'memfs' );
	return { default: fs.promises };
} );
vi.mock( 'fs-extra' );
vi.mock( '@studio/common/lib/fs-utils' );
vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	setTag: vi.fn(),
} ) );
vi.mock( 'src/lib/sites' );
vi.mock( 'src/lib/php-error-recovery' );
vi.mock( import( '@studio/common/sites/lifecycle' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	startSite: vi.fn(),
} ) );
vi.mock( 'src/modules/cli/lib/cli-site-creator' );
vi.mock( '@studio/common/sites/site-path' );
vi.mock( '@studio/common/sites/site-identity' );
vi.mock( 'src/main-window' );
vi.mock( import( 'src/lib/bump-stats' ), async ( importOriginal ) => {
	const actual = await importOriginal();
	return {
		...actual,
		bumpStat: vi.fn(),
		bumpAggregatedUniqueStat: vi.fn().mockResolvedValue( undefined ),
	};
} );
vi.mock( 'atomically' );
vi.mock( 'src/lib/capture-site-thumbnail', () => ( {
	captureSiteThumbnail: vi.fn(),
} ) );

const mockSiteDetails = {
	id: 'mock-cli-site-id',
	name: 'Test',
	path: '/test',
	port: 9999,
	url: 'http://localhost:9999',
	phpVersion: '8.4',
	running: false,
	adminPassword: 'mock-password',
	isWpAutoUpdating: false,
};

vi.mocked( createSiteViaCli ).mockResolvedValue( mockSiteDetails );

const mockUserData = {
	sites: [],
};

beforeEach( () => {
	vol.reset();
	vol.fromJSON( {
		[ normalize( '/path/to/app/appData/App Name/appdata-v1.json' ) ]:
			JSON.stringify( mockUserData ),
	} );
} );

vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( mockUserData ) ) );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue( false ) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

describe( 'createSite', () => {
	it( 'should delegate to CLI and return site details', async () => {
		const userData = await createSite( mockIpcMainInvokeEvent, '/test', {
			siteName: 'Test',
			wpVersion: '6.4',
			noStart: true,
		} );

		expect( userData ).toEqual( mockSiteDetails );
		expect( createSiteViaCli ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/test',
				name: 'Test',
				wpVersion: '6.4',
				noStart: true,
			} )
		);
	} );
} );

describe( 'startServer', () => {
	beforeEach( () => {
		vi.mocked( readSite ).mockResolvedValue( { id: 'site-id', name: 'Test', path: '/test' } );
		vi.mocked( getSite ).mockResolvedValue( { ...mockSiteDetails, id: 'site-id' } );
	} );

	it( 'starts the site from its path without asking the CLI for its details', async () => {
		vi.mocked( startSite ).mockResolvedValue();

		await startServer( mockIpcMainInvokeEvent, 'site-id' );

		expect( startSite ).toHaveBeenCalledWith( expect.any( Function ), '/test' );
		expect( getSite ).not.toHaveBeenCalled();
	} );

	it( "reads the site's details to report a failed start", async () => {
		vi.mocked( startSite ).mockRejectedValue( new Error( 'Failed to start site' ) );

		await expect( startServer( mockIpcMainInvokeEvent, 'site-id' ) ).rejects.toThrow(
			'Failed to start site'
		);
		expect( getSite ).toHaveBeenCalledWith( 'site-id' );
	} );
} );

describe( 'readBlueprintFile', () => {
	it( 'deletes the temporary deep-link file after reading it', async () => {
		const filePath = normalize( '/mock/path/wp-studio-blueprints/blueprint.json' );
		vol.fromJSON( { [ filePath ]: JSON.stringify( { meta: { title: 'Deep link' } } ) } );

		await expect( readBlueprintFile( mockIpcMainInvokeEvent, filePath ) ).resolves.toEqual( {
			meta: { title: 'Deep link' },
		} );
		expect( existsSync( filePath ) ).toBe( false );
	} );

	it( 'deletes invalid temporary deep-link JSON', async () => {
		const filePath = normalize( '/mock/path/wp-studio-blueprints/invalid.json' );
		vol.fromJSON( { [ filePath ]: '{invalid' } );

		await expect( readBlueprintFile( mockIpcMainInvokeEvent, filePath ) ).rejects.toThrow();
		expect( existsSync( filePath ) ).toBe( false );
	} );
} );

describe( 'isFullscreen', () => {
	it( 'should return false when window is not in fullscreen', async () => {
		vi.mocked( getMainWindow, { partial: true } ).mockResolvedValue( {
			isFullScreen: () => false,
		} );

		const result = await isFullscreen( mockIpcMainInvokeEvent );

		expect( result ).toBe( false );
	} );

	it( 'should return true when window is in fullscreen', async () => {
		vi.mocked( getMainWindow, { partial: true } ).mockResolvedValue( {
			isFullScreen: () => true,
		} );

		const result = await isFullscreen( mockIpcMainInvokeEvent );

		expect( result ).toBe( true );
	} );
} );

describe( 'getFileSize', () => {
	beforeEach( () => {
		vi.mocked( readSitePath ).mockResolvedValue( '/test' );
	} );

	it( 'returns the file size', async () => {
		vol.fromJSON( { '/test/wp-content/index.php': '<?php' } );

		await expect(
			getFileSize( mockIpcMainInvokeEvent, 'test-site-id', [ 'wp-content', 'index.php' ] )
		).resolves.toBe( 5 );
	} );

	it( 'returns 0 for a dangling symlink instead of throwing', async () => {
		// A broken symlink whose target was never created — mirrors the WP Cloud
		// `advanced-cache.php` drop-in that a reprint pull leaves dangling.
		vol.mkdirSync( '/test/wp-content', { recursive: true } );
		vol.symlinkSync(
			'/test/wordpress/drop-ins/advanced-cache.php',
			'/test/wp-content/advanced-cache.php'
		);
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		await expect(
			getFileSize( mockIpcMainInvokeEvent, 'test-site-id', [ 'wp-content', 'advanced-cache.php' ] )
		).resolves.toBe( 0 );
		expect( warnSpy ).toHaveBeenCalledWith( expect.stringContaining( 'advanced-cache.php' ) );

		warnSpy.mockRestore();
	} );
} );

describe( 'openURL', () => {
	it( 'only hands web URLs to the OS', () => {
		const openExternal = vi.fn().mockResolvedValue( undefined );
		( shell as unknown as { openExternal: typeof openExternal } ).openExternal = openExternal;

		for ( const url of [
			'https://wordpress.com/',
			'http://localhost:8881/',
			'file:///etc/passwd',
			'vscode://file/tmp',
			'smb://host/share',
			'relative/path',
		] ) {
			openURL( mockIpcMainInvokeEvent, url );
		}

		expect( openExternal.mock.calls ).toEqual( [
			[ 'https://wordpress.com/' ],
			[ 'http://localhost:8881/' ],
		] );
	} );
} );
