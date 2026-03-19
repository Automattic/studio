import { configureStore } from '@reduxjs/toolkit';
import { vi } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { isInstalled } from 'src/lib/is-installed';
import { getUserEditor } from 'src/modules/user-settings/lib/ipc-handlers';
import { loadUserData } from 'src/storage/user-data';
import {
	installedAppsApi,
	selectInstalledEditors,
	selectUninstalledEditors,
	selectInstalledTerminals,
	selectUninstalledTerminals,
} from 'src/stores/installed-apps-api';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/storage/user-data' );
vi.mock( 'src/lib/is-installed' );

vi.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: vi.fn().mockReturnValue( {
		platform: 'darwin',
	} ),
} ) );

const mockIpcApi = {
	getInstalledAppsAndTerminals: vi.fn(),
	getUserEditor: vi.fn().mockImplementation( async () => getUserEditor() ),
	getUserTerminal: vi.fn(),
	saveUserEditor: vi.fn(),
	saveUserTerminal: vi.fn(),
};

vi.mocked( getIpcApi ).mockReturnValue( mockIpcApi as unknown as IpcApi );

const createTestStore = () => {
	return configureStore( {
		reducer: {
			[ installedAppsApi.reducerPath ]: installedAppsApi.reducer,
		},
		middleware: ( getDefaultMiddleware ) =>
			getDefaultMiddleware().concat( installedAppsApi.middleware ),
	} );
};

const createMockInstalledApps = (
	installedApps: Partial< InstalledApps > = {}
): InstalledApps => ( {
	antigravity: false,
	vscode: false,
	phpstorm: false,
	webstorm: false,
	windsurf: false,
	cursor: false,
	sublime: false,
	zed: false,
	terminal: false,
	iterm: false,
	warp: false,
	ghostty: false,
	...installedApps,
} );

describe( 'Installed Apps API', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	describe( 'getInstalledApps', () => {
		it( 'should fetch installed apps and terminals', async () => {
			const mockInstalledApps = createMockInstalledApps( { vscode: true, cursor: true } );
			mockIpcApi.getInstalledAppsAndTerminals.mockResolvedValueOnce( mockInstalledApps );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getInstalledApps.initiate( undefined )
			);

			expect( mockIpcApi.getInstalledAppsAndTerminals ).toHaveBeenCalledTimes( 1 );
			expect( result.data ).toEqual( mockInstalledApps );
		} );
	} );

	describe( 'getUserEditor', () => {
		const mockIsInstalled = ( installedApps: Partial< InstalledApps > = {} ) => {
			const apps = createMockInstalledApps( installedApps );
			vi.mocked( isInstalled ).mockImplementation( ( key ) => apps[ key ] );
		};

		const mockUserData = ( preferredEditor?: string ) => {
			vi.mocked( loadUserData ).mockResolvedValue( {
				sites: {},
				preferredEditor,
			} as Awaited< ReturnType< typeof loadUserData > > );
		};

		it( 'should return user preference when set', async () => {
			mockUserData( 'windsurf' );
			mockIsInstalled();

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			expect( result.data ).toBe( 'windsurf' );
		} );

		it( 'should respect priority order when multiple editors are installed', async () => {
			mockUserData( undefined );
			mockIsInstalled( {
				webstorm: true,
				phpstorm: true,
				windsurf: true,
				cursor: true,
			} );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			// Should return cursor since it has the highest priority in SUPPORTED_EDITORS
			expect( result.data ).toBe( 'cursor' );
		} );

		it( 'should return the installed editor when no preference is set and only one editor is installed', async () => {
			mockUserData( undefined );
			mockIsInstalled( { cursor: true } );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			expect( result.data ).toBe( 'cursor' );
		} );

		it( 'should return phpstorm when cursor and vscode are not installed but phpstorm is', async () => {
			mockUserData( undefined );
			mockIsInstalled( { phpstorm: true, webstorm: true } );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			expect( result.data ).toBe( 'phpstorm' );
		} );

		it( 'should return null when no preference set and no editors are installed', async () => {
			mockUserData( undefined );
			mockIsInstalled();

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			expect( result.data ).toBe( null );
		} );
	} );

	describe( 'getUserTerminal', () => {
		it( 'should fetch user terminal preference', async () => {
			mockIpcApi.getUserTerminal.mockResolvedValueOnce( 'iterm' );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserTerminal.initiate( undefined )
			);

			expect( mockIpcApi.getUserTerminal ).toHaveBeenCalledTimes( 1 );
			expect( result.data ).toBe( 'iterm' );
		} );
	} );

	describe( 'saveUserEditor', () => {
		it( 'should save user editor preference', async () => {
			mockIpcApi.saveUserEditor.mockResolvedValueOnce( undefined );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.saveUserEditor.initiate( 'cursor' )
			);

			expect( mockIpcApi.saveUserEditor ).toHaveBeenCalledTimes( 1 );
			expect( mockIpcApi.saveUserEditor ).toHaveBeenCalledWith( 'cursor' );
			expect( result.data ).toBe( 'cursor' );
		} );
	} );

	describe( 'saveUserTerminal', () => {
		it( 'should save user terminal preference', async () => {
			mockIpcApi.saveUserTerminal.mockResolvedValueOnce( undefined );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.saveUserTerminal.initiate( 'warp' )
			);

			expect( mockIpcApi.saveUserTerminal ).toHaveBeenCalledTimes( 1 );
			expect( mockIpcApi.saveUserTerminal ).toHaveBeenCalledWith( 'warp' );
			expect( result.data ).toBe( 'warp' );
		} );
	} );

	describe( 'selectors', () => {
		describe( 'selectInstalledEditors', () => {
			it( 'should return only installed editors', () => {
				const mockInstalledApps = createMockInstalledApps( {
					vscode: true,
					cursor: true,
					windsurf: true,
				} );
				const result = selectInstalledEditors( mockInstalledApps );

				expect( result ).toHaveLength( 3 );
				expect( result.map( ( [ editor ] ) => editor ) ).toEqual(
					expect.arrayContaining( [ 'vscode', 'cursor', 'windsurf' ] )
				);
			} );

			it( 'should return empty array when no editors are installed', () => {
				const mockInstalledApps = createMockInstalledApps();
				const result = selectInstalledEditors( mockInstalledApps );

				expect( result ).toHaveLength( 0 );
			} );
		} );

		describe( 'selectUninstalledEditors', () => {
			it( 'should return only uninstalled editors', () => {
				const mockInstalledApps = createMockInstalledApps( { vscode: true, cursor: true } );
				const result = selectUninstalledEditors( mockInstalledApps );

				expect( result ).toHaveLength( 6 );
				expect( result.map( ( [ editor ] ) => editor ) ).toEqual(
					expect.arrayContaining( [
						'antigravity',
						'phpstorm',
						'windsurf',
						'webstorm',
						'sublime',
						'zed',
					] )
				);
			} );

			it( 'should return all editors when none are installed', () => {
				const mockInstalledApps = createMockInstalledApps();
				const result = selectUninstalledEditors( mockInstalledApps );

				expect( result ).toHaveLength( 8 );
			} );
		} );

		describe( 'selectInstalledTerminals', () => {
			it( 'should return only installed terminals', () => {
				const mockInstalledApps = createMockInstalledApps( { terminal: true, iterm: true } );
				const result = selectInstalledTerminals( mockInstalledApps );

				expect( result ).toHaveLength( 2 );
				expect( result.map( ( [ terminal ] ) => terminal ) ).toEqual(
					expect.arrayContaining( [ 'terminal', 'iterm' ] )
				);
			} );
		} );

		describe( 'selectUninstalledTerminals', () => {
			it( 'should return only uninstalled terminals', () => {
				const mockInstalledApps = createMockInstalledApps( { terminal: true, iterm: true } );
				const result = selectUninstalledTerminals( mockInstalledApps );

				expect( result ).toHaveLength( 2 );
				expect( result.map( ( [ terminal ] ) => terminal ) ).toEqual(
					expect.arrayContaining( [ 'warp', 'ghostty' ] )
				);
			} );
		} );
	} );
} );
