import { z } from 'zod';
import { runCliCommand, type ExecuteCliCommand } from '@studio/common/lib/cli-process';
import { snapshotSchema, type Snapshot } from '@studio/common/types/snapshot';

/**
 * Preview-site (snapshot) operations, delegated to the Studio CLI.
 */

// What `preview create` and `preview update` report as their result.
const previewResultSchema = z.object( { name: z.string().optional(), url: z.string() } );

/**
 * Creates a preview site (named `name`, when given), or refreshes the one at `hostname`, and
 * resolves with its URL once the CLI command finishes. The command publishes its progress as sync
 * activity.
 */
export async function publishPreviewSite(
	executeCliCommand: ExecuteCliCommand,
	siteFolder: string,
	hostname?: string,
	name?: string,
	liveSite?: string
): Promise< { url: string } > {
	const { url } = await runCliCommand(
		executeCliCommand,
		[
			...( hostname
				? [ 'preview', 'update', '--path', siteFolder, hostname ]
				: [ 'preview', 'create', '--path', siteFolder, ...( name ? [ '--name', name ] : [] ) ] ),
			...( liveSite !== undefined ? [ '--live-site', liveSite ] : [] ),
		],
		previewResultSchema,
		{ logPrefix: 'preview' }
	);
	return { url };
}

export async function deletePreviewSite(
	executeCliCommand: ExecuteCliCommand,
	hostname: string
): Promise< void > {
	await runCliCommand( executeCliCommand, [ 'preview', 'delete', hostname ], previewResultSchema, {
		logPrefix: 'preview',
	} );
}

// What changed since Studio last pushed the local site to the preview or pulled the preview into
// it, as `studio preview status` reports. Each is null when Studio can't tell.
const previewStatusSchema = z.object( {
	localSiteId: z.string().nullable(),
	localChanged: z.boolean().nullable(),
	previewChanged: z.boolean().nullable(),
} );
export type PreviewStatus = z.infer< typeof previewStatusSchema >;

export function getPreviewStatus(
	executeCliCommand: ExecuteCliCommand,
	hostname: string
): Promise< PreviewStatus > {
	return runCliCommand(
		executeCliCommand,
		[ '_publish-status', hostname, '--preview' ],
		previewStatusSchema,
		{
			logPrefix: 'preview',
		}
	);
}

// `preview delete --all` reports no result, so only its exit status matters.
export function deleteAllPreviewSites( executeCliCommand: ExecuteCliCommand ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand( [ 'preview', 'delete', '--all' ], {
			output: 'capture',
			logPrefix: 'preview',
		} );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}

export async function renamePreviewSite(
	executeCliCommand: ExecuteCliCommand,
	hostname: string,
	name: string
): Promise< void > {
	await runCliCommand(
		executeCliCommand,
		[ 'preview', 'set', hostname, '--name', name ],
		previewResultSchema,
		{ logPrefix: 'preview' }
	);
}

export async function fetchSnapshots(
	executeCliCommand: ExecuteCliCommand
): Promise< Snapshot[] > {
	return runCliCommand(
		executeCliCommand,
		[ 'preview', 'list', '--format', 'json' ],
		z.array( snapshotSchema )
	);
}
