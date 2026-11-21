import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { RemoteSiteError } from '../../errors';
import { wpcomClient } from '../api';
import { createTusUpload } from './upload';
import type { PreviewOptions, PreviewSite, PushContent, PushStatus } from '../../types';

// A preview is an unlaunched WordPress.com site that the preview funnel builds from the zip of a
// local site's folder. It stays private ("coming soon") and is shared through a preview link,
// until the owner buys a plan for it or it expires. Its builds go through WordPress.com's site
// importer, not the sync import a push uses, which needs a plan.

const PREVIEW_FUNNEL = 'preview';
const IMPORT_POLL_INTERVAL_MS = 1000;
const IMPORT_TIMEOUT_MS = 30 * 60 * 1000;

const newSiteResponseSchema = z.object( {
	blog_details: z.object( { blogid: z.coerce.number().int().positive() } ),
} );

const importResponseSchema = z
	.object( {
		importId: z.string().optional(),
		importStatus: z.string().optional(),
		errorData: z.object( { description: z.string() } ).optional().catch( undefined ),
	} )
	.nullable()
	.catch( null );

// `preview_sites` is left out when the user has none. `expires_at` is in seconds. `share_url` is the
// preview link WordPress.com creates when the site's first build is done, and '' until then.
// `launch_url` is where the owner buys the preview; a preview of changes to a live site has none.
// `title` is the site's title, and `origin_id` the `originId` it was made with, sent only to the app
// that made it, so a preview whose local record is missing can still be put back with its local site.
const pendingPreviewsSchema = z.object( {
	preview_sites: z
		.array(
			z.object( {
				blog_id: z.number(),
				site_slug: z.string().optional(),
				expires_at: z.number().optional(),
				share_url: z.string().optional(),
				live_site_id: z.number().optional(),
				launch_url: z.string().optional(),
				title: z.string().optional(),
				origin_id: z.string().optional(),
			} )
		)
		.optional(),
} );

const modifiedSchema = z.array( z.object( { modified: z.string().nullable().optional() } ) );

function funnelArgs( attachmentId: string, { originId, liveSiteId }: PreviewOptions ) {
	return {
		attachment_id: attachmentId,
		...( originId && { origin_id: originId } ),
		...( liveSiteId && { live_site_id: String( liveSiteId ) } ),
	};
}

async function step< T >( message: string, code: string | undefined, run: () => Promise< T > ) {
	try {
		return await run();
	} catch ( error ) {
		throw error instanceof RemoteSiteError
			? error
			: new RemoteSiteError( message, code, { cause: error } );
	}
}

// Uploads the archive to the site, or with site ID 0 ahead of the site it will build.
async function uploadArchive(
	token: string,
	siteId: number,
	content: PushContent,
	onStatus: ( status: PushStatus ) => void,
	signal?: AbortSignal
): Promise< string > {
	if ( content.kind !== 'archive' ) {
		throw new Error( 'A WordPress.com preview is built from a zip of the site.' );
	}
	signal?.throwIfAborted();
	onStatus( { phase: 'uploading', progress: 0 } );
	const upload = createTusUpload( {
		token,
		remoteSiteId: siteId,
		file: content.file,
		filename: content.name,
		size: content.size,
		onProgress: ( percent ) => onStatus( { phase: 'uploading', progress: percent } ),
	} );
	signal?.addEventListener( 'abort', upload.abort, { once: true } );
	return step( __( 'Failed to upload archive' ), 'upload', () =>
		upload.promise.finally( () => signal?.removeEventListener( 'abort', upload.abort ) )
	);
}

async function getLatestImport( token: string, siteId: number ) {
	return importResponseSchema.parse(
		await wpcomClient( token ).req.get( {
			apiNamespace: 'rest/v1.1',
			path: `/sites/${ siteId }/imports/`,
		} )
	);
}

// Waits for the site's archive import to finish. `previousImportId` is the import a rebuild
// replaces, which reads as finished until the new one starts.
async function waitForImport( token: string, siteId: number, previousImportId?: string ) {
	const deadline = Date.now() + IMPORT_TIMEOUT_MS;
	while ( Date.now() < deadline ) {
		// Errors mean the site is still being set up; keep waiting.
		const latest = await getLatestImport( token, siteId ).catch( () => null );
		if ( latest?.importId && latest.importId !== previousImportId ) {
			if ( latest.importStatus === 'importSuccess' ) {
				return;
			}
			if ( latest.importStatus === 'importFailure' ) {
				const reference = latest.errorData?.description.match( /#(\d+)\s*$/ )?.[ 1 ];
				throw new RemoteSiteError(
					reference
						? sprintf(
								/* translators: %s: WordPress.com import reference number. */
								__( 'The preview site could not be built from the archive. Import reference #%s.' ),
								reference
						  )
						: __( 'The preview site could not be built from the archive.' ),
					'preview_import_failed'
				);
			}
		}
		await new Promise( ( resolve ) => setTimeout( resolve, IMPORT_POLL_INTERVAL_MS ) );
	}
	throw new RemoteSiteError( __( 'The preview site did not become ready within the timeout.' ) );
}

export async function listPreviews( token: string ): Promise< PreviewSite[] > {
	const response = pendingPreviewsSchema.parse(
		await wpcomClient( token ).req.get( { apiNamespace: 'wpcom/v2', path: '/wow-funnel/pending' } )
	);
	return ( response.preview_sites ?? [] ).flatMap( ( site ) => {
		const hostname = site.share_url ? new URL( site.share_url ).hostname : site.site_slug;
		return hostname
			? [
					{
						id: site.blog_id,
						name: hostname,
						url: `https://${ hostname }`,
						shareUrl: site.share_url || undefined,
						expiresAt: site.expires_at === undefined ? undefined : site.expires_at * 1000,
						liveSiteId: site.live_site_id,
						launchUrl: site.launch_url || undefined,
						title: site.title || undefined,
						originId: site.origin_id || undefined,
					},
			  ]
			: [];
	} );
}

export async function createPreview(
	token: string,
	content: PushContent,
	{ name, ...options }: PreviewOptions & { name: string },
	onStatus: ( status: PushStatus ) => void,
	signal?: AbortSignal
): Promise< PreviewSite > {
	const attachmentId = await uploadArchive( token, 0, content, onStatus, signal );
	onStatus( { phase: 'applyingChanges' } );
	const siteId = await step( __( 'Failed to create preview site' ), undefined, async () => {
		const response = newSiteResponseSchema.parse(
			await wpcomClient( token ).req.post( {
				apiNamespace: 'rest/v1.1',
				path: '/sites/new',
				body: {
					blog_name: '',
					blog_title: name,
					public: 0,
					validate: false,
					find_available_url: true,
					options: {
						wow_funnel: PREVIEW_FUNNEL,
						wow_funnel_args: funnelArgs( attachmentId, options ),
						// Use a ready-made site when one is available, so the preview comes up faster.
						from_wfm: true,
					},
				},
			} )
		);
		return response.blog_details.blogid;
	} );
	await waitForImport( token, siteId );
	onStatus( { phase: 'finishing' } );
	// WordPress.com creates the preview link once the site's first build is done.
	const preview = ( await listPreviews( token ) ).find( ( item ) => item.id === siteId );
	if ( ! preview?.shareUrl ) {
		throw new RemoteSiteError( __( 'The preview site has no preview link.' ) );
	}
	return preview;
}

export async function updatePreview(
	token: string,
	siteId: number,
	content: PushContent,
	options: PreviewOptions,
	onStatus: ( status: PushStatus ) => void,
	signal?: AbortSignal
): Promise< void > {
	const attachmentId = await uploadArchive( token, siteId, content, onStatus, signal );
	onStatus( { phase: 'applyingChanges' } );
	const previousImportId = ( await getLatestImport( token, siteId ).catch( () => null ) )?.importId;
	await step( __( 'Failed to update preview site' ), undefined, () =>
		wpcomClient( token ).req.post( {
			apiNamespace: 'wpcom/v2',
			path: `/sites/${ siteId }/wow-funnel/update`,
			body: { args: funnelArgs( attachmentId, options ) },
		} )
	);
	await waitForImport( token, siteId, previousImportId );
}

export async function deletePreview( token: string, siteId: number ): Promise< void > {
	try {
		// The site is reverted and then deleted in the background.
		await wpcomClient( token ).req.post( {
			apiNamespace: 'wpcom/v2',
			path: '/wow-funnel/pending/discard',
			body: { blog_id: siteId },
		} );
	} catch ( error ) {
		if ( error instanceof Error && 'statusCode' in error && error.statusCode === 404 ) {
			return;
		}
		throw new RemoteSiteError( __( 'Failed to delete preview site' ), undefined, { cause: error } );
	}
}

/**
 * When the site's content was last edited on WordPress.com: the latest modification of its posts,
 * pages and other content, and of its templates and template parts. Studio's own pushes keep the
 * local site's modification times, so a time after the last push or pull is an edit made on the
 * site. Edits to settings alone don't show.
 */
export async function getEditedAt( token: string, siteId: number ): Promise< number > {
	const wpcom = wpcomClient( token );
	const [ posts, templates, templateParts ] = await Promise.all( [
		wpcom.req.get(
			{ apiNamespace: 'rest/v1.1', path: `/sites/${ siteId }/posts` },
			{ type: 'any', status: 'any', order_by: 'modified', number: 1, fields: 'modified' }
		),
		...[ 'templates', 'template-parts' ].map( ( kind ) =>
			wpcom.req.get(
				{ apiNamespace: 'wp/v2', path: `/sites/${ siteId }/${ kind }` },
				{ _fields: 'modified', per_page: 100 }
			)
		),
	] );
	const times = [
		...modifiedSchema.parse( z.object( { posts: z.unknown() } ).parse( posts ).posts ),
		...modifiedSchema.parse( templates ),
		...modifiedSchema.parse( templateParts ),
	]
		.map( ( item ) => ( item.modified ? Date.parse( item.modified ) : NaN ) )
		.filter( ( time ) => ! Number.isNaN( time ) );
	return Math.max( 0, ...times );
}
