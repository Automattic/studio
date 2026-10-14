import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { themeDetailsQueryKey, useThemeDetails } from './use-theme-details';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

const blockTheme = {
	name: 'Twenty Twenty-Six',
	path: '/wp-content/themes/twentytwentysix',
	slug: 'twentytwentysix',
	isBlockTheme: true,
	supportsMenus: false,
	supportsWidgets: false,
};

const classicTheme = {
	name: 'Twenty Thirteen',
	path: '/wp-content/themes/twentythirteen',
	slug: 'twentythirteen',
	isBlockTheme: false,
	supportsMenus: true,
	supportsWidgets: true,
};

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Test site',
		running: true,
		...overrides,
	} as SiteDetails;
}

describe( 'useThemeDetails', () => {
	let queryClient: QueryClient;
	const getThemeDetails = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false } },
		} );
		useConnectorMock.mockReturnValue( { getThemeDetails } );
	} );

	afterEach( () => {
		Reflect.deleteProperty( document, 'startViewTransition' );
		vi.unstubAllGlobals();
	} );

	const wrapper = ( { children }: { children: ReactNode } ) => (
		<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
	);

	const switchTheme = async ( details: typeof classicTheme ) => {
		getThemeDetails.mockResolvedValue( details );
		await act( () =>
			queryClient.invalidateQueries( { queryKey: themeDetailsQueryKey( 'site-1' ) } )
		);
	};

	it( 'reads the theme through the host', async () => {
		getThemeDetails.mockResolvedValue( blockTheme );
		const { result } = renderHook( () => useThemeDetails( createSite() ), { wrapper } );

		expect( result.current ).toEqual( { state: 'loading' } );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: blockTheme } )
		);
		expect( getThemeDetails ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'reports an unknown theme when the host cannot read it', () => {
		useConnectorMock.mockReturnValue( {} );
		const { result } = renderHook( () => useThemeDetails( createSite() ), { wrapper } );

		expect( result.current ).toEqual( { state: 'unknown' } );
	} );

	it( 'transitions theme changes in both directions', async () => {
		getThemeDetails.mockResolvedValue( blockTheme );
		const startViewTransition = vi.fn( ( options: StartViewTransitionOptions ) => {
			void Promise.resolve().then( () => options.update?.() );
			return {
				finished: Promise.resolve(),
				ready: Promise.resolve(),
				updateCallbackDone: Promise.resolve(),
				types: new Set(),
				skipTransition: vi.fn(),
			} as unknown as ViewTransition;
		} );
		Object.defineProperty( document, 'startViewTransition', {
			configurable: true,
			value: startViewTransition,
		} );

		const { result } = renderHook( () => useThemeDetails( createSite() ), { wrapper } );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: blockTheme } )
		);
		startViewTransition.mockClear();

		await switchTheme( classicTheme );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: classicTheme } )
		);
		await switchTheme( blockTheme );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: blockTheme } )
		);

		expect( startViewTransition ).toHaveBeenCalledTimes( 2 );
		expect( startViewTransition ).toHaveBeenCalledWith( {
			types: [ 'theme-details' ],
			update: expect.any( Function ),
		} );
	} );

	it( 'updates without a transition when reduced motion is preferred', async () => {
		getThemeDetails.mockResolvedValue( blockTheme );
		const startViewTransition = vi.fn();
		Object.defineProperty( document, 'startViewTransition', {
			configurable: true,
			value: startViewTransition,
		} );
		vi.stubGlobal( 'matchMedia', vi.fn().mockReturnValue( { matches: true } ) );

		const { result } = renderHook( () => useThemeDetails( createSite() ), { wrapper } );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: blockTheme } )
		);
		await switchTheme( classicTheme );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: classicTheme } )
		);

		expect( startViewTransition ).not.toHaveBeenCalled();
	} );
} );
