import {
	checkBackupSize as checkBackupSizeBase,
	fetchSyncableSites as fetchSyncableSitesBase,
	initiateBackup as initiateBackupBase,
	pollBackupStatus as pollBackupStatusBase,
	initiateImport as initiateImportBase,
	pollImportStatus as pollImportStatusBase,
	downloadBackup as downloadBackupBase,
	fetchLatestRewindId as fetchLatestRewindIdBase,
	fetchRemoteFileTree as fetchRemoteFileTreeBase,
} from '@studio/common/lib/sync/sync-api';
import { syncOptionSchema } from '@studio/common/types/sync';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';
import type { SyncSite, ImportResponse, SyncOption } from '@studio/common/types/sync';

export function parseSyncOptions( optionsString?: string ): SyncOption[] {
	if ( ! optionsString ) {
		return [ 'all' ];
	}

	return optionsString.split( ',' ).map( ( o ) => {
		const result = syncOptionSchema.safeParse( o.trim() );
		if ( ! result.success ) {
			throw new LoggerError(
				sprintf(
					__( 'Invalid sync option: %s. Valid options: %s' ),
					o.trim(),
					syncOptionSchema.options.join( ', ' )
				)
			);
		}
		return result.data;
	} );
}

function wrapError( message: string, error: unknown ): LoggerError {
	if ( error instanceof LoggerError ) {
		return error;
	}
	if ( error instanceof z.ZodError ) {
		return new LoggerError( __( 'Invalid API response format' ), error );
	}
	return new LoggerError( message, error );
}

export async function fetchSyncableSites( token: string ): Promise< SyncSite[] > {
	try {
		return await fetchSyncableSitesBase( token );
	} catch ( error ) {
		throw wrapError( __( 'Failed to fetch WordPress.com sites' ), error );
	}
}

export async function initiateBackup(
	token: string,
	remoteSiteId: number,
	options: { optionsToSync: SyncOption[]; includePathList?: string[] }
): Promise< number > {
	try {
		return await initiateBackupBase( token, remoteSiteId, options );
	} catch ( error ) {
		throw wrapError( __( 'Failed to initiate backup' ), error );
	}
}

export async function pollBackupStatus( token: string, remoteSiteId: number, backupId: number ) {
	try {
		return await pollBackupStatusBase( token, remoteSiteId, backupId );
	} catch ( error ) {
		throw wrapError( __( 'Failed to check backup status' ), error );
	}
}

export async function initiateImport(
	token: string,
	remoteSiteId: number,
	attachmentId: string,
	options?: { optionsToSync?: SyncOption[]; specificSelectionPaths?: string[] }
): Promise< void > {
	try {
		await initiateImportBase( token, remoteSiteId, attachmentId, options );
	} catch ( error ) {
		if ( error instanceof Error && 'statusCode' in error && error.statusCode === 409 ) {
			throw new LoggerError(
				__(
					'A sync operation is already in progress on this site. Please wait for it to finish and try again.'
				)
			);
		}
		throw wrapError( __( 'Failed to initiate import on remote site' ), error );
	}
}

export async function pollImportStatus(
	token: string,
	remoteSiteId: number
): Promise< ImportResponse > {
	try {
		return await pollImportStatusBase( token, remoteSiteId );
	} catch ( error ) {
		throw wrapError( __( 'Failed to check import status' ), error );
	}
}

export async function checkBackupSize( url: string ): Promise< number > {
	try {
		return await checkBackupSizeBase( url );
	} catch ( error ) {
		throw wrapError( __( 'Failed to check backup size' ), error );
	}
}

export async function downloadBackup( url: string, destPath: string ): Promise< void > {
	try {
		await downloadBackupBase( url, destPath );
	} catch ( error ) {
		throw wrapError( __( 'Failed to download backup' ), error );
	}
}

export async function fetchLatestRewindId(
	token: string,
	remoteSiteId: number
): Promise< string > {
	try {
		return await fetchLatestRewindIdBase( token, remoteSiteId );
	} catch ( error ) {
		throw wrapError( __( 'Failed to fetch latest rewind ID' ), error );
	}
}

export async function fetchRemoteFileTree(
	token: string,
	remoteSiteId: number,
	rewindId: string,
	treePath: string = 'wp-content/'
) {
	try {
		return await fetchRemoteFileTreeBase( token, remoteSiteId, rewindId, treePath );
	} catch ( error ) {
		throw wrapError( __( 'Failed to fetch remote file tree' ), error );
	}
}
