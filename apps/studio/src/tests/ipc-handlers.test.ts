/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent, dialog, shell } from 'electron';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { readSitePath } from '@studio/common/sites/site-path';
import { getProvider } from '@studio/providers/services';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { listAccountSites, getFileSize, openURL, showOpenFolderDialog } from 'src/ipc-handlers';

vi.mock( 'fs' );
vi.mock( 'fs/promises', async () => {
	const { fs } = await import( 'memfs' );
	return { default: fs.promises };
} );
vi.mock( '@studio/common/sites/site-path' );
vi.mock( '@studio/common/lib/provider-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/provider-config') >() ),
	readProviderConfig: vi.fn(),
} ) );
vi.mock( '@studio/providers/services', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/providers/services') >();
	const sites = { list: vi.fn() };
	return { ...actual, getProvider: () => ( { descriptor: { id: 'wpcom' }, sites } ) };
} );
vi.mock( 'src/lib/oauth' );

beforeEach( () => {
	vol.reset();
} );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue( false ) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

describe( 'listAccountSites', () => {
	afterEach( () => vi.unstubAllEnvs() );

	it.each( [
		{ flag: undefined, planRequired: true },
		{ flag: '1', planRequired: false },
	] )(
		'requires a plan: $planRequired with Reprint flag $flag',
		async ( { flag, planRequired } ) => {
			vi.stubEnv( 'STUDIO_ENABLE_PULL_REPRINT', flag );
			vi.mocked( readProviderConfig ).mockResolvedValue( { token: 'test-token' } );
			const { list } = getProvider( 'wpcom' ).sites!;
			vi.mocked( list ).mockResolvedValue( [] );

			await listAccountSites( mockIpcMainInvokeEvent, 'wpcom' );

			expect( list ).toHaveBeenCalledWith( { token: 'test-token' }, { planRequired } );
		}
	);
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

describe( 'site source picker', () => {
	const originalPlatform = process.platform;
	beforeEach( () => {
		Object.assign( dialog, {
			showOpenDialog: vi.fn().mockResolvedValue( { canceled: true, filePaths: [] } ),
		} );
	} );
	afterEach( () => Object.defineProperty( process, 'platform', { value: originalPlatform } ) );

	it.each( [ 'win32', 'linux' ] )(
		'offers separate native folder and Blueprint pickers on %s',
		async ( platform ) => {
			Object.defineProperty( process, 'platform', { value: platform } );
			for ( const [ response, properties ] of [
				[ 0, [ 'openDirectory' ] ],
				[ 1, [ 'openFile' ] ],
			] as const ) {
				vi.mocked( dialog.showMessageBox ).mockResolvedValueOnce( {
					response,
					checkboxChecked: false,
				} );
				await expect(
					showOpenFolderDialog( mockIpcMainInvokeEvent, 'Open', '/sites', {
						allowBlueprints: true,
					} )
				).resolves.toBeNull();
				expect( dialog.showOpenDialog ).toHaveBeenLastCalledWith(
					expect.anything(),
					expect.objectContaining( {
						properties: [ ...properties ],
						filters: [ { name: 'Blueprints', extensions: [ 'json', 'zip' ] } ],
					} )
				);
			}
			vi.mocked( dialog.showMessageBox ).mockResolvedValueOnce( {
				response: 2,
				checkboxChecked: false,
			} );
			await expect(
				showOpenFolderDialog( mockIpcMainInvokeEvent, 'Open', '/sites', { allowBlueprints: true } )
			).resolves.toBeNull();
			expect( dialog.showOpenDialog ).toHaveBeenCalledTimes( 2 );
		}
	);

	it( 'accepts a destination that does not exist yet without presenting a picker', async () => {
		await expect(
			showOpenFolderDialog( mockIpcMainInvokeEvent, 'Choose folder', '/sites/new-destination', {
				usePath: true,
			} )
		).resolves.toEqual( {
			path: '/sites/new-destination',
			name: 'new-destination',
			isEmpty: true,
			isWordPress: false,
		} );
		expect( dialog.showOpenDialog ).not.toHaveBeenCalled();
	} );

	it( 'reads a dropped Blueprint folder without presenting a picker', async () => {
		vol.fromJSON( { '/sites/starter/blueprint.json': JSON.stringify( { steps: [] } ) } );
		const result = await showOpenFolderDialog( mockIpcMainInvokeEvent, 'Open', '/sites/starter', {
			allowBlueprints: true,
			usePath: true,
		} );
		expect( result?.blueprint ).toEqual( { steps: [] } );
		expect( result?.path ).toBe( '/sites/starter' );
		expect( dialog.showOpenDialog ).not.toHaveBeenCalled();
	} );

	it.each( [ 'backup.wpress', 'export.xml', 'blueprint.json' ] )(
		'opens the combined source picker for %s',
		async ( name ) => {
			Object.defineProperty( process, 'platform', { value: 'darwin' } );
			vol.fromJSON( { [ '/sites/' + name ]: name.endsWith( '.json' ) ? '{}' : 'file' } );
			vi.mocked( dialog.showOpenDialog ).mockResolvedValueOnce( {
				canceled: false,
				filePaths: [ '/sites/' + name ],
			} );
			const result = await showOpenFolderDialog( mockIpcMainInvokeEvent, 'Choose', '/sites', {
				allowSiteFiles: true,
			} );
			expect( result?.path ).toBe( '/sites/' + name );
			if ( name.endsWith( '.json' ) ) expect( result?.blueprint ).toEqual( {} );
			else expect( result?.file ).toEqual( { path: '/sites/' + name, name } );
			expect( dialog.showOpenDialog ).toHaveBeenLastCalledWith(
				expect.anything(),
				expect.objectContaining( {
					properties: [ 'openDirectory', 'createDirectory', 'openFile' ],
					filters: [
						{
							name: 'Site sources',
							extensions: expect.arrayContaining( [ 'json', 'zip', 'xml', 'wpress' ] ),
						},
					],
				} )
			);
		}
	);

	it( 'keeps the combined native picker on macOS', async () => {
		Object.defineProperty( process, 'platform', { value: 'darwin' } );
		await showOpenFolderDialog( mockIpcMainInvokeEvent, 'Open', '/sites', {
			allowBlueprints: true,
		} );
		expect( dialog.showMessageBox ).not.toHaveBeenCalled();
		expect( dialog.showOpenDialog ).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining( {
				properties: [ 'openDirectory', 'createDirectory', 'openFile' ],
			} )
		);
	} );
} );
