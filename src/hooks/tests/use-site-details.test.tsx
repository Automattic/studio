/**
 * @jest-environment jsdom
 */
// To run tests, execute `npm run test -- src/hooks/tests/use-site-details.test.ts` from the root directory
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider, useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';

jest.mock( 'src/lib/get-ipc-api' );

const mockSites = [
	{
		id: 'site-1',
		name: 'Site 1',
		path: '/path/to/site1',
		port: 1234,
		phpVersion: '8.3',
		running: false,
		autoStart: true,
		themeDetails: undefined,
	},
	{
		id: 'site-2',
		name: 'Site 2',
		path: '/path/to/site2',
		port: 1235,
		phpVersion: '8.3',
		running: false,
		autoStart: false,
		themeDetails: undefined,
	},
	{
		id: 'site-3',
		name: 'Site 3',
		path: '/path/to/site3',
		port: 1236,
		phpVersion: '8.3',
		running: false,
		autoStart: true,
		themeDetails: undefined,
	},
];

const wrapper = ( { children }: { children: ReactNode } ) => (
	<Provider store={ store }>
		<ContentTabsProvider>
			<SiteDetailsProvider>{ children }</SiteDetailsProvider>
		</ContentTabsProvider>
	</Provider>
);

describe( 'useSiteDetails', () => {
	beforeAll( () => {
		Object.defineProperty( window, 'ipcListener', {
			value: {
				subscribe: jest.fn().mockReturnValue( () => {} ),
			},
			writable: true,
		} );
	} );

	beforeEach( () => {
		jest.clearAllMocks();
		( getIpcApi as jest.Mock ).mockReturnValue( {
			getSiteDetails: jest.fn().mockResolvedValue( mockSites ),
			startServer: jest.fn().mockResolvedValue( undefined ),
		} );
	} );

	describe( 'autoStart functionality', () => {
		it( 'should auto-start sites with autoStart flag set to true', async () => {
			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Verify that startServer was called for the sites with autoStart: true
			expect( getIpcApi().startServer ).toHaveBeenCalledWith( 'site-1' );
			expect( getIpcApi().startServer ).not.toHaveBeenCalledWith( 'site-2' );
			expect( getIpcApi().startServer ).toHaveBeenCalledWith( 'site-3' );
		} );

		it( 'should not auto-start sites if autoStart flag is false', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				getSiteDetails: jest.fn().mockResolvedValue(
					mockSites.map( ( site ) => ( {
						...site,
						autoStart: false,
					} ) )
				),
				startServer: jest.fn().mockResolvedValue( undefined ),
			} );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Verify that startServer was not called for any site
			expect( getIpcApi().startServer ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'it can handle permission related errors', () => {
		it( 'should show permission denied error message when PROXY_ERROR_PERMISSION_DENIED occurs', async () => {
			const mockShowErrorMessageBox = jest.fn();
			const mockStopServer = jest.fn();

			( getIpcApi as jest.Mock ).mockReturnValue( {
				getSiteDetails: jest.fn().mockResolvedValue( mockSites ),
				startServer: jest.fn().mockRejectedValue( new Error( 'PROXY_ERROR_PERMISSION_DENIED' ) ),
				showErrorMessageBox: mockShowErrorMessageBox,
				stopServer: mockStopServer,
			} );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Wait for error handling to complete
			await waitFor( () => {
				expect( mockShowErrorMessageBox ).toHaveBeenCalledWith( {
					title: 'Studio failed to initialize custom domains',
					message:
						'We could not create a custom domain for your site due to a lack of permissions. On Windows, Studio requires administrator privileges to bind to ports 80 and 443, which are necessary for custom domains to work properly.',
					showOpenLogs: false,
				} );
				expect( mockStopServer ).toHaveBeenCalled();
			} );
		} );
	} );
} );
