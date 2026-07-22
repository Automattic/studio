import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initiateImport } from '@studio/common/lib/sync/sync-api';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type { PullSiteProgress } from '@studio/common/types/sync';

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
	params: { sitePath: string; remoteSiteId: number }
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
					'full',
					'--split-db-dump-by-table',
					'--apply-deploy-ignore',
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

		await initiateImport( ctx.accessToken, params.remoteSiteId, attachmentId );
	} finally {
		await fs.promises.rm( dir, { recursive: true, force: true } ).catch( () => undefined );
	}
}

/**
 * Pull a local site from its connected WordPress.com live site via the CLI
 * `pull` command, exchanging everything (`--options all`). Resolves on success,
 * rejects on failure.
 */
export function pullSite(
	executeCliCommand: ExecuteCliCommand,
	siteFolder: string,
	remoteSiteId: number,
	emit?: ( output: PullSiteProgress ) => void
): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand(
			[ 'pull', '--path', siteFolder, '--remote-site', String( remoteSiteId ), '--options', 'all' ],
			{ output: 'capture' }
		);
		emitter.on( 'data', ( { data } ) => {
			if (
				! data ||
				typeof data !== 'object' ||
				! ( 'status' in data ) ||
				data.status !== 'inprogress' ||
				! ( 'message' in data ) ||
				typeof data.message !== 'string'
			) {
				return;
			}

			const percent = /\((\d+)%\)/.exec( data.message )?.[ 1 ];
			emit?.( {
				message: data.message,
				...( percent ? { progress: Math.min( 100, Number( percent ) ) } : {} ),
			} );
		} );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}
