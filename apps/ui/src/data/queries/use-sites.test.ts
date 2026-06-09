import { describe, expect, it } from 'vitest';
import { applySiteEventToCache } from './use-sites';
import type { SiteDetails, SiteEvent } from '@/data/core';

const sites: SiteDetails[] = [
	{
		id: 'site-1',
		name: 'First site',
		path: '/tmp/site-1',
		port: 8881,
		phpVersion: '8.4',
		running: false,
		siteIcon: 'data:image/png;base64,existing',
	},
	{
		id: 'site-2',
		name: 'Second site',
		path: '/tmp/site-2',
		port: 8882,
		phpVersion: '8.4',
		running: false,
	},
];

describe( 'applySiteEventToCache', () => {
	it( 'patches an existing site without dropping cached renderer-only fields', () => {
		const event: SiteEvent = {
			event: 'site-updated',
			siteId: 'site-1',
			running: true,
			site: {
				id: 'site-1',
				name: 'Renamed site',
				path: '/tmp/site-1',
				port: 9999,
				phpVersion: '8.4',
				url: 'http://localhost:9999',
			},
		};

		const nextSites = applySiteEventToCache( sites, event );

		expect( nextSites ).toHaveLength( 2 );
		expect( nextSites?.[ 0 ] ).toMatchObject( {
			id: 'site-1',
			name: 'Renamed site',
			port: 9999,
			running: true,
			siteIcon: 'data:image/png;base64,existing',
		} );
	} );

	it( 'adds newly created sites from event payloads', () => {
		const event: SiteEvent = {
			event: 'site-created',
			siteId: 'site-3',
			running: false,
			site: {
				id: 'site-3',
				name: 'Third site',
				path: '/tmp/site-3',
				port: 8883,
				phpVersion: '8.4',
			},
		};

		const nextSites = applySiteEventToCache( sites, event );

		expect( nextSites ).toHaveLength( 3 );
		expect( nextSites?.[ 2 ] ).toMatchObject( { id: 'site-3', name: 'Third site' } );
	} );

	it( 'removes deleted sites without refetching the full list', () => {
		const event: SiteEvent = {
			event: 'site-deleted',
			siteId: 'site-1',
			running: false,
		};

		const nextSites = applySiteEventToCache( sites, event );

		expect( nextSites ).toEqual( [ sites[ 1 ] ] );
	} );

	it( 'signals that callers should refetch when an upsert payload is missing site details', () => {
		const event: SiteEvent = {
			event: 'site-updated',
			siteId: 'site-1',
			running: true,
		};

		expect( applySiteEventToCache( sites, event ) ).toBeUndefined();
	} );
} );
