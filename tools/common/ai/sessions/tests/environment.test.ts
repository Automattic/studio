import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActiveSiteFromEntries } from '../active-site';
import { deriveEffectiveEnvironment } from '../effective-site';
import { appendStudioEntry, createAiSession, loadAiSession } from '../store';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

describe( 'site.selected — environment flips', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	it( 'summary defaults activeEnvironment to "local" when no flip has happened', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-env-' ) );
		const summary = await createAiSession( rootDirectory, {
			site: { name: 'My Site', path: '/tmp/my-site' },
		} );
		expect( summary.activeEnvironment ).toBe( 'local' );
		expect( summary.lastSelectedWpcomSiteId ).toBeUndefined();
	} );

	it( 'summary reflects the latest studio.site_selected flipping to live', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-env-' ) );
		const created = await createAiSession( rootDirectory, {
			site: { name: 'My Site', path: '/tmp/my-site' },
		} );

		await appendStudioEntry( rootDirectory, created.id, 'studio.site_selected', {
			siteName: 'My Site',
			sitePath: '/tmp/my-site',
			remote: true,
			url: 'https://mysite.example',
			wpcomSiteId: 42,
		} );

		const { summary } = await loadAiSession( rootDirectory, created.id );
		expect( summary.activeEnvironment ).toBe( 'live' );
		expect( summary.lastSelectedWpcomSiteId ).toBe( 42 );
		expect( summary.ownerSitePath ).toBeUndefined();
	} );

	it( 'resolver preserves owner name/path when flipping to live', () => {
		const entries: SessionEntry[] = [
			{
				type: 'custom',
				id: 'a',
				parentId: null,
				timestamp: '2026-04-20T10:00:00.000Z',
				customType: 'studio.site_selected',

				data: { siteName: 'My Site', sitePath: '/tmp/my-site' } as never,
			},
			{
				type: 'custom',
				id: 'b',
				parentId: 'a',
				timestamp: '2026-04-20T10:01:00.000Z',
				customType: 'studio.site_selected',

				data: {
					siteName: 'My Site',
					sitePath: '/tmp/my-site',
					remote: true,
					url: 'https://mysite.example',
					wpcomSiteId: 42,
				} as never,
			},
		];

		expect( resolveActiveSiteFromEntries( entries ) ).toEqual( {
			name: 'My Site',
			path: '/tmp/my-site',
			remote: true,
			url: 'https://mysite.example',
			wpcomSiteId: 42,
		} );
	} );

	it( 'resolver clears live endpoint info when flipping back to local', () => {
		const entries: SessionEntry[] = [
			{
				type: 'custom',
				id: 'a',
				parentId: null,
				timestamp: '2026-04-20T10:00:00.000Z',
				customType: 'studio.site_selected',

				data: {
					siteName: 'My Site',
					sitePath: '/tmp/my-site',
					remote: true,
					url: 'https://mysite.example',
					wpcomSiteId: 42,
				} as never,
			},
			{
				type: 'custom',
				id: 'b',
				parentId: 'a',
				timestamp: '2026-04-20T10:01:00.000Z',
				customType: 'studio.site_selected',

				data: { siteName: 'My Site', sitePath: '/tmp/my-site' } as never,
			},
		];

		expect( resolveActiveSiteFromEntries( entries ) ).toEqual( {
			name: 'My Site',
			path: '/tmp/my-site',
			remote: false,
			url: undefined,
			wpcomSiteId: undefined,
		} );
	} );
} );

describe( 'deriveEffectiveEnvironment', () => {
	it( 'returns local for local sessions', () => {
		expect( deriveEffectiveEnvironment( { activeEnvironment: 'local' }, () => true ) ).toBe(
			'local'
		);
	} );

	it( 'returns live when the connection still exists', () => {
		expect(
			deriveEffectiveEnvironment(
				{ activeEnvironment: 'live', lastSelectedWpcomSiteId: 42 },
				( blogId ) => blogId === 42
			)
		).toBe( 'live' );
	} );

	it( 'falls back to local when the live connection is gone', () => {
		expect(
			deriveEffectiveEnvironment(
				{ activeEnvironment: 'live', lastSelectedWpcomSiteId: 42 },
				() => false
			)
		).toBe( 'local' );
	} );

	it( 'falls back to local when activeEnvironment is live but no wpcomSiteId is recorded', () => {
		expect(
			deriveEffectiveEnvironment(
				{ activeEnvironment: 'live', lastSelectedWpcomSiteId: undefined },
				() => true
			)
		).toBe( 'local' );
	} );
} );
