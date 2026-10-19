/**
 * @vitest-environment node
 */
import { BrowserWindow, IpcMainInvokeEvent, shell } from 'electron';
import { existsSync } from 'fs';
import { normalize } from 'path';
import { readThemeDetails } from '@studio/common/sites/site-identity';
import { readSitePath } from '@studio/common/sites/site-path';
import { readFile } from 'atomically';
import { vol } from 'memfs';
import { vi } from 'vitest';
import {
	createSite,
	ensureMinWindowWidth,
	getFileSize,
	isFullscreen,
	loadThemeDetails,
	openURL,
	readBlueprintFile,
} from 'src/ipc-handlers';
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
vi.mock( 'src/lib/get-image-data', () => ( {
	getImageData: vi.fn().mockResolvedValue( 'data:image/png;base64,mock' ),
} ) );
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

describe( 'ensureMinWindowWidth', () => {
	it( 'grows the sender window content while preserving its height', async () => {
		const setContentSize = vi.fn();
		let width = 420;
		vi.mocked( BrowserWindow.fromWebContents ).mockReturnValueOnce( {
			isDestroyed: () => false,
			getContentSize: () => [ width, 700 ],
			setContentSize: ( nextWidth: number, height: number ) => {
				width = nextWidth;
				setContentSize( nextWidth, height );
			},
		} as unknown as BrowserWindow );

		const result = await ensureMinWindowWidth( mockIpcMainInvokeEvent, 640 );

		expect( setContentSize ).toHaveBeenCalledWith( 640, 700 );
		expect( result ).toBe( 640 );
	} );

	it( 'leaves an already-wide window unchanged', async () => {
		const setContentSize = vi.fn();
		vi.mocked( BrowserWindow.fromWebContents ).mockReturnValueOnce( {
			isDestroyed: () => false,
			getContentSize: () => [ 900, 700 ],
			setContentSize,
		} as unknown as BrowserWindow );

		const result = await ensureMinWindowWidth( mockIpcMainInvokeEvent, 640 );

		expect( setContentSize ).not.toHaveBeenCalled();
		expect( result ).toBe( 900 );
	} );

	it( 'returns the content width the window manager actually applied', async () => {
		vi.mocked( BrowserWindow.fromWebContents ).mockReturnValueOnce( {
			isDestroyed: () => false,
			getContentSize: () => [ 600, 700 ],
			setContentSize: vi.fn(),
		} as unknown as BrowserWindow );

		const result = await ensureMinWindowWidth( mockIpcMainInvokeEvent, 640 );

		expect( result ).toBe( 600 );
	} );
} );

describe( 'loadThemeDetails', () => {
	it( "reads the theme from the site's folder, whether or not it runs", async () => {
		const themeDetails = {
			name: 'Twenty Twenty-Five',
			path: '/themes/twentytwentyfive',
			slug: 'twentytwentyfive',
			isBlockTheme: true,
			supportsWidgets: false,
			supportsMenus: false,
		};
		vi.mocked( readSitePath ).mockResolvedValue( '/test' );
		vi.mocked( readThemeDetails ).mockResolvedValue( themeDetails );

		await expect( loadThemeDetails( mockIpcMainInvokeEvent, 'site-id' ) ).resolves.toBe(
			themeDetails
		);
		expect( readThemeDetails ).toHaveBeenCalledWith( expect.any( Function ), '/test' );
	} );

	it( 'rejects an unknown site', async () => {
		vi.mocked( readSitePath ).mockResolvedValue( null );

		await expect( loadThemeDetails( mockIpcMainInvokeEvent, 'missing' ) ).rejects.toThrow(
			'Site not found.'
		);
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
