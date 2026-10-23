import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from './use-connected-wpcom-sites';
import {
	openNewSession,
	primeSessionQueryData,
	SESSIONS_QUERY_KEY,
	useSessionLiveSite,
} from './use-sessions';
import type { AiSessionSummary, Connector, LoadedAiSession, SyncSite } from '@/data/core';

vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/data/core') >() ),
	useConnector: vi.fn(),
} ) );

describe( 'primeSessionQueryData', () => {
	it( 'upserts the summary into the sessions list newest-first', () => {
		const queryClient = new QueryClient();
		const older = createSummary( { id: 'older', updatedAt: '2026-06-25T12:00:00.000Z' } );
		const newer = createSummary( { id: 'newer', updatedAt: '2026-06-26T12:00:00.000Z' } );

		queryClient.setQueryData< AiSessionSummary[] >( SESSIONS_QUERY_KEY, [ older ] );

		primeSessionQueryData( queryClient, newer );

		expect(
			queryClient
				.getQueryData< AiSessionSummary[] >( SESSIONS_QUERY_KEY )
				?.map( ( session ) => session.id )
		).toEqual( [ 'newer', 'older' ] );
	} );

	it( 'seeds an empty loaded session without discarding existing entries', () => {
		const queryClient = new QueryClient();
		const summary = createSummary( { eventCount: 0 } );
		const sessionKey = [ ...SESSIONS_QUERY_KEY, summary.id ];

		primeSessionQueryData( queryClient, summary );
		expect( queryClient.getQueryData< LoadedAiSession >( sessionKey ) ).toEqual( {
			summary,
			entries: [],
		} );

		const entries = [ { type: 'custom', id: 'entry-1' } ] as LoadedAiSession[ 'entries' ];
		queryClient.setQueryData< LoadedAiSession >( sessionKey, { summary, entries } );

		const updatedSummary = createSummary( {
			id: summary.id,
			updatedAt: '2026-06-26T12:00:00.000Z',
			ownerSiteName: 'Updated Site',
		} );
		primeSessionQueryData( queryClient, updatedSummary );

		expect( queryClient.getQueryData< LoadedAiSession >( sessionKey ) ).toEqual( {
			summary: updatedSummary,
			entries,
		} );
	} );

	it( 'does not seed a loaded session shell when the summary already has entries', () => {
		const queryClient = new QueryClient();
		const summary = createSummary( { eventCount: 1 } );

		primeSessionQueryData( queryClient, summary );

		expect(
			queryClient.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, summary.id ] )
		).toBeUndefined();
	} );
} );

describe( 'openNewSession', () => {
	it( 'creates the session on the picked model and primes its cache while the transcript reconciles', async () => {
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn( queryClient, 'invalidateQueries' );
		const summary = createSummary( { eventCount: 0 } );
		const connector = {
			createSession: vi.fn( async () => summary ),
			setSessionModel: vi.fn( async () => undefined ),
		} as unknown as Connector;

		await expect(
			openNewSession( { connector, queryClient }, 'site-1', 'claude-opus-5' )
		).resolves.toBe( summary );

		expect( connector.createSession ).toHaveBeenCalledWith( 'site-1' );
		expect( connector.setSessionModel ).toHaveBeenCalledWith( 'session-1', 'claude-opus-5' );
		expect(
			queryClient.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )
		).toEqual( {
			summary,
			entries: [ expect.objectContaining( { type: 'model_change', modelId: 'claude-opus-5' } ) ],
		} );
		expect( invalidateQueries ).toHaveBeenCalledWith( {
			queryKey: SESSIONS_QUERY_KEY,
			exact: true,
		} );
		expect( invalidateQueries ).toHaveBeenCalledWith( {
			queryKey: [ ...SESSIONS_QUERY_KEY, 'session-1' ],
			exact: true,
		} );
	} );
} );

describe( 'useSessionLiveSite', () => {
	const production = { id: 1, url: 'https://example.wordpress.com' } as SyncSite;
	const staging = { id: 2, url: 'https://staging.example.wordpress.com' } as SyncSite;

	function getLiveSite( summary: Partial< AiSessionSummary > ) {
		vi.mocked( useConnector ).mockReturnValue( {} as Connector );
		const queryClient = new QueryClient();
		queryClient.setQueryData( connectedWpcomSitesQueryKey( 'site-1' ), [ production, staging ] );
		return renderHook( () => useSessionLiveSite( createSummary( summary ), 'site-1' ), {
			wrapper: ( { children }: { children: ReactNode } ) =>
				createElement( QueryClientProvider, { client: queryClient }, children ),
		} ).result.current;
	}

	it( "resolves a Live chat's selected remote", () => {
		expect( getLiveSite( { activeEnvironment: 'live', lastSelectedWpcomSiteId: 2 } ) ).toBe(
			staging
		);
	} );

	it( 'falls back to Local for a Local chat or a remote no longer connected', () => {
		expect(
			getLiveSite( { activeEnvironment: 'local', lastSelectedWpcomSiteId: 1 } )
		).toBeUndefined();
		expect(
			getLiveSite( { activeEnvironment: 'live', lastSelectedWpcomSiteId: 3 } )
		).toBeUndefined();
	} );
} );

function createSummary( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/tmp/session.jsonl',
		createdAt: '2026-06-26T11:00:00.000Z',
		updatedAt: '2026-06-26T11:00:00.000Z',
		ownerSitePath: '/Users/example/Studio/example-site',
		ownerSiteName: 'Example Site',
		activeEnvironment: 'local',
		eventCount: 1,
		...overrides,
	};
}
