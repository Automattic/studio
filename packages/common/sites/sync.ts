import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initiateImport } from '@studio/common/lib/sync/sync-api';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type {
	PullEngine,
	PullSiteProgress,
	PullSyncOptions,
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

		const { promise } = createTusUpload( {
			token: ctx.accessToken,
			remoteSiteId: params.remoteSiteId,
			archivePath,
			onProgress: ( progress ) => ctx.emit?.( { kind: 'upload-progress', progress } ),
			onNetworkPause: ( error ) => ctx.emit?.( { kind: 'network-paused', error } ),
			onResume: () => ctx.emit?.( { kind: 'resumed' } ),
		} );
		const attachmentId = await promise;

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
 * Pull a local site from its connected WordPress.com live site via the CLI.
 * `jetpack` runs `pull`, exchanging everything (`--options all`) unless
 * selective options are provided; `reprint` runs `pull-reprint`, which pulls
 * everything when driven non-interactively — except when it resumes a pull
 * that was interrupted mid-flight, which reprint requires to keep its original
 * content selection. Both commands take the same `--remote-site` identifier.
 * Resolves on success, rejects on failure.
 *
 * `syncOptions` reaches the `jetpack` engine only: it selects by backup node
 * id, whereas reprint selects by wp-content path (`--only`), so there is
 * nothing to map it onto. A reprint pull ignores the selection and pulls
 * everything.
 *
 * Only the arguments differ per engine. The progress parsing below is the
 * CLI-wide `reportProgress` envelope plus the `(N%)` token that `pull`,
 * `pull-reprint`, `push` and `import` all emit, so both engines share it.
 */
export function pullSite(
	executeCliCommand: ExecuteCliCommand,
	siteFolder: string,
	remoteSiteId: number,
	{
		emit,
		engine = 'jetpack',
		syncOptions,
	}: {
		emit?: ( output: PullSiteProgress ) => void;
		engine?: PullEngine;
		syncOptions?: PullSyncOptions;
	} = {}
): Promise< void > {
	const target = [ '--path', siteFolder, '--remote-site', String( remoteSiteId ) ];
	const args =
		engine === 'reprint'
			? [ 'pull-reprint', ...target ]
			: [
					'pull',
					...target,
					'--options',
					( syncOptions?.optionsToSync?.length ? syncOptions.optionsToSync : [ 'all' ] ).join(
						','
					),
					// Pass each backup node id as its own argv value — ids can contain
					// commas (e.g. themes `cjE6,ZjE6Lw==`), so a join/split would corrupt them.
					...( syncOptions?.includePathList?.length
						? [ '--include-path-list', ...syncOptions.includePathList ]
						: [] ),
			  ];

	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand( args, { output: 'capture' } );
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
