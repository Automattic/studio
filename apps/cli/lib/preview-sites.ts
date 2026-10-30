import fs from 'fs';
import { DEMO_SITE_SIZE_LIMIT_BYTES, DEMO_SITE_SIZE_LIMIT_GB } from '@studio/common/constants';
import { isWpcomPreview } from '@studio/common/lib/snapshots';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { deleteSnapshot } from 'cli/lib/api';
import { LoggerError } from 'cli/logger';
import type { Snapshot } from '@studio/common/types/snapshot';

// A preview site is an unlaunched WordPress.com site built from the archive of a local site. It
// stays private ("coming soon") and is shared through a preview link, until the owner buys a plan
// for it or it expires.

const PREVIEW_FUNNEL = 'preview';
const IMPORT_POLL_INTERVAL_MS = 1000;
const IMPORT_TIMEOUT_MS = 30 * 60 * 1000;

export type PreviewSite = {
	siteId: number;
	hostname: string;
	// Jurassic Ninja previews are public and have no preview link.
	shareUrl?: string;
};

const newSiteResponseSchema = z.object( {
	blog_details: z.object( { blogid: z.coerce.number().int().positive() } ),
} );

const importResponseSchema = z
	.object( {
		importId: z.string().optional(),
		importStatus: z.string().optional(),
	} )
	.nullable()
	.catch( null );

// `preview_sites` is left out when the user has none. `expires_at` is in seconds. `share_url` is the
// preview link WordPress.com creates when the site's first build is done, and '' until then.
const standingPreviewsSchema = z.object( {
	preview_sites: z
		.array(
			z.object( {
				blog_id: z.number(),
				expires_at: z.number().optional(),
				share_url: z.string().optional(),
			} )
		)
		.optional(),
} );

export type StandingPreview = {
	// When it expires (ms).
	expiresAt?: number;
	shareUrl?: string;
};

function wpcom( token: string ) {
	return wpcomFactory( token, wpcomXhrRequest );
}

/**
 * Uploads a site archive and returns its attachment ID. Site ID 0 uploads it ahead of the site it
 * will build.
 */
export async function uploadPreviewArchive(
	archivePath: string,
	token: string,
	siteId = 0
): Promise< number > {
	if ( fs.statSync( archivePath ).size > DEMO_SITE_SIZE_LIMIT_BYTES ) {
		throw new LoggerError(
			sprintf(
				/* translators: %d: Size limit in GB */
				__( 'The site archive exceeds the %d GB size limit.' ),
				DEMO_SITE_SIZE_LIMIT_GB
			)
		);
	}

	try {
		const attachmentId = await createTusUpload( {
			token,
			remoteSiteId: siteId,
			archivePath,
		} ).promise;
		return Number( attachmentId );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to upload archive' ), error );
	}
}

async function getLatestImport(
	siteId: number,
	token: string
): Promise< { importId?: string; importStatus?: string } | null > {
	return importResponseSchema.parse(
		await wpcom( token ).req.get( {
			apiNamespace: 'rest/v1.1',
			path: `/sites/${ siteId }/imports/`,
		} )
	);
}

/**
 * Waits for the site's archive import to finish. `previousImportId` is the import an update
 * replaces, which reads as finished until the new one starts.
 */
async function waitForPreviewImport(
	siteId: number,
	token: string,
	previousImportId?: string
): Promise< void > {
	const deadline = Date.now() + IMPORT_TIMEOUT_MS;
	while ( Date.now() < deadline ) {
		// Errors mean the site is still being set up; keep waiting.
		const latest = await getLatestImport( siteId, token ).catch( () => null );
		if ( latest?.importId && latest.importId !== previousImportId ) {
			if ( latest.importStatus === 'importSuccess' ) {
				return;
			}
			if ( latest.importStatus === 'importFailure' ) {
				throw new LoggerError( __( 'The preview site could not be built from the archive.' ) );
			}
		}
		await new Promise( ( resolve ) => setTimeout( resolve, IMPORT_POLL_INTERVAL_MS ) );
	}
	throw new LoggerError( __( 'The preview site did not become ready within the timeout.' ) );
}

/**
 * The preview link WordPress.com creates once the site's build is done (before the import reports
 * success), and the preview it opens.
 */
async function getPreviewLink( siteId: number, token: string ): Promise< PreviewSite > {
	const shareUrl = ( await getStandingPreviews( token ) ).get( siteId )?.shareUrl;
	if ( ! shareUrl ) {
		throw new LoggerError( __( 'The preview site has no preview link.' ) );
	}
	return { siteId, hostname: new URL( shareUrl ).hostname, shareUrl };
}

/** Builds a preview site from an archive uploaded with site ID 0. */
export async function createPreviewSite(
	attachmentId: number,
	title: string,
	token: string
): Promise< PreviewSite > {
	let siteId: number;
	try {
		const response = newSiteResponseSchema.parse(
			await wpcom( token ).req.post( {
				apiNamespace: 'rest/v1.1',
				path: '/sites/new',
				body: {
					blog_name: '',
					blog_title: title,
					public: 0,
					validate: false,
					find_available_url: true,
					options: {
						wow_funnel: PREVIEW_FUNNEL,
						wow_funnel_args: { attachment_id: String( attachmentId ) },
						// Use a ready-made site when one is available, so the preview comes up faster.
						from_wfm: true,
					},
				},
			} )
		);
		siteId = response.blog_details.blogid;
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to create preview site' ), error );
	}

	await waitForPreviewImport( siteId, token );
	return getPreviewLink( siteId, token );
}

/** Rebuilds a preview site from an archive uploaded with its site ID. */
export async function updatePreviewSite(
	siteId: number,
	attachmentId: number,
	token: string
): Promise< PreviewSite > {
	const previousImportId = ( await getLatestImport( siteId, token ).catch( () => null ) )?.importId;

	try {
		await wpcom( token ).req.post( {
			apiNamespace: 'wpcom/v2',
			path: `/sites/${ siteId }/wow-funnel/update`,
			body: { args: { attachment_id: String( attachmentId ) } },
		} );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to update preview site' ), error );
	}

	await waitForPreviewImport( siteId, token, previousImportId );
	return getPreviewLink( siteId, token );
}

/**
 * The user's previews WordPress.com still has standing (unpaid and not torn down), by site ID. A
 * preview that was bought, expired or deleted elsewhere is not among them.
 */
export async function getStandingPreviews(
	token: string
): Promise< Map< number, StandingPreview > > {
	const response = standingPreviewsSchema.parse(
		await wpcom( token ).req.get( { apiNamespace: 'wpcom/v2', path: '/wow-funnel/pending' } )
	);
	return new Map(
		( response.preview_sites ?? [] ).map( ( site ) => [
			site.blog_id,
			{
				expiresAt: site.expires_at === undefined ? undefined : site.expires_at * 1000,
				shareUrl: site.share_url || undefined,
			},
		] )
	);
}

export async function deletePreviewSite( siteId: number, token: string ): Promise< void > {
	try {
		// The site is reverted and then deleted in the background.
		await wpcom( token ).req.post( {
			apiNamespace: 'wpcom/v2',
			path: '/wow-funnel/pending/discard',
			body: { blog_id: siteId },
		} );
	} catch ( error ) {
		if ( error instanceof Error && 'statusCode' in error && error.statusCode === 404 ) {
			return;
		}
		throw new LoggerError( __( 'Failed to delete preview site' ), error );
	}
}

/** Deletes the site behind a saved preview, wherever it was made. */
export async function deleteSnapshotSite( snapshot: Snapshot, token: string ): Promise< void > {
	if ( isWpcomPreview( snapshot ) ) {
		await deletePreviewSite( snapshot.atomicSiteId, token );
	} else {
		// A preview made on Jurassic Ninja.
		await deleteSnapshot( snapshot.atomicSiteId, token );
	}
}
