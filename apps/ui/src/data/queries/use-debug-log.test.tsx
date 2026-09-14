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

function createConnector( openInOS: boolean, siteDebugLogExists: () => Promise< boolean > ) {
	return { capabilities: { openInOS }, siteDebugLogExists } as unknown as Connector;
}

describe( 'useDebugLogExists', () => {
	it( 'checks for the log where the host can open files', async () => {
		const siteDebugLogExists = vi.fn().mockResolvedValue( true );
		const { result } = renderHook( () => useDebugLogExists( 'site-1' ), {
			wrapper: createWrapper( createConnector( true, siteDebugLogExists ) ),
		} );

		await waitFor( () => expect( result.current.data ).toBe( true ) );
		expect( siteDebugLogExists ).toHaveBeenCalledWith( 'site-1' );
	} );

	// Hosted rejects this call, so the capability gate is what keeps it unasked.
	it( 'never asks a host that cannot open files', async () => {
		const siteDebugLogExists = vi.fn().mockRejectedValue( new Error( 'Unsupported' ) );
		const { result } = renderHook( () => useDebugLogExists( 'site-1' ), {
			wrapper: createWrapper( createConnector( false, siteDebugLogExists ) ),
		} );

		expect( siteDebugLogExists ).not.toHaveBeenCalled();
		expect( result.current.data ).toBeUndefined();
		expect( result.current.isError ).toBe( false );
	} );
} );
