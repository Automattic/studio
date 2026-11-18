import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { wpcomClient } from '../api';
import {
	sitesEndpointResponseSchema,
	pullSiteResponseSchema,
	syncBackupResponseSchema,
	importResponseSchema,
	type ImportResponse,
} from './schemas';
import { transformSitesResponse } from './transform';
import type { SyncOption, SyncSite } from './site';

const SITE_FIELDS = [
	'name',
	'ID',
	'URL',
	'plan',
	'capabilities',
	'is_wpcom_atomic',
	'options',
	'jetpack',
	'is_deleted',
	'is_a8c',
	'hosting_provider_guess',
	'environment_type',
].join( ',' );

export async function fetchSyncableSites(
	token: string,
	options: { connectedSiteIds?: number[]; planRequired?: boolean } = {}
): Promise< SyncSite[] > {
	const wpcom = wpcomClient( token );

	const rawResponse = await wpcom.req.get(
		{
			apiNamespace: 'rest/v1.2',
			path: '/me/sites',
		},
		{
			fields: SITE_FIELDS,
			filter: 'atomic,wpcom',
			options: 'created_at,wpcom_staging_blog_ids',
			site_activity: 'active',
		}
	);

	const parsed = sitesEndpointResponseSchema.parse( rawResponse );
	return transformSitesResponse( parsed.sites, options );
}

export async function initiateBackup(
	token: string,
	remoteSiteId: number,
	options: { optionsToSync: SyncOption[]; includePathList?: string[] }
): Promise< number > {
	const wpcom = wpcomClient( token );

	const body: { options: SyncOption[]; include_path_list?: string[] } = {
		options: options.optionsToSync,
		include_path_list: options.includePathList,
	};

	const rawResponse = await wpcom.req.post( {
		path: `/sites/${ remoteSiteId }/studio-app/sync/backup`,
		apiNamespace: 'wpcom/v2',
		body,
	} );

	const response = pullSiteResponseSchema.parse( rawResponse );
	if ( ! response.success ) {
		throw new Error( 'Backup request failed' );
	}

	return response.backup_id;
}

export type BackupStatus = {
	status: 'in-progress' | 'finished' | 'failed';
	downloadUrl: string | null;
	percent: number;
};

export async function pollBackupStatus(
	token: string,
	remoteSiteId: number,
	backupId: number
): Promise< BackupStatus > {
	const wpcom = wpcomClient( token );

	const rawResponse = await wpcom.req.get( `/sites/${ remoteSiteId }/studio-app/sync/backup`, {
		apiNamespace: 'wpcom/v2',
		backup_id: backupId,
	} );

	const parseResult = syncBackupResponseSchema.safeParse( rawResponse );
	if ( ! parseResult.success ) {
		throw new Error( __( 'Unexpected response from server while checking backup status' ) );
	}
	const response = parseResult.data;
	return {
		status: response.status,
		downloadUrl: response.download_url ?? null,
		percent: response.percent,
	};
}

export async function initiateImport(
	token: string,
	remoteSiteId: number,
	attachmentId: string,
	options?: { optionsToSync?: SyncOption[]; specificSelectionPaths?: string[] }
): Promise< void > {
	const wpcom = wpcomClient( token );

	const formData: [ string, unknown, Record< string, string >? ][] = [];
	formData.push( [ 'import_attachment_id', attachmentId ] );

	if ( options?.specificSelectionPaths?.length ) {
		formData.push( [ 'list_sync_items', options.specificSelectionPaths.join( ',' ) ] );
	}

	if ( options?.optionsToSync ) {
		formData.push( [ 'options', options.optionsToSync.join( ',' ) ] );
	}

	await wpcom.req.post( {
		path: `/sites/${ remoteSiteId }/studio-app/sync/import/initiate`,
		apiNamespace: 'wpcom/v2',
		formData,
	} );
}

export async function launchSite( token: string, remoteSiteId: number ): Promise< void > {
	await wpcomClient( token ).req.post( {
		path: `/sites/${ remoteSiteId }/launch`,
		apiVersion: '1.1',
	} );
}

export async function pollImportStatus(
	token: string,
	remoteSiteId: number
): Promise< ImportResponse > {
	const wpcom = wpcomClient( token );

	const rawResponse = await wpcom.req.get( `/sites/${ remoteSiteId }/studio-app/sync/import`, {
		apiNamespace: 'wpcom/v2',
	} );

	return importResponseSchema.parse( rawResponse );
}

export async function checkBackupSize( url: string ): Promise< number > {
	const response = await fetch( url, { method: 'HEAD' } );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch backup size: ${ response.statusText }` );
	}
	const contentLength = response.headers.get( 'content-length' );
	if ( ! contentLength ) {
		return 0;
	}
	return parseInt( contentLength, 10 );
}

export async function fetchLatestRewindId(
	token: string,
	remoteSiteId: number
): Promise< string > {
	const wpcom = wpcomClient( token );

	const rawResponse = await wpcom.req.get(
		`/sites/${ remoteSiteId }/studio-app/sync/get-latest-rewind-id`,
		{ apiNamespace: 'wpcom/v2' }
	);

	const parsed = z.object( { success: z.boolean(), rewind_id: z.string() } ).parse( rawResponse );

	if ( ! parsed.success || ! parsed.rewind_id ) {
		throw new Error( 'No rewind ID available' );
	}

	return parsed.rewind_id;
}

/** Raw contents of a remote backup directory (rewind backup `ls`), keyed by entry name. */
export async function fetchRemoteFileTreeContents(
	token: string,
	remoteSiteId: number,
	rewindId: string,
	treePath: string
): Promise< Record< string, unknown > > {
	const wpcom = wpcomClient( token );

	const rawResponse = await wpcom.req.post( {
		path: `/sites/${ remoteSiteId }/rewind/backup/ls`,
		apiNamespace: 'wpcom/v2',
		body: { backup_id: rewindId, path: treePath },
	} );

	const parsed = z
		.object( {
			ok: z.boolean(),
			error: z.string().optional(),
			contents: z.record( z.string(), z.unknown() ).optional(),
		} )
		.parse( rawResponse );

	if ( ! parsed.ok ) {
		throw new Error( parsed.error || 'Failed to fetch remote file tree' );
	}
	return parsed.contents ?? {};
}

// Every status a post can be in on the live site, trash included: `any` leaves trash out, and a
// post trashed live is a change a database push would undo.
const LIVE_POST_STATUSES = 'publish,private,draft,pending,future,trash';

// A date filter can leave WordPress.com without a total (`found: -1`), so the items returned, up
// to `LIVE_CHANGES_PAGE`, count instead.
const LIVE_CHANGES_PAGE = 100;

const liveChangesSchema = z.object( {
	found: z.number(),
	posts: z.array( z.unknown() ).optional(),
	comments: z.array( z.unknown() ).optional(),
} );

function countFound( response: unknown, items: 'posts' | 'comments' ): number {
	const parsed = liveChangesSchema.parse( response );
	return parsed.found >= 0 ? parsed.found : parsed[ items ]?.length ?? 0;
}

// The Site Editor's templates and template parts. A query for `any` post type leaves them out, and
// the endpoint takes one type at a time.
const TEMPLATE_TYPES = [ 'wp_template', 'wp_template_part' ];

/**
 * How many posts (of any type), and templates and template parts saved in the database, were
 * modified on the site after `since`, an ISO 8601 time, and how many comments were made.
 */
export async function fetchLiveChangesSince(
	token: string,
	remoteSiteId: number,
	since: string
): Promise< { posts: number; comments: number; templates: number } > {
	const wpcom = wpcomClient( token );
	const modifiedAfter = ( type: string ) =>
		wpcom.req.get( `/sites/${ remoteSiteId }/posts`, {
			apiVersion: '1.1',
			type,
			status: LIVE_POST_STATUSES,
			modified_after: since,
			number: LIVE_CHANGES_PAGE,
			fields: 'ID',
		} );
	const [ posts, comments, ...templates ] = await Promise.all( [
		modifiedAfter( 'any' ),
		wpcom.req.get( `/sites/${ remoteSiteId }/comments`, {
			apiVersion: '1.1',
			status: 'all',
			after: since,
			number: LIVE_CHANGES_PAGE,
			fields: 'ID',
		} ),
		...TEMPLATE_TYPES.map( ( type ) =>
			modifiedAfter( type ).catch( ( error: unknown ) => {
				// A site that doesn't register the type has none of it to lose.
				if ( isUnknownPostType( error ) ) {
					return { found: 0 };
				}
				throw error;
			} )
		),
	] );
	return {
		posts: countFound( posts, 'posts' ),
		comments: countFound( comments, 'comments' ),
		templates: templates.reduce< number >(
			( total, response ) => total + countFound( response, 'posts' ),
			0
		),
	};
}

function isUnknownPostType( error: unknown ): boolean {
	return (
		error instanceof Error &&
		'error' in error &&
		( error as { error?: unknown } ).error === 'unknown_post_type'
	);
}
