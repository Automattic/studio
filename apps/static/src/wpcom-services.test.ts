import { LIVE_CHANGED_CODE } from '@studio/common/lib/sync/live-changes';
import { getProviderServices } from '@studio/providers/services';
import { describe, expect, it, vi } from 'vitest';
import { kvGet } from './store';
import { WpcomServices } from './wpcom-services';
import type { StaticSites } from './sites';
import type { WpcomAuth } from './wpcom-auth';
import type { SyncEvent } from '@studio/common/lib/sync/activity';

vi.mock( './store' );
vi.mock( './site-data' );

describe( 'WpcomServices.push', () => {
	it( 'starts the push before refusing live changes, so the panel shows the refusal', async () => {
		vi.mocked( kvGet ).mockResolvedValue( [
			{
				id: 42,
				localSiteId: 'local',
				name: 'Live',
				lastPullTimestamp: '2026-11-01T10:00:00.000Z',
				lastPushTimestamp: null,
				lastDatabaseSyncTimestamp: '2026-11-01T10:00:00.000Z',
			},
		] );
		vi.spyOn( getProviderServices( 'wpcom' ).sites!, 'liveChanges' ).mockResolvedValue( {
			posts: 1,
			comments: 0,
			siteDesign: 0,
		} );
		const auth = {
			user: async () => ( { id: 1 } ),
			requireToken: async () => 'token',
		} as unknown as WpcomAuth;
		const services = new WpcomServices( auth, {} as StaticSites );
		const events: SyncEvent[] = [];
		services.onSyncActivity( ( event ) => events.push( event ) );

		await expect( services.push( 'local', 42 ) ).rejects.toThrow( 'Live has 1 content change' );

		expect( events.map( ( { activity } ) => activity ) ).toEqual( [
			{ kind: 'pending', direction: 'push', remoteSiteId: 42 },
			expect.objectContaining( { kind: 'error', direction: 'push', code: LIVE_CHANGED_CODE } ),
		] );
	} );
} );
