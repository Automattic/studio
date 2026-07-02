import fs from 'fs';
import { Readable } from 'stream';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import {
	sitesEndpointResponseSchema,
	pullSiteResponseSchema,
	syncBackupResponseSchema,
	importResponseSchema,
} from '@studio/common/types/sync';
import { backupLsItemSchema, backupLsResponseBodySchema } from '@studio/common/types/sync-tree';
import { transformSitesResponse } from './transform-sites';
import type { SyncSite, ImportResponse, SyncOption } from '@studio/common/types/sync';
import type { BackupLsItem } from '@studio/common/types/sync-tree';

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

export async function fetchSyncableSites( token: string ): Promise< SyncSite[] > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	const rawResponse = await wpcom.req.get(
		{
			apiNamespace: 'rest/v1.2',
			path: '/me/sites',
		},
		{
			fields: SITE_FIELDS,
			filters: 'jetpack,atomic,wpcom',
			options: 'created_at,wpcom_staging_blog_ids',
			site_activity: 'active',
		}
	);

	const parsed = sitesEndpointResponseSchema.parse( rawResponse );
	return transformSitesResponse( parsed.sites );
}

export async function initiateBackup(
	token: string,
	remoteSiteId: number,
	options: { optionsToSync: SyncOption[]; includePathList?: string[] }
): Promise< number > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

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
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	const rawResponse = await wpcom.req.get( `/sites/${ remoteSiteId }/studio-app/sync/backup`, {
		apiNamespace: 'wpcom/v2',
		backup_id: backupId,
	} );

	const parseResult = syncBackupResponseSchema.safeParse( rawResponse );
	if ( ! parseResult.success ) {
		console.error( 'Unexpected backup status response:', rawResponse );
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
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

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

export async function pollImportStatus(
	token: string,
	remoteSiteId: number
): Promise< ImportResponse > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

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

export async function downloadBackup( url: string, destPath: string ): Promise< void > {
	const response = await fetch( url );
	if ( ! response.ok || ! response.body ) {
		throw new Error( 'Failed to download backup' );
	}

	const fileStream = fs.createWriteStream( destPath );
	const readable = Readable.fromWeb( response.body as import('stream/web').ReadableStream );

	return new Promise< void >( ( resolve, reject ) => {
		readable.pipe( fileStream );
		fileStream.on( 'finish', resolve );
		fileStream.on( 'error', reject );
		readable.on( 'error', reject );
	} );
}

export async function fetchLatestRewindId(
	token: string,
	remoteSiteId: number
): Promise< string > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

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

export type RemoteFileEntry = {
	name: string;
	isDirectory: boolean;
	pathId: string;
	path: string;
};

export async function fetchRemoteFileTree(
	token: string,
	remoteSiteId: number,
	rewindId: string,
	treePath: string = '/wp-content/'
): Promise< RemoteFileEntry[] > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	const rawResponse = await wpcom.req.post( {
		path: `/sites/${ remoteSiteId }/rewind/backup/ls`,
		apiNamespace: 'wpcom/v2',
		body: { backup_id: rewindId, path: treePath },
	} );

	const parsed = backupLsResponseBodySchema.parse( rawResponse );

	if ( ! parsed.ok ) {
		throw new Error( parsed.error || 'Failed to fetch remote file tree' );
	}

	const entries: RemoteFileEntry[] = [];
	for ( const [ name, rawItem ] of Object.entries( parsed.contents ) ) {
		const itemResult = backupLsItemSchema.safeParse( rawItem );
		if ( itemResult.success ) {
			const item: BackupLsItem = itemResult.data;
			const isDirectory = item.type === 'dir' || item.has_children === true;
			entries.push( {
				name,
				isDirectory,
				pathId: item.id,
				path: `${ treePath }${ name }${ isDirectory ? '/' : '' }`,
			} );
		}
	}

	return entries;
}
