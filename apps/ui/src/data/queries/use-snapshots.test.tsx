import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SNAPSHOTS_QUERY_KEY, useSyncSnapshotsWithEvents } from './use-snapshots';
import type { Connector, Snapshot } from '@/data/core';
import type { SnapshotEvent } from '@studio/common/lib/cli-events';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/data/core') >() ),
	useConnector: vi.fn(),
} ) );

const preview = ( url: string, name: string ): Snapshot => ( {
	url,
	name,
	atomicSiteId: 1,
	localSiteId: 'site-1',
	date: 0,
} );

it( 'applies preview sites created, renamed or deleted anywhere to the cached list', () => {
	let emit: ( event: SnapshotEvent ) => void = () => {};
	vi.mocked( useConnector ).mockReturnValue( {
		onSnapshotEvent: ( listener: typeof emit ) => {
			emit = listener;
			return () => {};
		},
	} as unknown as Connector );
	const queryClient = new QueryClient();
	queryClient.setQueryData( SNAPSHOTS_QUERY_KEY, [ preview( 'a.wp.build', 'A' ) ] );
	renderHook( useSyncSnapshotsWithEvents, {
		wrapper: ( { children }: { children: ReactNode } ) => (
			<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
		),
	} );

	emit( {
		event: SNAPSHOT_EVENTS.CREATED,
		snapshotUrl: 'b.wp.build',
		snapshot: preview( 'b.wp.build', 'B' ),
	} );
	emit( {
		event: SNAPSHOT_EVENTS.UPDATED,
		snapshotUrl: 'a.wp.build',
		snapshot: preview( 'a.wp.build', 'Renamed' ),
	} );
	expect( queryClient.getQueryData( SNAPSHOTS_QUERY_KEY ) ).toEqual( [
		preview( 'b.wp.build', 'B' ),
		preview( 'a.wp.build', 'Renamed' ),
	] );

	emit( { event: SNAPSHOT_EVENTS.DELETED, snapshotUrl: 'b.wp.build' } );
	expect( queryClient.getQueryData( SNAPSHOTS_QUERY_KEY ) ).toEqual( [
		preview( 'a.wp.build', 'Renamed' ),
	] );
} );
