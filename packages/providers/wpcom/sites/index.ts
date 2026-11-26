import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { NotConnectedError, RemoteSiteError } from '../../errors';
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
import { createPreview, deletePreview, getEditedAt, listPreviews, updatePreview } from './previews';
import { enableReprintExporter, getReprintApiUrl, installReprintPublicKey } from './reprint';
import { createTusUpload } from './upload';
import { getWpcomSiteVisibility, setWpcomSiteVisibility } from './visibility';
import type { PushStatus, SitesServices } from '../../types';
import type { WpcomConfig } from '../config';
import type { ImportResponse } from './schemas';
import type { SyncSite } from './site';

const POLL_INTERVAL_MS = 3000;
// Remote backups can sit on one progress value for a long time on large sites.
const MAX_STALLED_POLLS = ( 60 * 60 * 1000 ) / POLL_INTERVAL_MS;
// The live site's import keeps one progress value for hours while it restores a large site's
// files, and it fails the import itself after about 6 hours ("Import timed out"). This only
// covers a status that never resolves.
const IMPORT_DEADLINE_MS = 7 * 60 * 60 * 1000;
// The live site keeps importing or backing up while this computer is offline or WordPress.com has
// a short outage, so a status check that fails that way is tried again for this long.
const MAX_FAILED_POLLS = ( 60 * 1000 ) / POLL_INTERVAL_MS;

function requireToken( config: WpcomConfig | undefined ): string {
	if ( ! config?.token ) {
		throw new NotConnectedError( __( 'Log in to WordPress.com to sync sites.' ) );
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
		if ( error instanceof RemoteSiteError || error instanceof NotConnectedError ) {
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

// A request that never reached WordPress.com has no HTTP status, only the network error's code,
// such as ENOTFOUND.
function isTransient( error: unknown ): boolean {
	if ( ! ( error instanceof Error ) ) {
		return false;
	}
	if ( 'statusCode' in error ) {
		const status = Number( error.statusCode );
		return status === 429 || status >= 500;
	}
	return 'code' in error && typeof error.code === 'string';
}

// Like `step`, for a status check: tries a temporary failure again.
async function pollStep< T >(
	message: string,
	code: string,
	run: () => Promise< T >,
	signal?: AbortSignal
): Promise< T > {
	for ( let failed = 1; ; failed++ ) {
		try {
			return await run();
		} catch ( error ) {
			if ( failed >= MAX_FAILED_POLLS || ! isTransient( error ) ) {
				return step( message, code, () => Promise.reject( error ) );
			}
		}
		await sleep( POLL_INTERVAL_MS, signal );
	}
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

// Polls the live site's import until it ends, reporting each step, and returns how it ended.
async function followImport(
	token: string,
	site: Pick< SyncSite, 'id' | 'name' >,
	onStatus: ( status: PushStatus ) => void,
	signal?: AbortSignal
): Promise< ImportResponse > {
	const lostTrack = sprintf(
		// translators: %s: the name of a WordPress.com site
		__(
			'Studio lost track of the update to %s, but the update may still be running. Check the live site before pushing again.'
		),
		site.name
	);
	const deadline = Date.now() + IMPORT_DEADLINE_MS;
	while ( Date.now() < deadline ) {
		signal?.throwIfAborted();
		const status = await pollStep(
			lostTrack,
			'remote_import',
			() => pollImportStatus( token, site.id ),
			signal
		);
		if ( status.status === 'failed' || status.status === 'finished' || ! status.success ) {
			return status;
		}

		const report: PushStatus =
			status.status === 'archive_import_started'
				? { phase: 'applyingChanges', progress: status.import_progress ?? undefined }
				: status.status === 'archive_import_finished'
				? { phase: 'finishing' }
				: { phase: 'creatingRemoteBackup', progress: status.backup_progress ?? undefined };
		// Reported on every poll, even unchanged, so a Studio app that restarts or reloads while
		// the live site updates shows the push again.
		onStatus( report );

		await sleep( POLL_INTERVAL_MS, signal );
	}

	throw new RemoteSiteError(
		sprintf(
			__(
				'%s is taking longer than expected to update, but the update may still be running. Check the live site before pushing again.'
			),
			site.name
		),
		'timeout'
	);
}

export const wpcomSites: SitesServices< WpcomConfig, SyncSite > = {
	visibility: {
		get: ( config, id ) => getWpcomSiteVisibility( requireToken( config ), Number( id ) ),
		set: ( config, id, value ) =>
			setWpcomSiteVisibility( requireToken( config ), Number( id ), value ),
	},
	list: ( config, options = {} ) =>
		step( __( 'Failed to fetch WordPress.com sites' ), 'site_fetch', () =>
			fetchSyncableSites( requireToken( config ), {
				connectedSiteIds: options.connectedIds,
				planRequired: options.planRequired,
			} )
		),

	async push( config, site, content, options, onStatus, signal ) {
		const token = requireToken( config );
		if ( options.preview ) {
			return updatePreview( token, site.id, content, options.preview, onStatus, signal );
		}
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

		// The live site runs one import at a time and refuses another with a 409 while one runs: wait
		// for it to end, then start this one from the archive already uploaded.
		for (;;) {
			onStatus( { phase: 'creatingRemoteBackup', progress: 0 } );
			const conflict = await step(
				__( 'Failed to initiate import on remote site' ),
				'remote_import',
				async () => {
					try {
						await initiateImport( token, site.id, attachmentId, options );
						return undefined;
					} catch ( error ) {
						if ( error instanceof Error && 'statusCode' in error && error.statusCode === 409 ) {
							return error;
						}
						throw error;
					}
				}
			);
			if ( ! conflict ) {
				break;
			}
			const running = await pollImportStatus( token, site.id ).catch( () => undefined );
			if ( ! running?.success || running.status === 'finished' || running.status === 'failed' ) {
				// The other reason the live site refuses an import is a sync with its staging site.
				throw new RemoteSiteError(
					__(
						'The live site is syncing with its staging site. Wait for that to finish and try again.'
					),
					'remote_import',
					{ cause: withServerDetail( conflict ) }
				);
			}
			await followImport( token, site, () => onStatus( { phase: 'waitingForRemote' } ), signal );
			signal?.throwIfAborted();
		}

		const status = await followImport( token, site, onStatus, signal );
		if ( status.status === 'failed' ) {
			throw new RemoteSiteError( getImportFailureMessage( status ), 'remote_import', {
				cause: new Error( status.error_data?.vp_restore_message || status.error ),
			} );
		}
		if ( ! status.success ) {
			throw new RemoteSiteError(
				__( 'Something went wrong while updating the live site.' ),
				'remote_import'
			);
		}
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
	},

	previews: {
		create: ( config, content, options, onStatus, signal ) =>
			createPreview( requireToken( config ), content, options, onStatus, signal ),
		list: ( config ) => listPreviews( requireToken( config ) ),
		delete: ( config, preview ) => deletePreview( requireToken( config ), Number( preview.id ) ),
	},

	editedAt: ( config, site ) => getEditedAt( requireToken( config ), site.id ),

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
				const status = await pollStep(
					__( 'Failed to check backup status' ),
					'remote_backup',
					() => pollBackupStatus( token, site.id, backupId ),
					signal
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
