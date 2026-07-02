import { readFile, writeFile } from 'atomically';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	deleteAiSessionPlacement,
	getCreatedSiteFromArtifact,
	hydrateAiSessionSummaryWithPlacement,
	readAiSessionPlacement,
	readAiSessionPlacements,
	setAiSessionSitePlacement,
} from '@studio/common/ai/sessions/placement';
import type { StudioChatArtifactData } from '@studio/common/ai/chat-artifacts';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';

// Mock the filesystem so placement reads/writes an in-memory app.json (the real
// path is never touched). The lockfile is a no-op. We don't mock well-known-paths
// — getAppConfigPath() just resolves a path string, which fs never actually hits.
vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );
// `mkdir` resolves through the default interop for node built-ins, so override
// both the named export and the `default` namespace.
vi.mock( 'node:fs/promises', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('node:fs/promises') >();
	const mkdir = vi.fn().mockResolvedValue( undefined );
	return { ...actual, default: { ...actual, mkdir }, mkdir };
} );
vi.mock( '@studio/common/lib/lockfile', () => ( {
	lockFileAsync: vi.fn().mockResolvedValue( undefined ),
	unlockFileAsync: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'ai session placement (shared)', () => {
	// In-memory stand-in for app.json; `undefined` means the file doesn't exist.
	let appConfigFile: string | undefined;

	beforeEach( () => {
		appConfigFile = undefined;
		// `atomically`'s readFile/writeFile are overloaded; cast the in-memory
		// stand-in impls to satisfy mockImplementation's typing.
		vi.mocked( readFile ).mockImplementation( ( async () => {
			if ( appConfigFile === undefined ) {
				const error = new Error( 'ENOENT' ) as NodeJS.ErrnoException;
				error.code = 'ENOENT';
				throw error;
			}
			return appConfigFile;
		} ) as never );
		vi.mocked( writeFile ).mockImplementation( ( async ( _path: string, data: unknown ) => {
			appConfigFile = String( data );
		} ) as never );
	} );

	it( 'stores and reads site placements in app.json', async () => {
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
		await expect( readAiSessionPlacements() ).resolves.toEqual( { 'session-1': placement } );
		await expect( readAiSessionPlacement( 'session-1' ) ).resolves.toEqual( placement );
	} );

	it( 'preserves other app.json fields when writing placement', async () => {
		appConfigFile = JSON.stringify( { windowBounds: { x: 1 }, version: 1 } );

		await setAiSessionSitePlacement( 'session-1', {
			siteId: 'site-1',
			sitePath: '/sites/site-1',
			siteName: 'Site One',
		} );

		const written = JSON.parse( appConfigFile ) as Record< string, unknown >;
		expect( written.windowBounds ).toEqual( { x: 1 } );
		expect( written.version ).toBe( 1 );
	} );

	it( 'removes the placement map once empty after deletion', async () => {
		await setAiSessionSitePlacement( 'session-1', {
			siteId: 'site-1',
			sitePath: '/sites/site-1',
			siteName: 'Site One',
		} );

		await deleteAiSessionPlacement( 'session-1' );

		await expect( readAiSessionPlacements() ).resolves.toEqual( {} );
		const written = JSON.parse( appConfigFile! ) as { aiSessionPlacements?: unknown };
		expect( written.aiSessionPlacements ).toBeUndefined();
	} );

	it( 'hydrates owner fields only from placement', () => {
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
