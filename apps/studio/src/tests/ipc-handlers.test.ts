/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'fs';
import { normalize } from 'path';
import { resolveMigratedAiSessionsPath } from '@studio/common/ai/sessions/root-migration';
import { readFile } from 'atomically';
import { vol } from 'memfs';
import { vi } from 'vitest';
import {
	createSite,
	deleteSite,
	getFileSize,
	getXdebugEnabledSite,
	isFullscreen,
	loadThemeDetails,
	readBlueprintFile,
	readLocalMediaFile,
} from 'src/ipc-handlers';
import { captureSiteThumbnail } from 'src/lib/capture-site-thumbnail';
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';

vi.mock( 'fs' );
vi.mock( 'fs/promises', async () => {
	const { fs } = await import( 'memfs' );
	return { default: fs.promises };
} );
vi.mock( 'fs-extra' );
vi.mock( '@studio/common/lib/fs-utils' );
vi.mock( '@studio/common/ai/sessions/root-migration', () => ( {
	resolveMigratedAiSessionsPath: vi.fn( ( path: string ) => path ),
} ) );
vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	setTag: vi.fn(),
} ) );
vi.mock( 'src/site-server' );
vi.mock( 'src/lib/wordpress-setup', () => ( {
	setupWordPressFilesOnly: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'src/main-window' );
vi.mock( 'src/lib/sqlite-versions', () => ( {
	keepSqliteIntegrationUpdated: vi.fn().mockResolvedValue( undefined ),
	installSqliteIntegration: vi.fn().mockResolvedValue( undefined ),
} ) );
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

vi.mock( '@studio/common/lib/port-finder', () => ( {
	portFinder: {
		getOpenPort: vi.fn().mockResolvedValue( 9999 ),
	},
} ) );

const mockSiteDetails: StoppedSiteDetails = {
	id: 'mock-cli-site-id',
	name: 'Test',
	path: '/test',
	port: 9999,
	phpVersion: '8.4',
	running: false,
	adminPassword: 'mock-password',
	isWpAutoUpdating: false,
	customDomain: undefined,
	enableHttps: undefined,
};

vi.mocked( SiteServer.create ).mockResolvedValue( {
	server: {
		start: vi.fn(),
		details: mockSiteDetails,
		updateSiteDetails: vi.fn(),
		updateCachedThumbnail: vi.fn().mockResolvedValue( undefined ),
	} as unknown as SiteServer,
	details: mockSiteDetails,
} );

vi.mocked( SiteServer.register, { partial: true } ).mockImplementation( ( details ) => ( {
	start: vi.fn(),
	details,
	updateSiteDetails: vi.fn(),
	updateCachedThumbnail: vi.fn().mockResolvedValue( undefined ),
} ) );

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

		expect( userData ).toEqual( {
			adminPassword: 'mock-password',
			id: 'mock-cli-site-id',
			name: 'Test',
			path: '/test',
			phpVersion: '8.4',
			port: 9999,
			running: false,
			customDomain: undefined,
			enableHttps: undefined,
			isWpAutoUpdating: false,
		} );

		expect( SiteServer.create ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/test',
				name: 'Test',
				wpVersion: '6.4',
				noStart: true,
			} ),
			expect.any( Object )
		);
	} );
} );

describe( 'deleteSite', () => {
	it( 'delegates deletion to the site server CLI cascade', async () => {
		const deleteServer = vi.fn().mockResolvedValue( undefined );
		vi.mocked( SiteServer.get ).mockReturnValue( { delete: deleteServer } as never );

		await deleteSite( mockIpcMainInvokeEvent, 'site-1', true );

		expect( deleteServer ).toHaveBeenCalledWith( true );
	} );

	it( 'reports site deletion failures', async () => {
		vi.mocked( SiteServer.get ).mockReturnValue( {
			delete: vi.fn().mockRejectedValue( new Error( 'delete failed' ) ),
		} as never );

		await expect( deleteSite( mockIpcMainInvokeEvent, 'site-1', true ) ).rejects.toThrow(
			'delete failed'
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

describe( 'getXdebugEnabledSite', () => {
	it( 'should return null when no site has Xdebug enabled', async () => {
		vi.mocked( SiteServer.getAllDetails ).mockReturnValue( [
			{
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				enableXdebug: false,
				running: false,
				phpVersion: '8.4',
				port: 9999,
			},
			{
				id: 'site-2',
				name: 'Site 2',
				path: '/path/to/site-2',
				running: false,
				phpVersion: '8.4',
				port: 9998,
			},
		] as SiteDetails[] );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toBeNull();
	} );

	it( 'should return the site that has Xdebug enabled', async () => {
		vi.mocked( SiteServer.getAllDetails ).mockReturnValue( [
			{
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				enableXdebug: false,
				running: false,
				phpVersion: '8.4',
				port: 9999,
			},
			{
				id: 'site-2',
				name: 'Site 2',
				path: '/path/to/site-2',
				enableXdebug: true,
				running: true,
				phpVersion: '8.4',
				port: 9999,
				url: 'https://site-2.test',
			},
		] as SiteDetails[] );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			id: 'site-2',
			name: 'Site 2',
			path: '/path/to/site-2',
			running: true,
			enableXdebug: true,
			phpVersion: '8.4',
			port: 9999,
			url: 'https://site-2.test',
		} );
	} );

	it( 'should return the first site when multiple have Xdebug enabled', async () => {
		vi.mocked( SiteServer.getAllDetails ).mockReturnValue( [
			{
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				enableXdebug: true,
				running: false,
				phpVersion: '8.4',
				port: 9999,
			},
			{
				id: 'site-2',
				name: 'Site 2',
				path: '/path/to/site-2',
				enableXdebug: true,
				running: true,
				phpVersion: '8.4',
				port: 9998,
			},
		] as SiteDetails[] );

		const result = await getXdebugEnabledSite( mockIpcMainInvokeEvent );

		expect( result ).toEqual( {
			id: 'site-1',
			name: 'Site 1',
			path: '/path/to/site-1',
			running: false,
			enableXdebug: true,
			phpVersion: '8.4',
			port: 9999,
		} );
	} );
} );

describe( 'loadThemeDetails', () => {
	it( 'should capture thumbnail but not persist theme details when theme has not changed', async () => {
		const themeDetails = { name: 'Twenty Twenty-Four', path: '/themes/twentytwentyfour' };
		const mockServer = {
			details: {
				id: 'test-site-id',
				running: true,
				themeDetails,
			},
			getThemeDetails: vi.fn().mockResolvedValue( themeDetails ),
			persistThemeDetails: vi.fn().mockResolvedValue( undefined ),
		};
		vi.mocked( SiteServer.get ).mockReturnValue( mockServer as unknown as SiteServer );

		await loadThemeDetails( mockIpcMainInvokeEvent, 'test-site-id' );

		expect( mockServer.persistThemeDetails ).not.toHaveBeenCalled();
		expect( captureSiteThumbnail ).toHaveBeenCalledWith( 'test-site-id', true );
	} );

	it( 'should persist theme details and capture thumbnail when theme has changed', async () => {
		const oldThemeDetails = { name: 'Twenty Twenty-Four', path: '/themes/twentytwentyfour' };
		const newThemeDetails = { name: 'Twenty Twenty-Five', path: '/themes/twentytwentyfive' };
		const mockServer = {
			details: {
				id: 'test-site-id',
				running: true,
				themeDetails: oldThemeDetails,
			},
			getThemeDetails: vi.fn().mockResolvedValue( newThemeDetails ),
			persistThemeDetails: vi.fn().mockResolvedValue( undefined ),
		};
		vi.mocked( SiteServer.get ).mockReturnValue( mockServer as unknown as SiteServer );

		await loadThemeDetails( mockIpcMainInvokeEvent, 'test-site-id' );

		expect( mockServer.persistThemeDetails ).toHaveBeenCalled();
		expect( captureSiteThumbnail ).toHaveBeenCalledWith( 'test-site-id', true );
	} );
} );

describe( 'getFileSize', () => {
	it( 'returns the file size', () => {
		vi.mocked( SiteServer.get ).mockReturnValue( {
			details: { path: '/test' },
		} as unknown as SiteServer );
		vol.fromJSON( { '/test/wp-content/index.php': '<?php' } );

		expect(
			getFileSize( mockIpcMainInvokeEvent, 'test-site-id', [ 'wp-content', 'index.php' ] )
		).toBe( 5 );
	} );

	it( 'returns 0 for a dangling symlink instead of throwing', () => {
		vi.mocked( SiteServer.get ).mockReturnValue( {
			details: { path: '/test' },
		} as unknown as SiteServer );
		// A broken symlink whose target was never created — mirrors the WP Cloud
		// `advanced-cache.php` drop-in that a reprint pull leaves dangling.
		vol.mkdirSync( '/test/wp-content', { recursive: true } );
		vol.symlinkSync(
			'/test/wordpress/drop-ins/advanced-cache.php',
			'/test/wp-content/advanced-cache.php'
		);
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		expect(
			getFileSize( mockIpcMainInvokeEvent, 'test-site-id', [ 'wp-content', 'advanced-cache.php' ] )
		).toBe( 0 );
		expect( warnSpy ).toHaveBeenCalledWith( expect.stringContaining( 'advanced-cache.php' ) );

		warnSpy.mockRestore();
	} );
} );

describe( 'readLocalMediaFile', () => {
	it( 'reads artifacts from their migrated sessions path', async () => {
		const legacyPath = '/legacy/sessions/session.screenshots/screenshot.jpg';
		const migratedPath = '/.studio/sessions/session.screenshots/screenshot.jpg';
		vol.fromJSON( { [ migratedPath ]: 'image' } );
		vi.mocked( resolveMigratedAiSessionsPath ).mockReturnValueOnce( migratedPath );

		const file = await readLocalMediaFile( mockIpcMainInvokeEvent, legacyPath );

		expect( resolveMigratedAiSessionsPath ).toHaveBeenCalledWith( legacyPath );
		expect( file.name ).toBe( 'screenshot.jpg' );
		expect( Buffer.from( file.data ).toString() ).toBe( 'image' );
	} );
} );
