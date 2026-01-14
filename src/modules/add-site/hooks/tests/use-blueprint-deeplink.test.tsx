import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useBlueprintDeeplink } from 'src/modules/add-site/hooks/use-blueprint-deeplink';
import { store } from 'src/stores';

jest.mock( 'src/hooks/use-ipc-listener' );
jest.mock( 'src/lib/get-ipc-api' );

const wrapper = ( { children }: { children: React.ReactNode } ) => (
	<Provider store={ store }>{ children }</Provider>
);

describe( 'useBlueprintDeeplink', () => {
	const mockSetSelectedBlueprint = jest.fn();
	const mockSetPhpVersion = jest.fn();
	const mockSetWpVersion = jest.fn();
	const mockSetBlueprintPreferredVersions = jest.fn();
	const mockSetBlueprintDeeplinkWarnings = jest.fn();
	const mockSetIsDeeplinkFlow = jest.fn();
	let ipcCallback: ( event: unknown, data: unknown ) => Promise< void >;

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
		jest.clearAllMocks();
		jest.mocked( getIpcApi ).mockReturnValue( {
			readBlueprintFile: jest.fn(),
		} as Partial< ReturnType< typeof getIpcApi > > as ReturnType< typeof getIpcApi > );

		( useIpcListener as jest.Mock ).mockImplementation( ( event, callback ) => {
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

		const mockReadBlueprintFile = jest.fn().mockResolvedValue( mockBlueprintData );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			readBlueprintFile: mockReadBlueprintFile,
		} );

		renderBlueprintDeeplinkHook();

		await act( async () => {
			await ipcCallback!( null, {
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

		const mockReadBlueprintFile = jest.fn().mockResolvedValue( mockBlueprintData );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			readBlueprintFile: mockReadBlueprintFile,
		} );

		renderBlueprintDeeplinkHook();

		await act( async () => {
			await ipcCallback!( null, {
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

		const mockReadBlueprintFile = jest.fn().mockResolvedValue( mockBlueprintData );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			readBlueprintFile: mockReadBlueprintFile,
		} );

		renderBlueprintDeeplinkHook();

		await act( async () => {
			await ipcCallback!( null, {
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
		const mockReadBlueprintFile = jest.fn();
		( getIpcApi as jest.Mock ).mockReturnValue( {
			readBlueprintFile: mockReadBlueprintFile,
		} );

		renderBlueprintDeeplinkHook( true );

		await act( async () => {
			await ipcCallback!( null, {
				blueprintPath: '/path/to/blueprint.json',
				warnings: [],
			} );
		} );

		expect( mockReadBlueprintFile ).not.toHaveBeenCalled();
		expect( mockSetSelectedBlueprint ).not.toHaveBeenCalled();
	} );
} );
