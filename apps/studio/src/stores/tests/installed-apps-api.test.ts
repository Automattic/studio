import { configureStore } from '@reduxjs/toolkit';
import { vi } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	installedAppsApi,
	selectInstalledEditors,
	selectUninstalledEditors,
	selectInstalledTerminals,
	selectUninstalledTerminals,
} from 'src/stores/installed-apps-api';

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn(),
} ) );

vi.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: vi.fn().mockReturnValue( {
		platform: 'darwin',
	} ),
} ) );

const mockIpcApi = {
	getInstalledAppsAndTerminals: vi.fn(),
	getUserEditor: vi.fn(),
	getUserTerminal: vi.fn(),
	saveUserEditor: vi.fn(),
	saveUserTerminal: vi.fn(),
};

vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( mockIpcApi );

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
		it( 'should return user preference when set', async () => {
			mockIpcApi.getUserEditor.mockResolvedValueOnce( 'windsurf' );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			expect( mockIpcApi.getUserEditor ).toHaveBeenCalledTimes( 1 );
			expect( mockIpcApi.getInstalledAppsAndTerminals ).not.toHaveBeenCalled();
			expect( result.data ).toBe( 'windsurf' );
		} );

		it( 'should respect priority order when multiple editors are installed', async () => {
			mockIpcApi.getUserEditor.mockResolvedValueOnce( null );
			const mockInstalledApps = createMockInstalledApps( {
				webstorm: true,
				phpstorm: true,
				windsurf: true,
				cursor: true,
			} );
			mockIpcApi.getInstalledAppsAndTerminals.mockResolvedValueOnce( mockInstalledApps );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			// Should return cursor since it has the highest priority
			expect( result.data ).toBe( 'cursor' );
		} );

		it( 'should return the installed editor when no preference is set and only one editor is installed', async () => {
			mockIpcApi.getUserEditor.mockResolvedValueOnce( null );
			const mockInstalledApps = createMockInstalledApps( { cursor: true } );
			mockIpcApi.getInstalledAppsAndTerminals.mockResolvedValueOnce( mockInstalledApps );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			expect( result.data ).toBe( 'cursor' );
		} );

		it( 'should return phpstorm when cursor and vscode are not installed but phpstorm is', async () => {
			mockIpcApi.getUserEditor.mockResolvedValueOnce( null );
			const mockInstalledApps = createMockInstalledApps( { phpstorm: true, webstorm: true } );
			mockIpcApi.getInstalledAppsAndTerminals.mockResolvedValueOnce( mockInstalledApps );

			const store = createTestStore();
			const result = await store.dispatch(
				installedAppsApi.endpoints.getUserEditor.initiate( undefined )
			);

			expect( result.data ).toBe( 'phpstorm' );
		} );

		it( 'should return null when no preference set and no editors are installed', async () => {
			mockIpcApi.getUserEditor.mockResolvedValueOnce( null );
			const mockInstalledApps = createMockInstalledApps();
			mockIpcApi.getInstalledAppsAndTerminals.mockResolvedValueOnce( mockInstalledApps );

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
