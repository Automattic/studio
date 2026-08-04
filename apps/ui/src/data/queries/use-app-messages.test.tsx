import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUsageExplorationScenario } from '@/data/usage-exploration';
import { useActivePersistentMessages } from './use-app-messages';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( { installAppUpdate: vi.fn() } ),
} ) );

vi.mock( '@/data/queries/use-app-update', () => ( {
	useAppUpdateStatus: () => ( { data: undefined } ),
} ) );

describe( 'useActivePersistentMessages usage notices', () => {
	let queryClient: QueryClient;

	beforeEach( () => {
		queryClient = new QueryClient( { defaultOptions: { queries: { retry: false } } } );
		setUsageExplorationScenario( 'healthy' );
	} );

	function wrapper( { children }: { children: ReactNode } ) {
		return <QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>;
	}

	it( 'adds a dismissible notice after 80% usage', () => {
		setUsageExplorationScenario( 'warning' );
		const { result } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		expect( result.current.messages ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					id: 'ai-credits:warning',
					title: 'At 80% usage',
				} ),
			] )
		);
	} );

	it( 'leaves the exhausted state to the chat surface', () => {
		setUsageExplorationScenario( 'exhausted' );
		const { result } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		expect( result.current.messages ).toEqual( [] );
	} );

	it( 'uses the purchased-credit pool for top-up warnings', () => {
		setUsageExplorationScenario( 'extra-warning' );
		const { result } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		expect( result.current.messages ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					id: 'ai-credits:warning',
					title: 'At 80% extra credit usage',
				} ),
			] )
		);
	} );

	it( 'does not warn while purchased credits are still in reserve', () => {
		setUsageExplorationScenario( 'extra-reserve' );
		const { result } = renderHook( () => useActivePersistentMessages(), { wrapper } );

		expect( result.current.messages ).toEqual( [] );
	} );
} );
