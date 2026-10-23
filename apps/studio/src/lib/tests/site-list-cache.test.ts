import { SITE_EVENTS, type SiteEvent, type SiteListItem } from '@studio/common/lib/cli-events';
import { vi } from 'vitest';
import { createSiteListCache, SITE_LIST_MAX_AGE_MS } from 'src/lib/site-list-cache';

vi.mock( 'src/modules/cli/lib/execute-command' );

function site( id: string, running = false ): SiteListItem {
	return {
		id,
		name: id,
		path: `/sites/${ id }`,
		port: 8881,
		url: 'http://localhost:8881',
		phpVersion: '8.3',
		running,
	};
}

function event( type: SITE_EVENTS, siteId: string, running = false, name = siteId ): SiteEvent {
	const { running: _, ...details } = site( siteId );
	return { event: type, siteId, running, site: { ...details, name } };
}

function setup( initial: SiteListItem[] = [ site( 'a' ) ] ) {
	let clock = 0;
	const fetchSites = vi.fn( async () => initial );
	const cache = createSiteListCache( fetchSites, () => clock );
	cache.setLive( true );
	return { cache, fetchSites, advance: ( ms: number ) => ( clock += ms ) };
}

describe( 'site list cache', () => {
	it( 'asks the CLI once while the events stream runs', async () => {
		const { cache, fetchSites } = setup();
		await cache.read();
		await cache.read();
		expect( fetchSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'asks the CLI every time without the events stream', async () => {
		const { cache, fetchSites } = setup();
		cache.setLive( false );
		await cache.read();
		await cache.read();
		expect( fetchSites ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'shares one CLI call between reads that overlap', async () => {
		const { cache, fetchSites } = setup();
		await Promise.all( [ cache.read(), cache.read() ] );
		expect( fetchSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'applies site events', async () => {
		const { cache, fetchSites } = setup();
		await cache.read();
		cache.applyEvent( event( SITE_EVENTS.UPDATED, 'a', true, 'renamed' ) );
		cache.applyEvent( event( SITE_EVENTS.CREATED, 'b' ) );
		expect( await cache.read() ).toEqual( [
			{ ...site( 'a', true ), name: 'renamed' },
			site( 'b' ),
		] );

		cache.applyEvent( { event: SITE_EVENTS.DELETED, siteId: 'a', running: false } );
		expect( await cache.read() ).toEqual( [ site( 'b' ) ] );
		expect( fetchSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'applies operation events to a site it has yet to list', async () => {
		const { cache, fetchSites } = setup();
		await cache.read();
		cache.applyEvent( event( SITE_EVENTS.OPERATIONS_CHANGED, 'b' ) );
		expect( await cache.read() ).toEqual( [ site( 'a' ), site( 'b' ) ] );
		expect( fetchSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'applies the events that arrive while the CLI is answering', async () => {
		const { cache, fetchSites } = setup();
		const reading = cache.read();
		cache.applyEvent( event( SITE_EVENTS.UPDATED, 'a', true ) );
		// A reader that heard of the event joins the answer that predates it.
		const joining = cache.read();
		expect( await reading ).toEqual( [ site( 'a', true ) ] );
		expect( await joining ).toEqual( [ site( 'a', true ) ] );
		expect( await cache.read() ).toEqual( [ site( 'a', true ) ] );
		expect( fetchSites ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'asks the CLI again after an event it cannot apply', async () => {
		const { cache, fetchSites } = setup();
		await cache.read();
		cache.applyEvent( { event: SITE_EVENTS.UPDATED, siteId: 'a', running: true } );
		await cache.read();
		expect( fetchSites ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'asks the CLI again once dropped', async () => {
		const { cache, fetchSites } = setup();
		await cache.read();
		cache.drop();
		await cache.read();
		expect( fetchSites ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'keeps no answer that was dropped while the CLI was answering', async () => {
		const { cache, fetchSites } = setup();
		const reading = cache.read();
		cache.drop();
		await reading;
		await cache.read();
		expect( fetchSites ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'asks the CLI again once the list is old', async () => {
		const { cache, fetchSites, advance } = setup();
		await cache.read();
		advance( SITE_LIST_MAX_AGE_MS );
		await cache.read();
		expect( fetchSites ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'asks the CLI again after a failed answer', async () => {
		const { cache, fetchSites } = setup();
		fetchSites.mockRejectedValueOnce( new Error( 'CLI failed' ) );
		await expect( cache.read() ).rejects.toThrow( 'CLI failed' );
		await cache.read();
		expect( fetchSites ).toHaveBeenCalledTimes( 2 );
	} );
} );
