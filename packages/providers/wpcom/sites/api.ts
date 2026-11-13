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
