import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActiveSiteFromEvents } from '../active-site';
import { appendAiSessionEvent, createAiSession, loadAiSession } from '../store';
import type { AiSessionEvent } from '../types';

describe( 'environment.selected', () => {
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
	} );

	it( 'summary reflects the latest environment.selected event', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-env-' ) );
		const created = await createAiSession( rootDirectory, {
			site: { name: 'My Site', path: '/tmp/my-site' },
		} );

		await appendAiSessionEvent( rootDirectory, created.id, {
			type: 'environment.selected',
			timestamp: new Date().toISOString(),
			environment: 'live',
			url: 'https://mysite.example',
			wpcomSiteId: 42,
		} );

		const { summary } = await loadAiSession( rootDirectory, created.id );
		expect( summary.activeEnvironment ).toBe( 'live' );
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
				type: 'environment.selected',
				timestamp: '2026-04-20T10:01:00.000Z',
				environment: 'live',
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
			},
			{
				type: 'environment.selected',
				timestamp: '2026-04-20T10:01:00.000Z',
				environment: 'live',
				url: 'https://mysite.example',
				wpcomSiteId: 42,
			},
			{
				type: 'environment.selected',
				timestamp: '2026-04-20T10:02:00.000Z',
				environment: 'local',
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

	it( 'resolver ignores environment.selected with no prior site.selected', () => {
		const events: AiSessionEvent[] = [
			{
				type: 'environment.selected',
				timestamp: '2026-04-20T10:00:00.000Z',
				environment: 'live',
				url: 'https://orphan.example',
			},
		];

		expect( resolveActiveSiteFromEvents( events ) ).toBeUndefined();
	} );
} );
