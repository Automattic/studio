import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteSiteError } from '../../../errors';
import { wpcomClient } from '../../api';
import { wpcomSites } from '../index';
import { createTusUpload } from '../upload';
import type { PushContent } from '../../../types';

vi.mock( '../../api' );
vi.mock( '../upload' );

const config = { token: 'token' };
const siteId = 12345;
const shareUrl = 'https://preview-site.wpcomstaging.com/?share=abc123';
const launchUrl =
	'https://wordpress.com/setup/launch-site?siteSlug=preview-site.wpcomstaging.com&hide_free_plan=1';
const content: PushContent = {
	kind: 'archive',
	file: Readable.from( [] ),
	name: 'site.zip',
	size: 1,
};
const preview = {
	id: siteId,
	name: 'preview-site.wpcomstaging.com',
	url: 'https://preview-site.wpcomstaging.com',
	shareUrl,
	launchUrl,
};

const get = vi.fn();
const post = vi.fn();
const previews = wpcomSites.previews!;

function attachments( ...ids: string[] ) {
	for ( const id of ids ) {
		vi.mocked( createTusUpload ).mockReturnValueOnce( {
			promise: Promise.resolve( id ),
			abort: vi.fn(),
		} );
	}
}

beforeEach( () => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	vi.mocked( wpcomClient ).mockReturnValue( { req: { get, post } } as never );
	get.mockImplementation( ( { path }: { path: string } ) =>
		Promise.resolve(
			path === '/wow-funnel/pending'
				? { preview_sites: [ { blog_id: siteId, share_url: shareUrl, launch_url: launchUrl } ] }
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

describe( 'previews', () => {
	it( 'creates a site in the preview funnel from an archive uploaded ahead of it', async () => {
		attachments( '678' );
		const onStatus = vi.fn();

		await expect(
			previews.create(
				config,
				content,
				{ name: 'My Preview', liveSiteId: 99, originId: 'local-site' },
				onStatus
			)
		).resolves.toEqual( preview );
		expect( createTusUpload ).toHaveBeenCalledWith(
			expect.objectContaining( { remoteSiteId: 0, filename: 'site.zip' } )
		);
		expect( post ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/sites/new',
				body: expect.objectContaining( {
					blog_title: 'My Preview',
					options: {
						wow_funnel: 'preview',
						wow_funnel_args: { attachment_id: '678', live_site_id: '99', origin_id: 'local-site' },
						from_wfm: true,
					},
				} ),
			} )
		);
		expect( onStatus.mock.calls.map( ( [ status ] ) => status.phase ) ).toEqual( [
			'uploading',
			'applyingChanges',
			'finishing',
		] );
	} );

	it( 'fails when the archive import fails', async () => {
		attachments( '678' );
		get.mockResolvedValue( { importId: 'new', importStatus: 'importFailure' } );

		await expect(
			previews.create( config, content, { name: 'My Preview' }, vi.fn() )
		).rejects.toThrow( RemoteSiteError );
	} );

	it( 'rebuilds a preview on a push to it, waiting for the new import', async () => {
		attachments( '679' );
		const imports = [
			{ importId: 'old', importStatus: 'importSuccess' },
			{ importId: 'old', importStatus: 'importSuccess' },
			{ importId: 'new', importStatus: 'importSuccess' },
		];
		get.mockImplementation( () => Promise.resolve( imports.shift() ) );

		const update = wpcomSites.push(
			config,
			{ id: siteId, name: '' },
			content,
			{ preview: { originId: 'local-site' } },
			vi.fn()
		);
		await vi.runAllTimersAsync();
		await update;

		expect( imports ).toHaveLength( 0 );
		expect( createTusUpload ).toHaveBeenCalledWith(
			expect.objectContaining( { remoteSiteId: siteId } )
		);
		expect( post ).toHaveBeenCalledTimes( 1 );
		expect( post ).toHaveBeenCalledWith( {
			apiNamespace: 'wpcom/v2',
			path: `/sites/${ siteId }/wow-funnel/update`,
			body: { args: { attachment_id: '679', origin_id: 'local-site' } },
		} );
	} );

	it( 'lists standing previews by their preview link host, with expiry in milliseconds', async () => {
		get.mockResolvedValue( {
			preview_sites: [
				{ blog_id: 1, site_slug: 'slug.wpcomstaging.com', expires_at: 10, live_site_id: 7 },
				{ blog_id: siteId, site_slug: 'ignored', share_url: shareUrl },
				{ blog_id: 3 },
			],
		} );

		await expect( previews.list( config ) ).resolves.toEqual( [
			{
				id: 1,
				name: 'slug.wpcomstaging.com',
				url: 'https://slug.wpcomstaging.com',
				expiresAt: 10_000,
				liveSiteId: 7,
			},
			{ ...preview, launchUrl: undefined },
		] );
	} );

	it( 'lists the title and origin WordPress.com reports for a preview', async () => {
		get.mockResolvedValue( {
			preview_sites: [
				{ blog_id: siteId, share_url: shareUrl, title: 'My Preview', origin_id: 'local-site' },
				{ blog_id: 2, site_slug: 'blank.wpcomstaging.com', title: '', origin_id: '' },
			],
		} );

		const [ named, blank ] = await previews.list( config );
		expect( named ).toMatchObject( { title: 'My Preview', originId: 'local-site' } );
		expect( blank.title ).toBeUndefined();
		expect( blank.originId ).toBeUndefined();
	} );

	it( 'discards the site, and treats one already gone as deleted', async () => {
		await previews.delete( config, { id: siteId } );
		expect( post ).toHaveBeenCalledWith(
			expect.objectContaining( { path: '/wow-funnel/pending/discard', body: { blog_id: siteId } } )
		);

		post.mockRejectedValueOnce( Object.assign( new Error( 'gone' ), { statusCode: 404 } ) );
		await expect( previews.delete( config, { id: siteId } ) ).resolves.toBeUndefined();
	} );
} );
