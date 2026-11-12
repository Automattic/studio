import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { aiSettings, createFakeConnector } from '@/test/fake-connector';
import { hasConnectedProvider, useAiSettings } from './use-ai-settings';
import type { AiSettings } from '@studio/common/lib/ai-settings';

async function launch() {
	vi.resetModules();
	const { queryClient, persistPromise } = await import( '@/data/core/query-client' );
	await persistPromise;
	return queryClient;
}

function renderSettings( queryClient: QueryClient, settings: AiSettings ) {
	const connector = createFakeConnector();
	connector.getAiSettings.mockResolvedValue( settings );
	return renderHook( () => useAiSettings(), {
		wrapper: ( { children } ) => (
			<ConnectorProvider connector={ connector }>
				<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
			</ConnectorProvider>
		),
	} );
}

it( 'reads AI settings afresh at launch, so a previous build’s providers never reach the page', async () => {
	const previous = await launch();
	const { openai: _, ...accounts } = aiSettings().accounts;
	const settings = { provider: 'wpcom', accounts } as AiSettings;
	const before = renderSettings( previous, settings );
	await waitFor( () => expect( before.result.current.data ).toEqual( settings ) );
	previous.setQueryData( [ 'sites' ], [] );
	await waitFor( () =>
		expect( localStorage.getItem( 'REACT_QUERY_OFFLINE_CACHE' ) ).toContain( '"sites"' )
	);
	before.unmount();

	const { result } = renderSettings( await launch(), aiSettings( 'openai', [ 'openai' ] ) );

	await waitFor( () => expect( hasConnectedProvider( result.current.data ) ).toBe( true ) );
} );
