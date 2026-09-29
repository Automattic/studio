import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	createSpacefastSpace,
	getSpacefastSpace,
	publishDirectoryToSpacefast,
} from '@studio/common/lib/spacefast/api';
import { saveSpacefastConnection } from '@studio/common/lib/spacefast/config';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type {
	SpacefastConnection,
	SpacefastPublishProgress,
	SpacefastPublishTarget,
} from '@studio/common/types/spacefast';

export interface PublishToSpacefastContext {
	apiKey: string;
	// Writes a static export of the site to `outputDir`, which doesn't exist yet.
	exportStaticSite: ( outputDir: string ) => Promise< void >;
	onProgress?: ( progress: SpacefastPublishProgress ) => void;
}

/**
 * Export a local site as static files and publish them as the live version of a
 * Spacefast Space, creating the Space first when asked to. The Space is remembered
 * for the site so later publishes update it.
 */
export async function publishSiteToSpacefast(
	ctx: PublishToSpacefastContext,
	{ siteId, target }: { siteId: string; target: SpacefastPublishTarget }
): Promise< SpacefastConnection > {
	const space =
		'spaceId' in target
			? await getSpacefastSpace( ctx.apiKey, target.spaceId )
			: await createSpacefastSpace( ctx.apiKey, target );

	const dir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-spacefast-' ) );
	try {
		const outputDir = path.join( dir, 'site' );
		ctx.onProgress?.( { phase: 'exporting' } );
		await ctx.exportStaticSite( outputDir );

		await publishDirectoryToSpacefast(
			ctx.apiKey,
			space.id,
			outputDir,
			( progress ) =>
				ctx.onProgress?.(
					progress.uploaded < progress.total
						? { phase: 'uploading', ...progress }
						: { phase: 'finalizing' }
				)
		);
	} finally {
		await fs.promises.rm( dir, { recursive: true, force: true } ).catch( () => undefined );
	}

	const connection: SpacefastConnection = {
		spaceId: space.id,
		title: space.title,
		liveUrl: space.liveUrl,
		lastPublishedAt: Date.now(),
	};
	await saveSpacefastConnection( siteId, connection );
	return connection;
}

// Runs the export through the Studio CLI, for hosts (the desktop app, `studio ui`) that
// fork it rather than run it in process.
export function exportStaticSiteWithCli(
	executeCliCommand: ExecuteCliCommand,
	sitePath: string
): ( outputDir: string ) => Promise< void > {
	return ( outputDir ) =>
		new Promise( ( resolve, reject ) => {
			const [ emitter ] = executeCliCommand( [ 'export-static', outputDir, '--path', sitePath ], {
				output: 'capture',
			} );
			emitter.on( 'success', () => resolve() );
			emitter.on( 'failure', ( { error } ) => reject( error ) );
			emitter.on( 'error', ( { error } ) => reject( error ) );
		} );
}
