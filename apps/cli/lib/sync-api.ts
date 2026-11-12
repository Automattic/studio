import fs from 'fs';
import { Readable } from 'stream';
import { syncOptionSchema } from '@studio/common/types/sync';
import { backupLsItemSchema } from '@studio/common/types/sync-tree';
import { ProviderNotReadyError, RemoteSiteError } from '@studio/providers';
import { getProvider } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import type { SyncSite, SyncOption, PullSyncOptions } from '@studio/common/types/sync';

export const wpcomSites = getProvider( 'wpcom' ).sites!;

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

// Keeps a provider's message and its analytics code, so the failure is reported
// against the step that failed.
export function toLoggerError( error: unknown, fallback: string ): LoggerError {
	if ( error instanceof LoggerError ) {
		return error;
	}
	if ( error instanceof RemoteSiteError ) {
		return new LoggerError( error.message, error.cause, error.code );
	}
	if ( error instanceof ProviderNotReadyError ) {
		return new LoggerError( error.message, error, 'auth_required' );
	}
	return new LoggerError( fallback, error );
}

async function remote< T >( fallback: string, run: () => Promise< T > ): Promise< T > {
	try {
		return await run();
	} catch ( error ) {
		throw toLoggerError( error, fallback );
	}
}

export function fetchSyncableSites(
	token: string,
	options: { planRequired?: boolean } = {}
): Promise< SyncSite[] > {
	return remote( __( 'Failed to fetch WordPress.com sites' ), () =>
		wpcomSites.list( { token }, options )
	);
}

export function backupRemoteSite(
	token: string,
	remoteSiteId: number,
	options: PullSyncOptions,
	onProgress: ( percent: number ) => void
): Promise< { url: string; size: number } > {
	return remote( __( 'Failed to back up the remote site' ), () =>
		wpcomSites.pull!.backup( { token }, { id: remoteSiteId }, options, onProgress )
	);
}

export async function downloadBackup( url: string, destPath: string ): Promise< void > {
	try {
		const response = await fetch( url );
		if ( ! response.ok || ! response.body ) {
			throw new Error( 'Failed to download backup' );
		}

		const fileStream = fs.createWriteStream( destPath );
		const readable = Readable.fromWeb( response.body as import('stream/web').ReadableStream );

		await new Promise< void >( ( resolve, reject ) => {
			readable.pipe( fileStream );
			fileStream.on( 'finish', resolve );
			fileStream.on( 'error', reject );
			readable.on( 'error', reject );
		} );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to download backup' ), error, 'network' );
	}
}

export function fetchLatestRewindId( token: string, remoteSiteId: number ): Promise< string > {
	return remote( __( 'Failed to fetch latest rewind ID' ), () =>
		wpcomSites.pull!.latestBackupId( { token }, { id: remoteSiteId } )
	);
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
	const contents = await remote( __( 'Failed to fetch remote file tree' ), () =>
		wpcomSites.pull!.listBackupFiles( { token }, { id: remoteSiteId }, rewindId, treePath )
	);

	const entries: RemoteFileEntry[] = [];
	for ( const [ name, rawItem ] of Object.entries( contents ) ) {
		const itemResult = backupLsItemSchema.safeParse( rawItem );
		if ( itemResult.success ) {
			const item = itemResult.data;
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
