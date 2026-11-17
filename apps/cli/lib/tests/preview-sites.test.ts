import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { vi } from 'vitest';
import { deleteSnapshot } from 'cli/lib/api';
import { buildPreviewSite, deleteSnapshotSite, getLivePreviewSite } from 'cli/lib/preview-sites';
import { LoggerError } from 'cli/logger';

vi.mock( 'cli/lib/api' );
vi.mock( '@studio/common/lib/connected-sites' );
const sites = vi.hoisted( () => ( {
	push: vi.fn(),
	previews: { create: vi.fn(), list: vi.fn(), delete: vi.fn() },
} ) );
vi.mock( '@studio/providers/services', () => ( { getProviderServices: () => ( { sites } ) } ) );
vi.mock( 'fs', async ( importOriginal ) => ( {
	default: {
		...( await importOriginal< typeof import('fs') >() ),
		createReadStream: vi.fn(),
		statSync: vi.fn( () => ( { size: 1 } ) ),
	},
} ) );

describe( 'Preview sites', () => {
	const token = 'mock-token';
	const siteId = 12345;
	const preview = {
		id: siteId,
		name: 'preview-site.wpcomstaging.com',
		url: 'https://preview-site.wpcomstaging.com',
		shareUrl: 'https://preview-site.wpcomstaging.com/?share=abc123',
		liveSiteId: 7,
	};

	beforeEach( () => {
		vi.clearAllMocks();
		sites.previews.create.mockResolvedValue( preview );
		sites.previews.list.mockResolvedValue( [ preview ] );
	} );

	it( 'creates a new preview, or rebuilds an existing one with a push to it', async () => {
		const built = {
			siteId,
			hostname: 'preview-site.wpcomstaging.com',
			shareUrl: preview.shareUrl,
			liveSiteId: 7,
		};
		await expect(
			buildPreviewSite( token, '/tmp/site.zip', { name: 'Mine' }, { originId: 'local' }, vi.fn() )
		).resolves.toMatchObject( built );
		expect( sites.previews.create ).toHaveBeenCalledWith(
			{ token },
			expect.objectContaining( { kind: 'archive', name: 'site.zip', size: 1 } ),
			{ originId: 'local', name: 'Mine' },
			expect.any( Function )
		);

		await expect(
			buildPreviewSite( token, '/tmp/site.zip', { siteId }, { originId: 'local' }, vi.fn() )
		).resolves.toMatchObject( built );
		expect( sites.push ).toHaveBeenCalledWith(
			{ token },
			{ id: siteId, name: '' },
			expect.objectContaining( { kind: 'archive' } ),
			{ preview: { originId: 'local' } },
			expect.any( Function )
		);
	} );

	it( 'fails a rebuild when the preview has no preview link', async () => {
		sites.previews.list.mockResolvedValue( [] );
		await expect(
			buildPreviewSite( token, '/tmp/site.zip', { siteId }, {}, vi.fn() )
		).rejects.toThrow( LoggerError );
	} );

	describe( 'getLivePreviewSite', () => {
		const paid = { id: 1, isStaging: false, isPressable: false, pushNeedsUpgrade: false };

		it.each( [
			{ name: 'one paid production site', sites: [ paid ], expected: 1 },
			{ name: 'staging', sites: [ { ...paid, isStaging: true } ], expected: undefined },
			{ name: 'Pressable', sites: [ { ...paid, isPressable: true } ], expected: undefined },
			{
				name: 'not known to need a plan',
				sites: [ { ...paid, pushNeedsUpgrade: undefined } ],
				expected: 1,
			},
			{
				name: 'needs upgrade',
				sites: [ { ...paid, pushNeedsUpgrade: true } ],
				expected: undefined,
			},
			{ name: 'two paid sites', sites: [ paid, { ...paid, id: 2 } ], expected: undefined },
		] )( 'with $name', async ( { sites: connected, expected } ) => {
			vi.mocked( getConnectedWpcomSitesForLocalSite ).mockResolvedValue(
				connected as unknown as Awaited< ReturnType< typeof getConnectedWpcomSitesForLocalSite > >
			);
			expect( ( await getLivePreviewSite( 'local' ) )?.id ).toBe( expected );
		} );
	} );

	it( 'tells Jurassic Ninja previews from WordPress.com ones by their host', async () => {
		const snapshot = { atomicSiteId: siteId, localSiteId: 'site', date: Date.now() };
		await deleteSnapshotSite( { ...snapshot, url: 'old-preview.wp.build' }, token );
		expect( deleteSnapshot ).toHaveBeenCalledWith( siteId, token );
		expect( sites.previews.delete ).not.toHaveBeenCalled();

		await deleteSnapshotSite( { ...snapshot, url: 'preview-site.wpcomstaging.com' }, token );
		expect( sites.previews.delete ).toHaveBeenCalledWith( { token }, { id: siteId } );
	} );
} );
