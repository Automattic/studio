// To run tests, execute `npm run test -- src/hooks/tests/use-site-details.test.ts` from the root directory
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { vi, beforeAll } from 'vitest';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider, useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api' );

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
				subscribe: vi.fn().mockReturnValue( () => {} ),
			},
			writable: true,
		} );
	} );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			getSiteDetails: vi.fn().mockResolvedValue( mockSites ),
			startServer: vi.fn( () => Promise.resolve() ),
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
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				getSiteDetails: vi.fn().mockResolvedValue(
					mockSites.map( ( site ) => ( {
						...site,
						autoStart: false,
					} ) )
				),
				startServer: vi.fn( () => Promise.resolve() ),
			} );

			const { result } = renderHook( () => useSiteDetails(), { wrapper } );

			await waitFor( () => {
				expect( result.current.loadingSites ).toBe( false );
			} );

			// Verify that startServer was not called for any site
			expect( getIpcApi().startServer ).not.toHaveBeenCalled();
		} );
	} );
} );
