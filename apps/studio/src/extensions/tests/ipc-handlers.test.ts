import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	installStudioExtension,
	installStudioExtensionFromPath,
	installStudioExtensionFromUrl,
	invokeStudioExtensionHandler,
	listStudioExtensions,
	setStudioExtensionEnabled,
	uninstallStudioExtension,
} from 'src/extensions/ipc-handlers';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { IpcMainInvokeEvent } from 'electron';
import type { InstalledStudioExtensionPackage } from 'src/extensions/types';

const mockExtensionHandler = vi.hoisted( () => vi.fn() );
const mockPackages = vi.hoisted( () => ( {
	value: [] as InstalledStudioExtensionPackage[],
} ) );
const mockDirectoryInstall = vi.hoisted( () => vi.fn() );
const mockGitInstall = vi.hoisted( () => vi.fn() );
const mockRemovePackage = vi.hoisted( () => vi.fn() );
const mockUserData = vi.hoisted( () => ( {
	value: {
		version: 1,
		siteMetadata: {},
		extensions: {},
	},
} ) );

const testManifest = vi.hoisted( () => ( {
	id: 'sample-extension',
	name: 'Sample Extension',
	description: 'Adds sample contributions.',
	version: '1.0.0',
	kind: 'user' as const,
} ) );

function createPackage(
	overrides: Partial< InstalledStudioExtensionPackage > = {}
): InstalledStudioExtensionPackage {
	return {
		manifest: testManifest,
		installedPath: `/mock/extensions/${ testManifest.id }`,
		...overrides,
	};
}

vi.mock( 'src/extensions/main-registry', () => ( {
	clearStudioMainExtensionCache: vi.fn(),
	getStudioExtensionHandler: vi.fn( async ( extensionPackage, handlerName ) => {
		if ( extensionPackage.manifest.id === 'sample-extension' && handlerName === 'echo' ) {
			return mockExtensionHandler;
		}
		return undefined;
	} ),
} ) );

vi.mock( 'src/extensions/package-manager', () => ( {
	getStudioExtensionInstallPath: ( extensionId: string ) => `/mock/extensions/${ extensionId }`,
	installStudioExtensionFromDirectorySource: mockDirectoryInstall,
	installStudioExtensionFromGitSource: mockGitInstall,
	listInstalledStudioExtensionPackages: vi.fn( async () => structuredClone( mockPackages.value ) ),
	normalizeGitSourceUrl: ( sourceUrl: string ) => sourceUrl.trim(),
	removeInstalledStudioExtensionPackage: mockRemovePackage,
} ) );

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn( async () => structuredClone( mockUserData.value ) ),
	lockAppdata: vi.fn( async () => undefined ),
	saveUserData: vi.fn( async ( nextUserData ) => {
		mockUserData.value = structuredClone( nextUserData );
	} ),
	unlockAppdata: vi.fn( async () => undefined ),
} ) );

vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: vi.fn( async () => undefined ),
} ) );

const ipcEvent = {} as IpcMainInvokeEvent;

describe( 'Studio extension IPC handlers', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mockExtensionHandler.mockResolvedValue( 'handled' );
		mockPackages.value = [];
		mockDirectoryInstall.mockImplementation( async () => {
			const extensionPackage = createPackage();
			mockPackages.value = [ extensionPackage ];
			return extensionPackage;
		} );
		mockGitInstall.mockImplementation( async () => {
			const extensionPackage = createPackage();
			mockPackages.value = [ extensionPackage ];
			return extensionPackage;
		} );
		mockRemovePackage.mockResolvedValue( undefined );
		mockUserData.value = {
			version: 1,
			siteMetadata: {},
			extensions: {},
		};
	} );

	it( 'lists installed extension packages from disk as disabled by default', async () => {
		mockPackages.value = [ createPackage() ];

		const extensions = await listStudioExtensions( ipcEvent );

		expect( extensions ).toHaveLength( 1 );
		expect( extensions[ 0 ] ).toMatchObject( {
			...testManifest,
			installed: true,
			enabled: false,
			sourceType: 'directory',
			status: 'installed',
			isSupported: true,
		} );
		expect( loadUserData ).toHaveBeenCalled();
	} );

	it( 'marks a discovered extension installed and enabled', async () => {
		mockPackages.value = [ createPackage() ];

		await expect( installStudioExtension( ipcEvent, 'sample-extension' ) ).resolves.toMatchObject( {
			id: 'sample-extension',
			installed: true,
			enabled: true,
			installedPath: '/mock/extensions/sample-extension',
			sourceType: 'manual',
		} );

		expect( lockAppdata ).toHaveBeenCalled();
		expect( saveUserData ).toHaveBeenCalledWith(
			expect.objectContaining( {
				extensions: {
					'sample-extension': expect.objectContaining( {
						installed: true,
						enabled: true,
						installedPath: '/mock/extensions/sample-extension',
						sourceType: 'manual',
					} ),
				},
			} )
		);
		expect( unlockAppdata ).toHaveBeenCalled();
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'user-preference-changed' );
	} );

	it( 'installs extensions from a Git URL and enables them', async () => {
		await expect(
			installStudioExtensionFromUrl( ipcEvent, 'https://github.com/example/sample-extension' )
		).resolves.toMatchObject( {
			id: 'sample-extension',
			installed: true,
			enabled: true,
			sourceType: 'git',
			sourceUrl: 'https://github.com/example/sample-extension',
		} );

		expect( mockGitInstall ).toHaveBeenCalledWith( 'https://github.com/example/sample-extension' );
		expect( saveUserData ).toHaveBeenCalledWith(
			expect.objectContaining( {
				extensions: {
					'sample-extension': expect.objectContaining( {
						sourceType: 'git',
						sourceUrl: 'https://github.com/example/sample-extension',
						enabled: true,
					} ),
				},
			} )
		);
	} );

	it( 'installs extensions from a local directory and enables them', async () => {
		await expect(
			installStudioExtensionFromPath( ipcEvent, '~/Code/sample-extension' )
		).resolves.toMatchObject( {
			id: 'sample-extension',
			installed: true,
			enabled: true,
			sourceType: 'directory',
		} );

		expect( mockDirectoryInstall ).toHaveBeenCalledWith( '~/Code/sample-extension' );
		expect( saveUserData ).toHaveBeenCalledWith(
			expect.objectContaining( {
				extensions: {
					'sample-extension': expect.objectContaining( {
						sourceType: 'directory',
						enabled: true,
					} ),
				},
			} )
		);
	} );

	it( 'normalizes installed package state when enabling an extension', async () => {
		mockPackages.value = [ createPackage() ];
		mockUserData.value.extensions = {
			'sample-extension': {
				installed: false,
				enabled: false,
				sourceType: 'bundled',
			},
		};

		await expect(
			setStudioExtensionEnabled( ipcEvent, 'sample-extension', true )
		).resolves.toMatchObject( {
			id: 'sample-extension',
			installed: true,
			enabled: true,
			sourceType: 'directory',
		} );
		expect( saveUserData ).toHaveBeenCalledWith(
			expect.objectContaining( {
				extensions: {
					'sample-extension': expect.objectContaining( {
						installed: true,
						enabled: true,
						installedPath: '/mock/extensions/sample-extension',
						sourceType: 'directory',
					} ),
				},
			} )
		);
	} );

	it( 'does not activate an unknown extension when enabling is requested', async () => {
		await expect( setStudioExtensionEnabled( ipcEvent, 'sample-extension', true ) ).rejects.toThrow(
			'Unknown Studio extension: sample-extension'
		);

		await expect(
			invokeStudioExtensionHandler( ipcEvent, 'sample-extension', 'echo' )
		).rejects.toThrow( 'Unknown Studio extension: sample-extension' );
		expect( mockExtensionHandler ).not.toHaveBeenCalled();
	} );

	it( 'rejects RPC calls to disabled extensions', async () => {
		mockPackages.value = [ createPackage() ];
		mockUserData.value.extensions = {
			'sample-extension': {
				installed: true,
				enabled: false,
			},
		};

		await expect(
			invokeStudioExtensionHandler( ipcEvent, 'sample-extension', 'echo' )
		).rejects.toThrow( 'Studio extension is not enabled: sample-extension' );
		expect( mockExtensionHandler ).not.toHaveBeenCalled();
	} );

	it( 'rejects unknown extension RPC handlers for active extensions', async () => {
		mockPackages.value = [ createPackage() ];
		mockUserData.value.extensions = {
			'sample-extension': {
				installed: true,
				enabled: true,
			},
		};

		await expect(
			invokeStudioExtensionHandler( ipcEvent, 'sample-extension', 'missing' )
		).rejects.toThrow( 'Unknown Studio extension handler: sample-extension/missing' );
	} );

	it( 'invokes namespaced RPC handlers for installed and enabled extensions', async () => {
		mockPackages.value = [ createPackage() ];
		mockUserData.value.extensions = {
			'sample-extension': {
				installed: true,
				enabled: true,
			},
		};

		await expect(
			invokeStudioExtensionHandler( ipcEvent, 'sample-extension', 'echo', 'first', 2 )
		).resolves.toBe( 'handled' );
		expect( mockExtensionHandler ).toHaveBeenCalledWith( ipcEvent, 'first', 2 );
	} );

	it( 'uninstalls extensions by removing the package and clearing enabled state', async () => {
		mockPackages.value = [ createPackage() ];
		mockUserData.value.extensions = {
			'sample-extension': {
				installed: true,
				enabled: true,
				installedPath: '/mock/extensions/sample-extension',
			},
		};

		await uninstallStudioExtension( ipcEvent, 'sample-extension' );

		expect( mockRemovePackage ).toHaveBeenCalledWith(
			'sample-extension',
			'/mock/extensions/sample-extension'
		);
		expect( saveUserData ).toHaveBeenCalledWith(
			expect.objectContaining( {
				extensions: {
					'sample-extension': expect.objectContaining( {
						installed: false,
						enabled: false,
						installedPath: undefined,
					} ),
				},
			} )
		);
	} );
} );
