import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
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
			<div>
				{ activity?.kind === 'pending' || activity?.kind === 'error'
					? activity.message
					: activity?.kind }
			</div>
		</>
	);
}

describe( 'usePullSiteFromLive', () => {
	let finishPull: () => void;

	beforeEach( () => {
		vi.clearAllMocks();
		finishPull = () => {};
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: true },
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

	it( 'replaces connector details with an actionable pull error', async () => {
		const openStudioLogs = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: true },
			openStudioLogs,
			pullSiteFromLive: vi
				.fn()
				.mockRejectedValue(
					new Error(
						"Error invoking remote method 'pullSiteFromLive': CliCommandError: [Last error message] Failed to initiate backup: 500 status code"
					)
				),
		} as unknown as Connector );
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		render(
			<QueryClientProvider client={ queryClient }>
				<Harness />
			</QueryClientProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );

		const message =
			"Studio couldn't copy the live site. Try again. If the problem continues, check Studio Logs for details.";
		await waitFor( () => expect( screen.getByText( message ) ).toBeVisible() );
		expect( screen.queryByText( /Error invoking remote method/ ) ).not.toBeInTheDocument();
		expect( toast.error ).toHaveBeenCalledWith( "Pull didn't complete", {
			description: message,
			action: { label: 'Open Studio Logs', onClick: expect.any( Function ) },
		} );

		vi.mocked( toast.error ).mock.calls[ 0 ][ 1 ]?.action?.onClick();
		expect( openStudioLogs ).toHaveBeenCalled();
	} );

	it( 'omits the logs hint when the host has no Studio log file', async () => {
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: false },
			pullSiteFromLive: vi.fn().mockRejectedValue( new Error( 'nope' ) ),
		} as unknown as Connector );
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
			expect( toast.error ).toHaveBeenCalledWith( "Pull didn't complete", {
				description: "Studio couldn't copy the live site. Try again.",
				action: undefined,
			} )
		);
	} );
} );
