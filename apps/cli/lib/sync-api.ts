import {
	fetchSyncableSites as fetchSyncableSitesBase,
	initiateImport as initiateImportBase,
	pollImportStatus as pollImportStatusBase,
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

// `code` is the machine-readable failure bucket for analytics — the message is
// `__()`-translated display text and unsafe to match on. Without it, a remote
// failure here inherits whatever fallback the caller's emitter assumes.
function wrapError( message: string, error: unknown, code?: string ): LoggerError {
	if ( error instanceof LoggerError ) {
		return error;
	}
	if ( error instanceof z.ZodError ) {
		return new LoggerError( __( 'Invalid API response format' ), error, code );
	}
	return new LoggerError( message, withServerDetail( error ), code );
}

// wp-error keeps only the status line in `message`; the server's own `error` text is what explains
// the failure in the logs.
function withServerDetail( error: unknown ): unknown {
	if ( ! ( error instanceof Error ) || ! ( 'error' in error ) || typeof error.error !== 'string' ) {
		return error;
	}
	if ( ! error.error || error.message.includes( error.error ) ) {
		return error;
	}
	return Object.assign( new Error( `${ error.message } (${ error.error })` ), { cause: error } );
}

export async function fetchSyncableSites(
	token: string,
	options: { planRequired?: boolean } = {}
): Promise< SyncSite[] > {
	try {
		return await fetchSyncableSitesBase( token, options );
	} catch ( error ) {
		throw wrapError( __( 'Failed to fetch WordPress.com sites' ), error, 'site_fetch' );
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
		throw wrapError( __( 'Failed to initiate import on remote site' ), error, 'remote_import' );
	}
}

export async function pollImportStatus(
	token: string,
	remoteSiteId: number
): Promise< ImportResponse > {
	try {
		return await pollImportStatusBase( token, remoteSiteId );
	} catch ( error ) {
		throw wrapError( __( 'Failed to check import status' ), error, 'remote_import' );
	}
}

export async function fetchLatestRewindId(
	token: string,
	remoteSiteId: number
): Promise< string > {
	try {
		return await fetchLatestRewindIdBase( token, remoteSiteId );
	} catch ( error ) {
		throw wrapError( __( 'Failed to fetch latest rewind ID' ), error, 'remote_backup' );
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
		throw wrapError( __( 'Failed to fetch remote file tree' ), error, 'remote_backup' );
	}
}
