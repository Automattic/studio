import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	deleteAiSessionPlacement,
	hydrateAiSessionSummaryWithPlacement,
	readAiSessionPlacements,
	setAiSessionSitePlacement,
} from 'src/lib/ai-session-placement';
import { EMPTY_USER_DATA, type UserData } from 'src/storage/storage-types';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	lockAppdata: vi.fn(),
	saveUserData: vi.fn(),
	unlockAppdata: vi.fn(),
} ) );

describe( 'ai session placement', () => {
	let userData: UserData;

	beforeEach( () => {
		userData = structuredClone( EMPTY_USER_DATA );
		vi.mocked( loadUserData ).mockImplementation( async () => structuredClone( userData ) );
		vi.mocked( saveUserData ).mockImplementation( async ( nextUserData ) => {
			userData = structuredClone( nextUserData );
		} );
		vi.mocked( lockAppdata ).mockResolvedValue( undefined );
		vi.mocked( unlockAppdata ).mockResolvedValue( undefined );
	} );

	it( 'stores site placements in appdata', async () => {
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
		await expect( readAiSessionPlacements() ).resolves.toEqual( {
			'session-1': placement,
		} );
		expect( lockAppdata ).toHaveBeenCalled();
		expect( unlockAppdata ).toHaveBeenCalled();
	} );

	it( 'removes empty placement maps after deletion', async () => {
		await setAiSessionSitePlacement( 'session-1', {
			siteId: 'site-1',
			sitePath: '/sites/site-1',
			siteName: 'Site One',
		} );

		await deleteAiSessionPlacement( 'session-1' );

		expect( userData.aiSessionPlacements ).toBeUndefined();
	} );

	it( 'hydrates owner fields only from desktop placement', () => {
		const summary = {
			id: 'session-1',
			filePath: '/sessions/session-1.jsonl',
			createdAt: '2026-05-13T00:00:00.000Z',
			updatedAt: '2026-05-13T00:00:00.000Z',
			ownerSitePath: '/ignored/from-jsonl',
			ownerSiteName: 'Ignored',
			activeEnvironment: 'local',
			eventCount: 1,
		} satisfies AiSessionSummary;

		expect( hydrateAiSessionSummaryWithPlacement( summary ) ).toMatchObject( {
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
			ownerSitePath: '/sites/site-1',
			ownerSiteName: 'Site One',
		} );
	} );
} );
