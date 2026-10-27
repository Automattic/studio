import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { createFakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { useSyncSnapshotsWithEvents } from './use-snapshots';
import { SNAPSHOTS_QUERY_KEY } from './user-scoped-query-keys';
import type { Snapshot } from '@/data/core';
import type { SnapshotEvent } from '@studio/common/lib/cli-events';
import type { ReactNode } from 'react';

const preview = ( url: string, name: string ): Snapshot => ( {
	url,
	name,
	atomicSiteId: 1,
	localSiteId: 'site-1',
	date: 0,
} );

it( 'applies preview sites created, renamed or deleted anywhere to the cached list', () => {
	const connector = createFakeConnector();
	const emit = ( event: SnapshotEvent ) => connector.emit( 'onSnapshotEvent', event );
	const queryClient = createTestQueryClient();
	queryClient.setQueryData( SNAPSHOTS_QUERY_KEY, [ preview( 'a.wp.build', 'A' ) ] );
	renderHook( useSyncSnapshotsWithEvents, {
		wrapper: ( { children }: { children: ReactNode } ) => (
			<ConnectorProvider connector={ connector }>
				<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
			</ConnectorProvider>
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
