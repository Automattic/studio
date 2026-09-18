import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { killChild } from '@studio/common/lib/cli-process';
import { SyncCancelledError } from '@studio/common/lib/sync/cancel';
import {
	SYNC_MAX_STALLED_ATTEMPTS,
	SYNC_POLL_INTERVAL_MS,
} from '@studio/common/lib/sync/constants';
import { initiateImport, pollImportStatus } from '@studio/common/lib/sync/sync-api';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type {
	ImportResponse,
	PullSiteProgress,
	PullSyncOptions,
	PushOutput,
	PushPhase,
	PushSyncOptions,
	SyncOption,
} from '@studio/common/types/sync';

export type { PushOutput, PushPhase } from '@studio/common/types/sync';

/**
 * WordPress.com sync operations. Pull is delegated to the Studio CLI; push uses
 * the shared upload/import primitives.
 */

export interface PushSiteContext {
	executeCliCommand: ExecuteCliCommand;
	accessToken: string;
	emit?: ( output: PushOutput ) => void;
}

function throwIfCancelled( signal: AbortSignal | undefined ): void {
	if ( signal?.aborted ) {
		throw new SyncCancelledError();
	}
}

/**
 * Push a local site to its connected WordPress.com live site: export a full
 * archive via the CLI, TUS-upload it (shared {@link createTusUpload}), initiate
 * the remote import (shared {@link initiateImport}), then wait for that import
 * to finish. Resolves once the live site is updated; rejects on any failure.
 */
export async function pushSite(
	ctx: PushSiteContext,
	params: {
		sitePath: string;
		remoteSiteId: number;
		options?: PushSyncOptions;
		signal?: AbortSignal;
	}
): Promise< void > {
	const { signal } = params;
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-push-' ) );
	const archivePath = path.join( dir, `site_${ crypto.randomUUID() }.tar.gz` );

	try {
		throwIfCancelled( signal );

		ctx.emit?.( { kind: 'phase', phase: 'creatingBackup' } );
		await new Promise< void >( ( resolve, reject ) => {
			const [ emitter, child ] = ctx.executeCliCommand(
				[
					'export',
					'--path',
					params.sitePath,
					archivePath,
					'--mode',
					getExportMode( params.options?.optionsToSync ),
					'--split-db-dump-by-table',
					'--apply-deploy-ignore',
					...( params.options?.specificSelectionPaths?.length
						? [ '--include-only', ...params.options.specificSelectionPaths ]
						: [] ),
					// `studio_site_exported` means a user-initiated backup export — sync pushes are not counted.
					'--suppress-tracks-event',
				],
				{ output: 'capture' }
			);
			const stopExport = () => {
				// See `pullSite` — the cancel must settle even if the kill fails.
				try {
					killChild( child );
					console.log( `[push] Stopped CLI process ${ child.pid ?? '(no pid)' }` );
				} catch ( error ) {
					console.error( '[push] Failed to stop the CLI process', error );
				}
				reject( new SyncCancelledError() );
			};
			signal?.addEventListener( 'abort', stopExport, { once: true } );
			const done = ( settle: () => void ) => () => {
				signal?.removeEventListener( 'abort', stopExport );
				settle();
			};
			emitter.on( 'success', done( resolve ) );
			emitter.on( 'failure', ( { error } ) => done( () => reject( error ) )() );
			emitter.on( 'error', ( { error } ) => done( () => reject( error ) )() );
		} );

		throwIfCancelled( signal );

		ctx.emit?.( { kind: 'phase', phase: 'uploading' } );
		const { promise, abort } = createTusUpload( {
			token: ctx.accessToken,
			remoteSiteId: params.remoteSiteId,
			archivePath,
			onProgress: ( progress ) => ctx.emit?.( { kind: 'upload-progress', progress } ),
			onNetworkPause: ( error ) => ctx.emit?.( { kind: 'network-paused', error } ),
			onResume: () => ctx.emit?.( { kind: 'resumed' } ),
		} );
		signal?.addEventListener( 'abort', abort, { once: true } );
		let attachmentId: string;
		try {
			attachmentId = await promise;
		} catch ( error ) {
			throwIfCancelled( signal );
			throw error;
		} finally {
			signal?.removeEventListener( 'abort', abort );
		}

		throwIfCancelled( signal );

		// Point of no return: once the remote import is initiated, cancelling
		// locally would leave the live site mid-import anyway, so the UI stops
		// offering it from here on.
		ctx.emit?.( { kind: 'phase', phase: 'creatingRemoteBackup' } );
		await initiateImport( ctx.accessToken, params.remoteSiteId, attachmentId, params.options );
		await waitForImport( ctx, params.remoteSiteId );
	} finally {
		await fs.promises.rm( dir, { recursive: true, force: true } ).catch( () => undefined );
	}
}

/**
 * Wait for the remote import to finish, reporting the phase it is in.
 *
 * WordPress.com takes a safety backup of the live site before importing, which
 * routinely takes longer than the upload itself. Without this the push would
 * report success while the live site was still being rebuilt, and a second push
 * would be rejected with "another import is already in progress". Mirrors the
 * legacy renderer's `pollPushProgressThunk`.
 */
async function waitForImport( ctx: PushSiteContext, remoteSiteId: number ): Promise< void > {
	let lastReport = '';
	let stalledPolls = 0;

	while ( stalledPolls < SYNC_MAX_STALLED_ATTEMPTS ) {
		await new Promise( ( resolve ) => setTimeout( resolve, SYNC_POLL_INTERVAL_MS ) );

		const response = await pollImportStatus( ctx.accessToken, remoteSiteId );

		if ( response.status === 'failed' ) {
			throw new Error( getImportFailureMessage( response ) );
		}
		if ( ! response.success ) {
			throw new Error( __( 'Something went wrong while updating the live site.' ) );
		}
		if ( response.status === 'finished' ) {
			return;
		}

		const { phase, progress } = getImportPhase( response );
		ctx.emit?.( { kind: 'phase', phase, progress } );

		const report = `${ phase }:${ progress ?? '' }`;
		stalledPolls = report === lastReport ? stalledPolls + 1 : 0;
		lastReport = report;
	}

	// The remote reports its own timeouts as a `failed` status, so reaching here
	// means it went quiet rather than gave up. Bail instead of polling forever.
	throw new Error(
		__( 'The live site stopped reporting progress. Check the site and try again.' )
	);
}

function getImportPhase(
	response: Extract< ImportResponse, { status: Exclude< ImportResponse[ 'status' ], 'failed' > } >
): { phase: PushPhase; progress?: number } {
	switch ( response.status ) {
		case 'archive_import_started':
			return { phase: 'applyingChanges', progress: response.import_progress ?? undefined };
		case 'archive_import_finished':
			return { phase: 'finishing' };
		default:
			return { phase: 'creatingRemoteBackup', progress: response.backup_progress ?? undefined };
	}
}

// Mirrors the legacy renderer's push failure copy (`pollPushProgressThunk`):
// a failed SQL import and a timeout need different things from the user.
function getImportFailureMessage(
	response: Extract< ImportResponse, { status: 'failed' } >
): string {
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

// Mirrors the legacy renderer's export-mode derivation
// (apps/studio/src/modules/sync/lib/ipc-handlers.ts `exportSiteForPush`):
// no options (or 'all') exports the full site.
function getExportMode( optionsToSync: SyncOption[] | undefined ): 'full' | 'content' | 'db' {
	const shouldInclude = ( option: SyncOption ): boolean =>
		! optionsToSync || optionsToSync.includes( option ) || optionsToSync.includes( 'all' );

	const includesDatabase = shouldInclude( 'sqls' );
	const includesWpContent = ( [ 'uploads', 'plugins', 'themes', 'contents' ] as const ).some(
		shouldInclude
	);

	if ( includesDatabase && includesWpContent ) {
		return 'full';
	}
	return includesWpContent ? 'content' : 'db';
}

/**
 * Pull a local site from its connected WordPress.com live site via the CLI
 * `pull` command. Exchanges everything (`--options all`) unless selective
 * options are provided. Resolves on success, rejects on failure.
 */
export function pullSite(
	executeCliCommand: ExecuteCliCommand,
	siteFolder: string,
	remoteSiteId: number,
	emit?: ( output: PullSiteProgress ) => void,
	options?: PullSyncOptions,
	signal?: AbortSignal
): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		if ( signal?.aborted ) {
			reject( new SyncCancelledError() );
			return;
		}

		const [ emitter, child ] = executeCliCommand(
			[
				'pull',
				'--path',
				siteFolder,
				'--remote-site',
				String( remoteSiteId ),
				'--options',
				( options?.optionsToSync?.length ? options.optionsToSync : [ 'all' ] ).join( ',' ),
				// Pass each backup node id as its own argv value — ids can contain
				// commas (e.g. themes `cjE6,ZjE6Lw==`), so a join/split would corrupt them.
				...( options?.includePathList?.length
					? [ '--include-path-list', ...options.includePathList ]
					: [] ),
				// The caller emits `studio_sync_pull` itself — the CLI is an
				// implementation detail here, not a standalone `studio pull`.
				'--suppress-tracks-event',
			],
			{ output: 'capture' }
		);

		const stopPull = () => {
			// Reject even if the kill fails — otherwise a cancel would hang the
			// caller forever instead of stopping.
			try {
				killChild( child );
				console.log( `[pull] Stopped CLI process ${ child.pid ?? '(no pid)' }` );
			} catch ( error ) {
				console.error( '[pull] Failed to stop the CLI process', error );
			}
			reject( new SyncCancelledError() );
		};
		signal?.addEventListener( 'abort', stopPull, { once: true } );
		const settle = ( run: () => void ) => {
			signal?.removeEventListener( 'abort', stopPull );
			run();
		};

		emitter.on( 'data', ( { data } ) => {
			const progress = data as { status?: unknown; message?: unknown; action?: unknown } | null;
			if ( progress?.status !== 'inprogress' || typeof progress.message !== 'string' ) {
				return;
			}

			const percent = /\((\d+)%\)/.exec( progress.message )?.[ 1 ];
			emit?.( {
				message: progress.message,
				...( percent ? { progress: Math.min( 100, Number( percent ) ) } : {} ),
				...( typeof progress.action === 'string' ? { action: progress.action } : {} ),
			} );
		} );
		emitter.on( 'success', () => settle( resolve ) );
		emitter.on( 'failure', ( { error } ) => settle( () => reject( error ) ) );
		emitter.on( 'error', ( { error } ) => settle( () => reject( error ) ) );
	} );
}
