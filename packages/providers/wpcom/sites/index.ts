import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { ProviderNotReadyError, RemoteSiteError } from '../../errors';
import {
	checkBackupSize,
	fetchLatestRewindId,
	fetchRemoteFileTreeContents,
	fetchSyncableSites,
	initiateBackup,
	initiateImport,
	launchSite,
	pollBackupStatus,
	pollImportStatus,
} from './api';
import { enableReprintExporter, getReprintApiUrl, installReprintPublicKey } from './reprint';
import { createTusUpload } from './upload';
import type { SitesService } from '../../types';
import type { WpcomConfig } from '../config';
import type { SyncSite } from '../site';
import type { ImportResponse } from './schemas';

const POLL_INTERVAL_MS = 3000;
// Remote imports and backups can sit on one progress value for a long time on
// large sites, and the remote reports its own timeouts as a `failed` status.
const MAX_STALLED_POLLS = ( 60 * 60 * 1000 ) / POLL_INTERVAL_MS;

function requireToken( config: WpcomConfig | undefined ): string {
	if ( ! config?.token ) {
		throw new ProviderNotReadyError( __( 'Log in to WordPress.com to sync sites.' ) );
	}
	return config.token;
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

// Runs one remote step, turning its failure into a message for the user and
// the cause for analytics.
async function step< T >( message: string, code: string, run: () => Promise< T > ): Promise< T > {
	try {
		return await run();
	} catch ( error ) {
		if ( error instanceof RemoteSiteError || error instanceof ProviderNotReadyError ) {
			throw error;
		}
		if ( error instanceof z.ZodError ) {
			throw new RemoteSiteError( __( 'Invalid API response format' ), code, { cause: error } );
		}
		throw new RemoteSiteError( message, code, { cause: withServerDetail( error ) } );
	}
}

function sleep( ms: number, signal?: AbortSignal ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const timer = setTimeout( resolve, ms );
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout( timer );
				reject( signal.reason );
			},
			{ once: true }
		);
	} );
}

function getImportFailureMessage( response: Extract< ImportResponse, { status: 'failed' } > ) {
	if ( /importing sql dump/i.test( response.error_data?.vp_restore_message ?? '' ) ) {
		return __(
			'The database failed to import on the live site. Review your database and try again.'
		);
	}
	if ( response.error === 'Import timed out' ) {
		return __(
			'The live site timed out while importing, likely because the site is too large. Try reducing its content or files.'
		);
	}
	return __( 'Something went wrong while updating the live site.' );
}

export const wpcomSites: SitesService< WpcomConfig, SyncSite > = {
	list: ( config, options = {} ) =>
		step( __( 'Failed to fetch WordPress.com sites' ), 'site_fetch', () =>
			fetchSyncableSites( requireToken( config ), {
				connectedSiteIds: options.connectedIds,
				planRequired: options.planRequired,
			} )
		),

	async push( config, site, content, options, onStatus, signal ) {
		const token = requireToken( config );
		if ( content.kind !== 'archive' ) {
			throw new Error( 'WordPress.com imports a WordPress archive.' );
		}
		signal?.throwIfAborted();

		onStatus( { phase: 'uploading', progress: 0 } );
		const upload = createTusUpload( {
			token,
			remoteSiteId: site.id,
			file: content.file,
			filename: content.name,
			size: content.size,
			onProgress: ( percent ) => onStatus( { phase: 'uploading', progress: percent } ),
		} );
		signal?.addEventListener( 'abort', upload.abort, { once: true } );
		const attachmentId = await step( __( 'Failed to upload archive' ), 'upload', () =>
			upload.promise.finally( () => signal?.removeEventListener( 'abort', upload.abort ) )
		);

		onStatus( { phase: 'creatingRemoteBackup', progress: 0 } );
		await step( __( 'Failed to initiate import on remote site' ), 'remote_import', async () => {
			try {
				await initiateImport( token, site.id, attachmentId, options );
			} catch ( error ) {
				if ( error instanceof Error && 'statusCode' in error && error.statusCode === 409 ) {
					throw new RemoteSiteError(
						__(
							'A sync operation is already in progress on this site. Please wait for it to finish and try again.'
						),
						'remote_import'
					);
				}
				throw error;
			}
		} );

		let lastReport = '';
		for ( let stalledPolls = 0; stalledPolls < MAX_STALLED_POLLS;  ) {
			signal?.throwIfAborted();
			const status = await step( __( 'Failed to check import status' ), 'remote_import', () =>
				pollImportStatus( token, site.id )
			);
			if ( status.status === 'failed' ) {
				throw new RemoteSiteError( getImportFailureMessage( status ), 'remote_import' );
			}
			if ( ! status.success ) {
				throw new RemoteSiteError(
					__( 'Something went wrong while updating the live site.' ),
					'remote_import'
				);
			}
			if ( status.status === 'finished' ) {
				if ( options.launchAfterPush ) {
					onStatus( { phase: 'launching' } );
					try {
						await launchSite( token, site.id );
					} catch ( error ) {
						const reason = error instanceof Error && 'error' in error ? String( error.error ) : '';
						return {
							launchError:
								reason === 'email_unverified'
									? __(
											'Changes pushed, but the site could not be launched. Verify your email, then publish again to retry launching.'
									  )
									: reason === 'unauthorized'
									? __(
											'Changes pushed, but the site could not be launched. Check your plan and permissions, then publish again to retry launching.'
									  )
									: __(
											'Changes pushed, but the site could not be launched. Publish again to retry launching.'
									  ),
						};
					}
				}
				return;
			}

			const report =
				status.status === 'archive_import_started'
					? { phase: 'applyingChanges' as const, progress: status.import_progress ?? undefined }
					: status.status === 'archive_import_finished'
					? { phase: 'finishing' as const }
					: {
							phase: 'creatingRemoteBackup' as const,
							progress: status.backup_progress ?? undefined,
					  };
			// Reported on every poll, even unchanged, so a Studio app that restarts or reloads while
			// the live site updates shows the push again.
			onStatus( report );
			const key = `${ report.phase }:${ Math.round( report.progress ?? 0 ) }`;
			stalledPolls = key === lastReport ? stalledPolls + 1 : 0;
			lastReport = key;

			await sleep( POLL_INTERVAL_MS, signal );
		}

		throw new RemoteSiteError(
			sprintf(
				__(
					'%s stopped reporting import progress, but the update may still be running. Check the live site before pushing again.'
				),
				site.name
			),
			'timeout'
		);
	},

	pull: {
		async backup( config, site, options, onProgress, signal ) {
			const token = requireToken( config );
			const backupId = await step( __( 'Failed to initiate backup' ), 'remote_backup', () =>
				initiateBackup( token, site.id, {
					optionsToSync: options.optionsToSync ?? [ 'all' ],
					includePathList: options.includePathList?.length ? options.includePathList : undefined,
				} )
			);

			let lastPercent = -1;
			for ( let stalledPolls = 0; stalledPolls < MAX_STALLED_POLLS;  ) {
				signal?.throwIfAborted();
				const status = await step( __( 'Failed to check backup status' ), 'remote_backup', () =>
					pollBackupStatus( token, site.id, backupId )
				);
				if ( status.status === 'failed' ) {
					throw new RemoteSiteError( __( 'Remote backup failed' ), 'remote_backup' );
				}
				if ( status.status === 'finished' && status.downloadUrl ) {
					const url = status.downloadUrl;
					const size = await step( __( 'Failed to check backup size' ), 'remote_backup', () =>
						checkBackupSize( url )
					);
					return { url, size };
				}
				onProgress( status.percent );
				const percent = Math.round( status.percent );
				stalledPolls = percent === lastPercent ? stalledPolls + 1 : 0;
				lastPercent = percent;
				await sleep( POLL_INTERVAL_MS, signal );
			}
			throw new RemoteSiteError( __( 'Backup timed out — no progress detected' ), 'timeout' );
		},

		async openExporter( config, site ) {
			const hasKey = await enableReprintExporter( site.id, requireToken( config ) );
			return { apiUrl: getReprintApiUrl( site.url ), hasKey };
		},

		installExporterKey: ( config, site, publicKey ) =>
			installReprintPublicKey( site.id, requireToken( config ), publicKey ),

		latestBackupId: ( config, site ) =>
			step( __( 'Failed to fetch latest rewind ID' ), 'remote_backup', async () => {
				try {
					return await fetchLatestRewindId( requireToken( config ), site.id );
				} catch ( error ) {
					const missingBackup =
						error instanceof Error &&
						( error.message === 'No rewind ID available' ||
							( 'statusCode' in error &&
								error.statusCode === 412 &&
								'error' in error &&
								error.error === 'rest_forbidden' ) );
					if ( missingBackup ) {
						throw new RemoteSiteError( __( 'Failed to fetch latest rewind ID' ), 'missing_backup', {
							cause: error,
						} );
					}
					throw error;
				}
			} ),

		listBackupFiles: ( config, site, backupId, path ) =>
			step( __( 'Failed to fetch remote file tree' ), 'remote_backup', () =>
				fetchRemoteFileTreeContents( requireToken( config ), site.id, backupId, path )
			),
	},
};
