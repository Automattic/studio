import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initiateImport } from '@studio/common/lib/sync/sync-api';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type {
	PullSiteProgress,
	PullSyncOptions,
	PushSitePhase,
	PushSyncOptions,
	SyncOption,
} from '@studio/common/types/sync';

/**
 * WordPress.com sync operations. Pull is delegated to the Studio CLI; push uses
 * the shared upload/import primitives.
 */

// Progress a push reports for the UI (the desktop also exposes manual
// pause/resume; that lives in its own registry on top of these signals).
export type PushOutput =
	| { kind: 'phase'; phase: PushSitePhase }
	| { kind: 'upload-progress'; progress: number }
	| { kind: 'network-paused'; error: string }
	| { kind: 'resumed' };

export interface PushSiteContext {
	executeCliCommand: ExecuteCliCommand;
	accessToken: string;
	emit?: ( output: PushOutput ) => void;
}

/**
 * Push a local site to its connected WordPress.com live site: export a full
 * archive via the CLI, TUS-upload it (shared {@link createTusUpload}), then
 * initiate the remote import (shared {@link initiateImport}). Resolves once the
 * import is initiated; rejects on any failure.
 */
export async function pushSite(
	ctx: PushSiteContext,
	params: { sitePath: string; remoteSiteId: number; options?: PushSyncOptions }
): Promise< void > {
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-push-' ) );
	const archivePath = path.join( dir, `site_${ crypto.randomUUID() }.tar.gz` );

	try {
		ctx.emit?.( { kind: 'phase', phase: 'exporting' } );
		await new Promise< void >( ( resolve, reject ) => {
			const [ emitter ] = ctx.executeCliCommand(
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
			emitter.on( 'success', () => resolve() );
			emitter.on( 'failure', ( { error } ) => reject( error ) );
			emitter.on( 'error', ( { error } ) => reject( error ) );
		} );

		ctx.emit?.( { kind: 'phase', phase: 'uploading' } );
		const { promise } = createTusUpload( {
			token: ctx.accessToken,
			remoteSiteId: params.remoteSiteId,
			archivePath,
			onProgress: ( progress ) => ctx.emit?.( { kind: 'upload-progress', progress } ),
			onNetworkPause: ( error ) => ctx.emit?.( { kind: 'network-paused', error } ),
			onResume: () => ctx.emit?.( { kind: 'resumed' } ),
		} );
		const attachmentId = await promise;

		ctx.emit?.( { kind: 'phase', phase: 'importing' } );
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
	options?: PullSyncOptions
): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand(
			[
				'pull',
				'--path',
				siteFolder,
				'--remote-site',
				String( remoteSiteId ),
				'--options',
				( options?.optionsToSync?.length ? options.optionsToSync : [ 'all' ] ).join( ',' ),
				...( options?.includePathList?.length
					? [ '--include-path-list', options.includePathList.join( ',' ) ]
					: [] ),
			],
			{ output: 'capture' }
		);
		emitter.on( 'data', ( { data } ) => {
			const progress = data as { status?: unknown; message?: unknown } | null;
			if ( progress?.status !== 'inprogress' || typeof progress.message !== 'string' ) {
				return;
			}

			const percent = /\((\d+)%\)/.exec( progress.message )?.[ 1 ];
			emit?.( {
				message: progress.message,
				...( percent ? { progress: Math.min( 100, Number( percent ) ) } : {} ),
			} );
		} );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}
