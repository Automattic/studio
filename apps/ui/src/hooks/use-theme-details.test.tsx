import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { refreshThemeDetails, themeDetailsQueryKey, useThemeDetails } from './use-theme-details';
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
		themeDetails: blockTheme,
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

	it( 'refreshes persisted theme details whenever the window regains focus', async () => {
		getThemeDetails.mockResolvedValue( classicTheme );
		const { result } = renderHook( () => useThemeDetails( createSite() ), { wrapper } );

		expect( result.current ).toEqual( { state: 'ready', details: blockTheme } );
		expect( getThemeDetails ).not.toHaveBeenCalled();

		await act( () => window.dispatchEvent( new Event( 'focus' ) ) );

		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: classicTheme } )
		);
		expect( getThemeDetails ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'does not refresh a stopped site', async () => {
		const { result } = renderHook( () => useThemeDetails( createSite( { running: false } ) ), {
			wrapper,
		} );

		await act( () => window.dispatchEvent( new Event( 'focus' ) ) );

		expect( result.current ).toEqual( { state: 'ready', details: blockTheme } );
		expect( getThemeDetails ).not.toHaveBeenCalled();
	} );

	it( 'transitions theme changes in both directions', async () => {
		getThemeDetails.mockResolvedValueOnce( classicTheme ).mockResolvedValueOnce( blockTheme );
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
		await act( () => window.dispatchEvent( new Event( 'focus' ) ) );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: classicTheme } )
		);

		expect( startViewTransition ).toHaveBeenCalledWith( {
			types: [ 'theme-details' ],
			update: expect.any( Function ),
		} );
		expect( queryClient.getQueryData( themeDetailsQueryKey( 'site-1' ) ) ).toEqual( classicTheme );

		await act( () => window.dispatchEvent( new Event( 'focus' ) ) );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: blockTheme } )
		);
		expect( startViewTransition ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'updates without a transition when reduced motion is preferred', async () => {
		getThemeDetails.mockResolvedValue( classicTheme );
		const startViewTransition = vi.fn();
		Object.defineProperty( document, 'startViewTransition', {
			configurable: true,
			value: startViewTransition,
		} );
		vi.stubGlobal( 'matchMedia', vi.fn().mockReturnValue( { matches: true } ) );

		const { result } = renderHook( () => useThemeDetails( createSite() ), { wrapper } );
		await act( () => window.dispatchEvent( new Event( 'focus' ) ) );
		await waitFor( () =>
			expect( result.current ).toEqual( { state: 'ready', details: classicTheme } )
		);

		expect( startViewTransition ).not.toHaveBeenCalled();
	} );

	it( 'does not let an older refresh overwrite newer theme details', async () => {
		let resolveFirstRefresh!: ( details: typeof classicTheme ) => void;
		const firstRefresh = new Promise< typeof classicTheme >( ( resolve ) => {
			resolveFirstRefresh = resolve;
		} );
		getThemeDetails.mockReturnValueOnce( firstRefresh ).mockResolvedValueOnce( blockTheme );

		const older = refreshThemeDetails( { getThemeDetails } as never, queryClient, 'site-1' );
		const newer = refreshThemeDetails( { getThemeDetails } as never, queryClient, 'site-1' );
		await newer;
		resolveFirstRefresh( classicTheme );
		await older;

		expect( queryClient.getQueryData( themeDetailsQueryKey( 'site-1' ) ) ).toEqual( blockTheme );
	} );
} );
