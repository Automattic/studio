import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { usePullSiteFromLive } from './use-sync-site';
import type { Connector } from '@/data/core';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: vi.fn() };
} );

vi.mock( '@/data/app-messages', () => ( {
	toast: { success: vi.fn(), error: vi.fn() },
} ) );

const useConnectorMock = vi.mocked( useConnector );

function Harness() {
	const pull = usePullSiteFromLive();
	const activity = useSiteSyncActivity( 'site-1' );
	return (
		<>
			<button type="button" onClick={ () => pull.mutate( { siteId: 'site-1', remoteSiteId: 42 } ) }>
				Pull
			</button>
			<div>{ activity?.kind === 'pending' ? activity.message : activity?.kind }</div>
		</>
	);
}

describe( 'usePullSiteFromLive', () => {
	let finishPull: () => void;

	beforeEach( () => {
		vi.clearAllMocks();
		finishPull = () => {};
		useConnectorMock.mockReturnValue( {
			pullSiteFromLive: vi.fn( async ( _siteId, _remoteSiteId, onProgress ) => {
				onProgress?.( { message: 'Creating remote backup… (24%)', progress: 24 } );
				await new Promise< void >( ( resolve ) => {
					finishPull = resolve;
				} );
			} ),
		} as unknown as Connector );
	} );

	it( 'publishes CLI progress outside the component that started the pull', async () => {
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		render(
			<QueryClientProvider client={ queryClient }>
				<Harness />
			</QueryClientProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );
		await waitFor( () =>
			expect( screen.getByText( 'Creating remote backup… (24%)' ) ).toBeVisible()
		);

		finishPull();
		await waitFor( () => expect( screen.getByText( 'success' ) ).toBeVisible() );
	} );
} );
