import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useDebugLogExists } from './use-debug-log';
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

function createConnector( siteDebugLogExists: () => Promise< boolean > ) {
	return { siteDebugLogExists } as unknown as Connector;
}

describe( 'useDebugLogExists', () => {
	it( 'checks whether the site has a debug log', async () => {
		const siteDebugLogExists = vi.fn().mockResolvedValue( true );
		const { result } = renderHook( () => useDebugLogExists( 'site-1' ), {
			wrapper: createWrapper( createConnector( siteDebugLogExists ) ),
		} );

		await waitFor( () => expect( result.current.data ).toBe( true ) );
		expect( siteDebugLogExists ).toHaveBeenCalledWith( 'site-1' );
	} );
} );
