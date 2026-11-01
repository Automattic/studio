import { readSites } from '@studio/common/sites/site-path';
import { describe, expect, it, vi } from 'vitest';
import {
	areSameSiteOrigins,
	getHeadlessSiteOriginGroups,
	isSameSitePreviewOrigin,
	refreshHeadlessSiteOrigins,
} from 'src/lib/site-preview-origins';

vi.mock( '@studio/common/sites/site-path' );

const frontend = { path: '/sites/blog/frontend', kind: 'static', port: 3000 };

describe( 'getHeadlessSiteOriginGroups', () => {
	it( 'groups each headless site’s WordPress and frontend origins', () => {
		expect(
			getHeadlessSiteOriginGroups( [
				{ id: 'blog', path: '/sites/blog/wordpress', port: 8881, frontend },
				{ id: 'classic', path: '/sites/classic', port: 8882 },
				{
					id: 'domain',
					path: '/sites/domain/wordpress',
					port: 8883,
					customDomain: 'domain.local',
					frontend: { ...frontend, port: 3001 },
				},
			] )
		).toEqual( [
			[ 'http://localhost:3000', 'http://localhost:8881' ],
			[
				'http://localhost:3001',
				'http://localhost:8883',
				'http://domain.local',
				'https://domain.local',
			],
		] );
	} );

	it( 'skips a malformed frontend record', () => {
		expect(
			getHeadlessSiteOriginGroups( [
				{ id: 'x', path: '/x', port: 8881, frontend: { port: 'x' } },
			] )
		).toEqual( [] );
	} );
} );

describe( 'areSameSiteOrigins', () => {
	const groups = [ [ 'http://localhost:3000', 'http://localhost:8881' ] ];

	it( 'treats both origins of a headless site as one site', () => {
		expect(
			areSameSiteOrigins( groups, 'http://localhost:3000/blog/', 'http://localhost:8881/wp-admin/' )
		).toBe( true );
		expect(
			areSameSiteOrigins( groups, 'http://localhost:8881/?p=1', 'http://localhost:3000/' )
		).toBe( true );
	} );

	it( 'keeps every other origin a different site', () => {
		expect(
			areSameSiteOrigins( groups, 'http://localhost:8881/', 'http://localhost:8881/x' )
		).toBe( true );
		expect( areSameSiteOrigins( groups, 'http://localhost:3000/', 'https://example.com/' ) ).toBe(
			false
		);
		expect( areSameSiteOrigins( groups, 'http://localhost:8882/', 'http://localhost:3000/' ) ).toBe(
			false
		);
		expect( areSameSiteOrigins( [], 'http://localhost:8881/', 'http://localhost:3000/' ) ).toBe(
			false
		);
		expect( areSameSiteOrigins( groups, 'not a url', 'http://localhost:3000/' ) ).toBe( false );
	} );
} );

describe( 'isSameSitePreviewOrigin', () => {
	it( 'answers from the groups read by the last refresh', async () => {
		vi.mocked( readSites ).mockResolvedValueOnce( [
			{ id: 'blog', path: '/sites/blog/wordpress', port: 8881, frontend },
		] as never );
		await refreshHeadlessSiteOrigins();
		expect( isSameSitePreviewOrigin( 'http://localhost:3000/', 'http://localhost:8881/' ) ).toBe(
			true
		);

		vi.mocked( readSites ).mockRejectedValueOnce( new Error( 'unreadable' ) );
		await refreshHeadlessSiteOrigins();
		expect( isSameSitePreviewOrigin( 'http://localhost:3000/', 'http://localhost:8881/' ) ).toBe(
			true
		);

		vi.mocked( readSites ).mockResolvedValueOnce( [] as never );
		await refreshHeadlessSiteOrigins();
		expect( isSameSitePreviewOrigin( 'http://localhost:3000/', 'http://localhost:8881/' ) ).toBe(
			false
		);
		expect( readSites ).toHaveBeenCalledTimes( 3 );
	} );
} );
