import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionMetadata } from '@studio/common/lib/session-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getCreatedSiteFromArtifact,
	hydrateAiSessionSummaryWithPlacement,
	setAiSessionSitePlacement,
} from '@studio/agent/node/sessions/placement';
import type { StudioChatArtifactData } from '@studio/agent/protocol/chat-artifacts';
import type { AiSessionSummary } from '@studio/agent/protocol/sessions/types';

describe( 'ai session placement (shared)', () => {
	let configDir: string;

	beforeEach( () => {
		configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-placement-' ) );
		process.env.DEV_CONFIG_DIR = configDir;
	} );

	afterEach( () => {
		delete process.env.DEV_CONFIG_DIR;
		rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'stores the site placement with the session metadata', async () => {
		const placement = await setAiSessionSitePlacement( 'session-1', {
			siteId: 'site-1',
			sitePath: '/sites/site-1',
			siteName: 'Site One',
		} );

		expect( placement ).toEqual( {
			kind: 'site',
			siteId: 'site-1',
			sitePath: '/sites/site-1',
			siteName: 'Site One',
		} );
		await expect( readSessionMetadata( 'session-1' ) ).resolves.toEqual( { placement } );
	} );

	it( 'hydrates owner fields only from placement', () => {
		const summary = {
			id: 'session-1',
			filePath: '/sessions/session-1.jsonl',
			createdAt: '2026-05-13T00:00:00.000Z',
			updatedAt: '2026-05-13T00:00:00.000Z',
			ownerSiteId: 'ignored-from-jsonl',
			ownerSitePath: '/ignored/from-jsonl',
			ownerSiteName: 'Ignored',
			activeEnvironment: 'local',
			eventCount: 1,
		} satisfies AiSessionSummary;

		expect( hydrateAiSessionSummaryWithPlacement( summary ) ).toMatchObject( {
			ownerSiteId: undefined,
			ownerSitePath: undefined,
			ownerSiteName: undefined,
		} );
		expect(
			hydrateAiSessionSummaryWithPlacement( summary, {
				kind: 'site',
				siteId: 'site-1',
				sitePath: '/sites/site-1',
				siteName: 'Site One',
			} )
		).toMatchObject( {
			ownerSiteId: 'site-1',
			ownerSitePath: '/sites/site-1',
			ownerSiteName: 'Site One',
		} );
	} );

	it( 'extracts a created site from a site-preview artifact', () => {
		const artifact = {
			widgets: [
				{ type: 'site-preview', widgetProps: { siteId: 's', sitePath: '/p', siteName: 'N' } },
			],
		} as unknown as StudioChatArtifactData;

		expect( getCreatedSiteFromArtifact( artifact ) ).toEqual( {
			siteId: 's',
			sitePath: '/p',
			siteName: 'N',
		} );
		expect(
			getCreatedSiteFromArtifact( { widgets: [] } as unknown as StudioChatArtifactData )
		).toBeUndefined();
	} );
} );
