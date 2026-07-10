import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useFindAvailableSitePath } from './use-create-site-helpers';
import { useWordPressVersions } from './use-wordpress-versions';
import type { Connector } from '@/data/core';
import type { ReactNode } from 'react';

function createWrapper( connector: Connector ) {
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false } },
	} );
	return function Wrapper( { children }: { children: ReactNode } ) {
		return (
			<QueryClientProvider client={ queryClient }>
				<ConnectorProvider connector={ connector }>{ children }</ConnectorProvider>
			</QueryClientProvider>
		);
	};
}

describe( 'site creation helper queries', () => {
	it( 'delegates available name and path lookup to the connector', async () => {
		const findAvailableSitePath = vi.fn().mockResolvedValue( {
			name: 'Portfolio 2',
			path: '/sites/portfolio-2',
		} );
		const connector = { findAvailableSitePath } as unknown as Connector;
		const { result } = renderHook( () => useFindAvailableSitePath(), {
			wrapper: createWrapper( connector ),
		} );

		await expect( result.current( 'Portfolio' ) ).resolves.toEqual( {
			name: 'Portfolio 2',
			path: '/sites/portfolio-2',
		} );
		expect( findAvailableSitePath ).toHaveBeenCalledWith( 'Portfolio' );
	} );

	it( 'loads installable WordPress versions through the connector', async () => {
		const versions = [ { label: '6.8', value: 'latest', isBeta: false, isDevelopment: false } ];
		const getWordPressVersions = vi.fn().mockResolvedValue( versions );
		const connector = { getWordPressVersions } as unknown as Connector;
		const { result } = renderHook( () => useWordPressVersions(), {
			wrapper: createWrapper( connector ),
		} );

		await waitFor( () => expect( result.current.data ).toEqual( versions ) );
		expect( getWordPressVersions ).toHaveBeenCalledOnce();
	} );
} );
