import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { vi } from 'vitest';
import { deleteSnapshot } from 'cli/lib/api';
import {
	createPreviewSite,
	deletePreviewSite,
	deleteSnapshotSite,
	updatePreviewSite,
} from 'cli/lib/preview-sites';
import { LoggerError } from 'cli/logger';

vi.mock( 'wpcom' );
vi.mock( 'cli/lib/api' );
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

	it( 'fails when the archive import fails', async () => {
		get.mockResolvedValue( { importId: 'new', importStatus: 'importFailure' } );

		await expect( createPreviewSite( 678, 'My Preview', token ) ).rejects.toThrow( LoggerError );
	} );

	it( 'waits for the new import on update, then for the preview link', async () => {
		const imports = [
			{ importId: 'old', importStatus: 'importSuccess' },
			{ importId: 'old', importStatus: 'importSuccess' },
			{ importId: 'new', importStatus: 'importSuccess' },
		];
		// The link is '' until the build is done.
		const links = [ '', shareUrl ];
		get.mockImplementation( ( { path }: { path: string } ) =>
			Promise.resolve(
				path === '/wow-funnel/pending'
					? { preview_sites: [ { blog_id: siteId, share_url: links.shift() } ] }
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
		expect( links ).toHaveLength( 0 );
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
