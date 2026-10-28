import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { vi } from 'vitest';
import { createPreviewSite, deletePreviewSite, updatePreviewSite } from 'cli/lib/preview-sites';
import { LoggerError } from 'cli/logger';

vi.mock( 'wpcom' );
vi.mock( 'wpcom-xhr-request' );
vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	__esModule: true,
	default: vi.fn(),
} ) );

type WpcomFactory = ReturnType< typeof wpcomFactory >;

describe( 'Preview sites', () => {
	const token = 'mock-token';
	const siteId = 12345;
	const get = vi.fn();
	const post = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.mocked( wpcomFactory ).mockReturnValue( { req: { get, post } } as unknown as WpcomFactory );
		get.mockImplementation( ( { path }: { path: string } ) =>
			path === `/sites/${ siteId }`
				? Promise.resolve( { URL: 'https://preview-site.wpcomstaging.com' } )
				: Promise.resolve( { importId: 'new', importStatus: 'importSuccess' } )
		);
		post.mockImplementation( ( { path }: { path: string } ) =>
			path === '/sites/new'
				? Promise.resolve( { blog_details: { blogid: String( siteId ) } } )
				: Promise.resolve( { code: 'abc123' } )
		);
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'creates a site in the preview funnel and returns its preview link', async () => {
		await expect( createPreviewSite( 678, 'My Preview', token ) ).resolves.toEqual( {
			siteId,
			hostname: 'preview-site.wpcomstaging.com',
			shareUrl: 'https://preview-site.wpcomstaging.com/?share=abc123',
		} );
		expect( post ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/sites/new',
				body: expect.objectContaining( {
					blog_title: 'My Preview',
					options: { wow_funnel: 'preview', wow_funnel_args: { attachment_id: '678' } },
				} ),
			} )
		);
	} );

	it( 'fails when the archive import fails', async () => {
		get.mockResolvedValue( { importId: 'new', importStatus: 'importFailure' } );

		await expect( createPreviewSite( 678, 'My Preview', token ) ).rejects.toThrow( LoggerError );
	} );

	it( 'waits for the new import on update, not the one it replaces', async () => {
		const imports = [
			{ importId: 'old', importStatus: 'importSuccess' },
			{ importId: 'old', importStatus: 'importSuccess' },
			{ importId: 'new', importStatus: 'importSuccess' },
		];
		get.mockImplementation( ( { path }: { path: string } ) =>
			path === `/sites/${ siteId }`
				? Promise.resolve( { URL: 'https://preview-site.wpcomstaging.com' } )
				: Promise.resolve( imports.shift() )
		);
		const shareUrl = 'https://preview-site.wpcomstaging.com/?share=kept';

		const update = updatePreviewSite( siteId, 679, token, shareUrl );
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
		expect( post ).not.toHaveBeenCalledWith(
			expect.objectContaining( { path: `/sites/${ siteId }/preview-links` } )
		);
	} );

	it( 'discards the site, and treats one already gone as deleted', async () => {
		await deletePreviewSite( siteId, token );
		expect( post ).toHaveBeenCalledWith(
			expect.objectContaining( { path: '/wow-funnel/pending/discard', body: { blog_id: siteId } } )
		);

		post.mockRejectedValueOnce( Object.assign( new Error( 'gone' ), { statusCode: 404 } ) );
		await expect( deletePreviewSite( siteId, token ) ).resolves.toBeUndefined();
	} );
} );
