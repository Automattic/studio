import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_VERSION } from '@studio/common/lib/config/schema';
import { getConfigPath } from '@studio/common/lib/config/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	areSameSiteOrigins,
	getHeadlessSiteOriginGroups,
	isSameSitePreviewOrigin,
	refreshHeadlessSiteOrigins,
} from 'src/lib/site-preview-origins';

vi.unmock( 'atomically' );
vi.unmock( 'lockfile' );

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
	let configDir: string;
	const writeConfigFile = ( config: object ) =>
		writeFileSync( getConfigPath(), JSON.stringify( config ) );

	beforeEach( () => {
		configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-preview-origins-' ) );
		process.env.DEV_CONFIG_DIR = configDir;
	} );

	afterEach( () => {
		delete process.env.DEV_CONFIG_DIR;
		rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'answers from the groups read by the last refresh', async () => {
		writeConfigFile( {
			version: CONFIG_VERSION,
			sites: [
				{
					id: 'blog',
					name: 'Blog',
					path: '/sites/blog/wordpress',
					port: 8881,
					phpVersion: '8.3',
					frontend,
				},
			],
		} );
		await refreshHeadlessSiteOrigins();
		expect( isSameSitePreviewOrigin( 'http://localhost:3000/', 'http://localhost:8881/' ) ).toBe(
			true
		);

		// A config file this build can't read keeps the last known groups.
		writeConfigFile( { version: CONFIG_VERSION + 1 } );
		await refreshHeadlessSiteOrigins();
		expect( isSameSitePreviewOrigin( 'http://localhost:3000/', 'http://localhost:8881/' ) ).toBe(
			true
		);

		writeConfigFile( { version: CONFIG_VERSION, sites: [] } );
		await refreshHeadlessSiteOrigins();
		expect( isSameSitePreviewOrigin( 'http://localhost:3000/', 'http://localhost:8881/' ) ).toBe(
			false
		);
	} );
} );
