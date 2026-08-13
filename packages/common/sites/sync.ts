import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { killChild } from '@studio/common/lib/cli-process';
import { SyncCancelledError } from '@studio/common/lib/sync/cancel';
import { initiateImport } from '@studio/common/lib/sync/sync-api';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type {
	PullSiteProgress,
	PullSyncOptions,
	PushOutput,
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
 * archive via the CLI, TUS-upload it (shared {@link createTusUpload}), then
 * initiate the remote import (shared {@link initiateImport}). Resolves once the
 * import is initiated; rejects on any failure.
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
		ctx.emit?.( { kind: 'phase', phase: 'applyingChanges' } );
		await initiateImport( ctx.accessToken, params.remoteSiteId, attachmentId, params.options );
	} finally {
		await fs.promises.rm( dir, { recursive: true, force: true } ).catch( () => undefined );
	}
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
