import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import {
	sitesEndpointSiteSchema,
	sitesEndpointResponseSchema,
	pullSiteResponseSchema,
	syncBackupResponseSchema,
	importResponseSchema,
} from '@studio/common/types/sync';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { getSyncSupport, isPressableSite } from 'cli/lib/sync-support';
import { LoggerError } from 'cli/logger';
import type {
	SitesEndpointSite,
	SyncSite,
	ImportResponse,
	SyncOption,
} from '@studio/common/types/sync';

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

function transformSitesResponse( sites: unknown[] ): SyncSite[] {
	const validatedSites = sites.reduce< SitesEndpointSite[] >( ( acc, rawSite ) => {
		try {
			return [ ...acc, sitesEndpointSiteSchema.parse( rawSite ) ];
		} catch {
			return acc;
		}
	}, [] );

	const allStagingSiteIds = validatedSites.flatMap(
		( site ) => site.options?.wpcom_staging_blog_ids ?? []
	);

	return validatedSites
		.filter( ( site ) => ! site.is_a8c && ! site.is_deleted )
		.map( ( site ) => {
			const isStaging = allStagingSiteIds.includes( site.ID );
			const syncSupport = getSyncSupport( site, [] );

			return {
				id: site.ID,
				localSiteId: '',
				name: site.name,
				url: site.URL,
				isStaging,
				isPressable: isPressableSite( site ),
				environmentType: site.environment_type,
				syncSupport,
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			};
		} );
}

export async function fetchSyncableSites( token: string ): Promise< SyncSite[] > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	try {
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
		return transformSitesResponse( parsed.sites );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}
		if ( error instanceof z.ZodError ) {
			throw new LoggerError( __( 'Invalid API response format' ), error );
		}
		throw new LoggerError( __( 'Failed to fetch WordPress.com sites' ), error );
	}
}

export async function initiateBackup(
	token: string,
	remoteSiteId: number,
	options: { optionsToSync: SyncOption[]; includePathList?: string[] }
): Promise< number > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	try {
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
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to initiate backup' ), error );
	}
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

	try {
		const rawResponse = await wpcom.req.get( `/sites/${ remoteSiteId }/studio-app/sync/backup`, {
			apiNamespace: 'wpcom/v2',
			backup_id: backupId,
		} );

		const response = syncBackupResponseSchema.parse( rawResponse );
		return {
			status: response.status,
			downloadUrl: response.download_url ?? null,
			percent: response.percent,
		};
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to check backup status' ), error );
	}
}

export async function tusUpload(
	token: string,
	remoteSiteId: number,
	archivePath: string,
	onProgress?: ( percent: number ) => void
): Promise< string > {
	// Dynamic import to handle tus-js-client availability
	const { Upload } = await import( 'tus-js-client' );

	const file = fs.createReadStream( archivePath );
	const fileSize = fs.statSync( archivePath ).size;
	const filename = path.basename( archivePath );

	return new Promise< string >( ( resolve, reject ) => {
		const upload = new Upload( file, {
			endpoint: `https://public-api.wordpress.com/rest/v1.1/studio-file-uploads/${ remoteSiteId }`,
			chunkSize: 500000,
			retryDelays: [ 0, 1000, 3000, 5000, 10000, 25000 ],
			overridePatchMethod: true,
			removeFingerprintOnSuccess: true,
			storeFingerprintForResuming: true,
			headers: {
				Authorization: `Bearer ${ token }`,
			},
			metadata: {
				filename,
				filetype: 'application/gzip',
			},
			uploadSize: fileSize,
			onBeforeRequest: ( req ) => {
				if ( req.getMethod() === 'HEAD' ) {
					// @ts-expect-error Override method to get response headers
					req._method = 'GET';
					req.setHeader( 'X-HTTP-Method-Override', 'HEAD' );
				}
			},
			onError: ( error ) => {
				file.destroy();
				reject( new LoggerError( __( 'Upload failed' ), error ) );
			},
			onProgress: ( bytesSent: number, bytesTotal: number ) => {
				if ( onProgress && bytesTotal > 0 ) {
					onProgress( ( bytesSent / bytesTotal ) * 100 );
				}
			},
			onSuccess: ( payload ) => {
				file.destroy();
				if ( ! payload.lastResponse ) {
					reject( new LoggerError( __( 'Upload completed but no response received' ) ) );
					return;
				}

				const attachmentId = payload.lastResponse.getHeader( 'x-studio-file-upload-media-id' );
				if ( attachmentId ) {
					resolve( attachmentId );
				} else {
					reject( new LoggerError( __( 'Upload completed but attachment ID not found' ) ) );
				}
			},
			onShouldRetry: ( error ) => {
				const status = error.originalResponse ? error.originalResponse.getStatus() : 0;
				return status !== 403;
			},
		} );

		upload.start();
	} );
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

	try {
		await wpcom.req.post( {
			path: `/sites/${ remoteSiteId }/studio-app/sync/import/initiate`,
			apiNamespace: 'wpcom/v2',
			formData,
		} );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to initiate import on remote site' ), error );
	}
}

export async function pollImportStatus(
	token: string,
	remoteSiteId: number
): Promise< ImportResponse > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	try {
		const rawResponse = await wpcom.req.get( `/sites/${ remoteSiteId }/studio-app/sync/import`, {
			apiNamespace: 'wpcom/v2',
		} );

		return importResponseSchema.parse( rawResponse );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to check import status' ), error );
	}
}

export async function downloadBackup( url: string, destPath: string ): Promise< void > {
	const response = await fetch( url );
	if ( ! response.ok || ! response.body ) {
		throw new LoggerError( __( 'Failed to download backup' ) );
	}

	const { Readable } = await import( 'stream' );
	const fileStream = fs.createWriteStream( destPath );
	const readable = Readable.fromWeb( response.body as import('stream/web').ReadableStream );
	await pipeline( readable, fileStream );
}
