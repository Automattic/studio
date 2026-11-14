import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { vi } from 'vitest';
import { deleteSnapshot } from 'cli/lib/api';
import {
	createPreviewSite,
	deletePreviewSite,
	deleteSnapshotSite,
	getLivePreviewSite,
	updatePreviewSite,
} from 'cli/lib/preview-sites';
import { LoggerError } from 'cli/logger';

vi.mock( 'wpcom' );
vi.mock( 'cli/lib/api' );
vi.mock( '@studio/common/lib/connected-sites' );
vi.mock( 'wpcom-xhr-request' );
vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	__esModule: true,
	default: vi.fn(),
} ) );

type WpcomFactory = ReturnType< typeof wpcomFactory >;

describe( 'Preview sites', () => {
	const token = 'mock-token';
	const siteId = 12345;
	const shareUrl = 'https://preview-site.wpcomstaging.com/?share=abc123';
	const get = vi.fn();
	const post = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.mocked( wpcomFactory ).mockReturnValue( { req: { get, post } } as unknown as WpcomFactory );
		get.mockImplementation( ( { path }: { path: string } ) =>
			Promise.resolve(
				path === '/wow-funnel/pending'
					? { preview_sites: [ { blog_id: siteId, share_url: shareUrl } ] }
					: { importId: 'new', importStatus: 'importSuccess' }
			)
		);
		post.mockImplementation( ( { path }: { path: string } ) =>
			Promise.resolve(
				path === '/sites/new' ? { blog_details: { blogid: String( siteId ) } } : undefined
			)
		);
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'creates a site in the preview funnel and returns the preview link WordPress.com hands out', async () => {
		await expect( createPreviewSite( 678, 'My Preview', token ) ).resolves.toEqual( {
			siteId,
			hostname: 'preview-site.wpcomstaging.com',
			shareUrl,
		} );
		expect( post ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/sites/new',
				body: expect.objectContaining( {
					blog_title: 'My Preview',
					options: {
						wow_funnel: 'preview',
						wow_funnel_args: { attachment_id: '678' },
						from_wfm: true,
					},
				} ),
			} )
		);
	} );

	it.each( [
		{ liveSiteId: undefined, originId: undefined, extra: {} },
		{ liveSiteId: 99, originId: undefined, extra: { live_site_id: '99' } },
		{ liveSiteId: undefined, originId: 'local-site', extra: { origin_id: 'local-site' } },
		{
			liveSiteId: 99,
			originId: 'local-site',
			extra: { live_site_id: '99', origin_id: 'local-site' },
		},
	] )(
		'sends the funnel args with liveSiteId $liveSiteId and originId $originId',
		async ( { liveSiteId, originId, extra } ) => {
			const imports = [ 'first', 'first', 'second' ];
			get.mockImplementation( ( { path }: { path: string } ) =>
				Promise.resolve(
					path === '/wow-funnel/pending'
						? {
								preview_sites: [
									{ blog_id: siteId, share_url: shareUrl, live_site_id: liveSiteId },
								],
						  }
						: { importId: imports.shift() ?? 'second', importStatus: 'importSuccess' }
				)
			);
			const created = await createPreviewSite( 678, 'My Preview', token, liveSiteId, originId );
			expect( created.liveSiteId ).toBe( liveSiteId );
			const update = updatePreviewSite( siteId, 679, token, liveSiteId, originId );
			await vi.runAllTimersAsync();
			await update;

			expect( post ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/sites/new',
					body: expect.objectContaining( {
						options: expect.objectContaining( {
							wow_funnel_args: { attachment_id: '678', ...extra },
						} ),
					} ),
				} )
			);
			expect( post ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: `/sites/${ siteId }/wow-funnel/update`,
					body: { args: { attachment_id: '679', ...extra } },
				} )
			);
		}
	);

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
		] )( 'with $name', async ( { sites, expected } ) => {
			vi.mocked( getConnectedWpcomSitesForLocalSite ).mockResolvedValue(
				sites as unknown as Awaited< ReturnType< typeof getConnectedWpcomSitesForLocalSite > >
			);
			expect( ( await getLivePreviewSite( 'local' ) )?.id ).toBe( expected );
		} );
	} );

	it( 'includes the WordPress.com reference when an archive import fails', async () => {
		get.mockResolvedValue( {
			importId: 'new',
			importStatus: 'importFailure',
			errorData: {
				description: 'An error occurred while importing your content. Import reference #1234',
			},
		} );

		await expect( createPreviewSite( 678, 'My Preview', token ) ).rejects.toMatchObject( {
			message: 'The preview site could not be built from the archive. Import reference #1234.',
			code: 'preview_import_failed',
		} );
	} );

	it( 'waits for the new import on update, then reads the preview link', async () => {
		const imports = [
			{ importId: 'old', importStatus: 'importSuccess' },
			{ importId: 'old', importStatus: 'importSuccess' },
			{ importId: 'new', importStatus: 'importSuccess' },
		];
		get.mockImplementation( ( { path }: { path: string } ) =>
			Promise.resolve(
				path === '/wow-funnel/pending'
					? { preview_sites: [ { blog_id: siteId, share_url: shareUrl } ] }
					: imports.shift()
			)
		);

		const update = updatePreviewSite( siteId, 679, token );
		await vi.runAllTimersAsync();

		await expect( update ).resolves.toEqual( {
			siteId,
			hostname: 'preview-site.wpcomstaging.com',
			shareUrl,
		} );
		expect( imports ).toHaveLength( 0 );
		expect( post ).toHaveBeenCalledWith( {
			apiNamespace: 'wpcom/v2',
			path: `/sites/${ siteId }/wow-funnel/update`,
			body: { args: { attachment_id: '679' } },
		} );
	} );

	it( 'discards the site, and treats one already gone as deleted', async () => {
		await deletePreviewSite( siteId, token );
		expect( post ).toHaveBeenCalledWith(
			expect.objectContaining( { path: '/wow-funnel/pending/discard', body: { blog_id: siteId } } )
		);

		post.mockRejectedValueOnce( Object.assign( new Error( 'gone' ), { statusCode: 404 } ) );
		await expect( deletePreviewSite( siteId, token ) ).resolves.toBeUndefined();
	} );

	it( 'tells Jurassic Ninja previews from WordPress.com ones by their host', async () => {
		const snapshot = { atomicSiteId: siteId, localSiteId: 'site', date: Date.now() };
		await deleteSnapshotSite( { ...snapshot, url: 'old-preview.wp.build' }, token );
		expect( deleteSnapshot ).toHaveBeenCalledWith( siteId, token );
		expect( post ).not.toHaveBeenCalled();

		await deleteSnapshotSite( { ...snapshot, url: 'preview-site.wpcomstaging.com' }, token );
		expect( post ).toHaveBeenCalledWith(
			expect.objectContaining( { path: '/wow-funnel/pending/discard' } )
		);
	} );
} );
