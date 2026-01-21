import { IpcRendererEvent } from 'electron';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { createMock } from 'src/lib/test-utils';
import { useBlueprintDeeplink } from 'src/modules/add-site/hooks/use-blueprint-deeplink';
import { store } from 'src/stores';

vi.mock( 'src/hooks/use-ipc-listener' );
vi.mock( 'src/lib/get-ipc-api' );

const wrapper = ( { children }: { children: React.ReactNode } ) => (
	<Provider store={ store }>{ children }</Provider>
);

describe.skip( 'useBlueprintDeeplink', () => {
	const mockSetSelectedBlueprint = vi.fn();
	const mockSetPhpVersion = vi.fn();
	const mockSetWpVersion = vi.fn();
	const mockSetBlueprintPreferredVersions = vi.fn();
	const mockSetBlueprintDeeplinkWarnings = vi.fn();
	const mockSetIsDeeplinkFlow = vi.fn();
	let ipcCallback: Parameters< typeof useIpcListener >[ 1 ];

	const renderBlueprintDeeplinkHook = ( isAnySiteProcessing = false ) => {
		return renderHook(
			() =>
				useBlueprintDeeplink( {
					isAnySiteProcessing,
					setSelectedBlueprint: mockSetSelectedBlueprint,
					setPhpVersion: mockSetPhpVersion,
					setWpVersion: mockSetWpVersion,
					setBlueprintPreferredVersions: mockSetBlueprintPreferredVersions,
					setBlueprintDeeplinkWarnings: mockSetBlueprintDeeplinkWarnings,
					setIsDeeplinkFlow: mockSetIsDeeplinkFlow,
				} ),
			{ wrapper }
		);
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			readBlueprintFile: vi.fn(),
		} );

		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
			if ( event === 'add-site-with-blueprint' ) {
				ipcCallback = callback;
			}
		} );
	} );

	it( 'should register IPC listener for add-site-with-blueprint event', () => {
		renderBlueprintDeeplinkHook();

		expect( useIpcListener ).toHaveBeenCalledWith(
			'add-site-with-blueprint',
			expect.any( Function )
		);
	} );

	it( 'should handle blueprint deeplink event and set state correctly', async () => {
		const mockBlueprintData = {
			steps: [ { step: 'login' } ],
			meta: { title: 'Test Blueprint', description: 'A test blueprint' },
		};

		const mockReadBlueprintFile = vi.fn().mockResolvedValue( mockBlueprintData );
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			readBlueprintFile: mockReadBlueprintFile,
		} );

		renderBlueprintDeeplinkHook();

		await act( async () => {
			await ipcCallback!( createMock< IpcRendererEvent >( {} ), {
				blueprintPath: '/path/to/blueprint.json',
				warnings: [],
			} );
		} );

		expect( mockReadBlueprintFile ).toHaveBeenCalledWith( '/path/to/blueprint.json' );
		expect( mockSetSelectedBlueprint ).toHaveBeenCalledWith(
			expect.objectContaining( {
				slug: 'file:blueprint.json',
				title: 'Test Blueprint',
				excerpt: 'A test blueprint',
				blueprint: mockBlueprintData,
			} )
		);
		expect( mockSetBlueprintDeeplinkWarnings ).toHaveBeenCalledWith( [] );
		expect( mockSetIsDeeplinkFlow ).toHaveBeenCalledWith( true );
	} );

	it( 'should set PHP and WP versions when preferredVersions are specified', async () => {
		const mockBlueprintData = {
			steps: [],
			preferredVersions: {
				php: '8.0',
				wp: '6.4',
			},
		};

		const mockReadBlueprintFile = vi.fn().mockResolvedValue( mockBlueprintData );
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			readBlueprintFile: mockReadBlueprintFile,
		} );

		renderBlueprintDeeplinkHook();

		await act( async () => {
			await ipcCallback!( createMock< IpcRendererEvent >( {} ), {
				blueprintPath: '/path/to/blueprint.json',
				warnings: [],
			} );
		} );

		expect( mockSetBlueprintPreferredVersions ).toHaveBeenCalledWith( {
			php: '8.0',
			wp: '6.4',
		} );
		expect( mockSetPhpVersion ).toHaveBeenCalledWith( '8.0' );
		expect( mockSetWpVersion ).toHaveBeenCalledWith( '6.4' );
	} );

	it( 'should not set PHP/WP versions when they are "latest"', async () => {
		const mockBlueprintData = {
			steps: [],
			preferredVersions: {
				php: 'latest',
				wp: 'latest',
			},
		};

		const mockReadBlueprintFile = vi.fn().mockResolvedValue( mockBlueprintData );
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			readBlueprintFile: mockReadBlueprintFile,
		} );

		renderBlueprintDeeplinkHook();

		await act( async () => {
			await ipcCallback!( createMock< IpcRendererEvent >( {} ), {
				blueprintPath: '/path/to/blueprint.json',
				warnings: [],
			} );
		} );

		expect( mockSetBlueprintPreferredVersions ).toHaveBeenCalledWith( {
			php: 'latest',
			wp: 'latest',
		} );
		expect( mockSetPhpVersion ).not.toHaveBeenCalled();
		expect( mockSetWpVersion ).not.toHaveBeenCalled();
	} );

	it( 'should not process event when site is processing', async () => {
		const mockReadBlueprintFile = vi.fn();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			readBlueprintFile: mockReadBlueprintFile,
		} );

		renderBlueprintDeeplinkHook( true );

		await act( async () => {
			await ipcCallback!( createMock< IpcRendererEvent >( {} ), {
				blueprintPath: '/path/to/blueprint.json',
				warnings: [],
			} );
		} );

		expect( mockReadBlueprintFile ).not.toHaveBeenCalled();
		expect( mockSetSelectedBlueprint ).not.toHaveBeenCalled();
	} );
} );
