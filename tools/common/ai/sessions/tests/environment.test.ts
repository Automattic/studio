import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActiveSiteFromEvents } from '../active-site';
import { deriveEffectiveEnvironment } from '../effective-site';
import { appendAiSessionEvent, createAiSession, loadAiSession } from '../store';
import type { AiSessionEvent } from '../types';

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

	it( 'summary reflects the latest site.selected flipping to live', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-env-' ) );
		const created = await createAiSession( rootDirectory, {
			site: { name: 'My Site', path: '/tmp/my-site' },
		} );

		await appendAiSessionEvent( rootDirectory, created.id, {
			type: 'site.selected',
			timestamp: new Date().toISOString(),
			siteName: 'My Site',
			sitePath: '/tmp/my-site',
			remote: true,
			url: 'https://mysite.example',
			wpcomSiteId: 42,
		} );

		const { summary } = await loadAiSession( rootDirectory, created.id );
		expect( summary.activeEnvironment ).toBe( 'live' );
		expect( summary.lastSelectedWpcomSiteId ).toBe( 42 );
		expect( summary.ownerSitePath ).toBe( '/tmp/my-site' );
	} );

	it( 'resolver preserves owner name/path when flipping to live', () => {
		const events: AiSessionEvent[] = [
			{
				type: 'site.selected',
				timestamp: '2026-04-20T10:00:00.000Z',
				siteName: 'My Site',
				sitePath: '/tmp/my-site',
			},
			{
				type: 'site.selected',
				timestamp: '2026-04-20T10:01:00.000Z',
				siteName: 'My Site',
				sitePath: '/tmp/my-site',
				remote: true,
				url: 'https://mysite.example',
				wpcomSiteId: 42,
			},
		];

		expect( resolveActiveSiteFromEvents( events ) ).toEqual( {
			name: 'My Site',
			path: '/tmp/my-site',
			remote: true,
			url: 'https://mysite.example',
			wpcomSiteId: 42,
		} );
	} );

	it( 'resolver clears live endpoint info when flipping back to local', () => {
		const events: AiSessionEvent[] = [
			{
				type: 'site.selected',
				timestamp: '2026-04-20T10:00:00.000Z',
				siteName: 'My Site',
				sitePath: '/tmp/my-site',
				remote: true,
				url: 'https://mysite.example',
				wpcomSiteId: 42,
			},
			{
				type: 'site.selected',
				timestamp: '2026-04-20T10:01:00.000Z',
				siteName: 'My Site',
				sitePath: '/tmp/my-site',
			},
		];

		expect( resolveActiveSiteFromEvents( events ) ).toEqual( {
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
