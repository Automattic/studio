import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { textResult } from './utils';
import type { PulledFilePicks, PullSyncOptions } from '@studio/common/types/sync';

function toPullSyncOptions( database: boolean, files: 'all' | 'none' | string[] ): PullSyncOptions {
	let picked: 'all' | 'none' | PulledFilePicks = 'none';
	if ( files === 'all' ) {
		picked = 'all';
	} else if ( Array.isArray( files ) ) {
		const [ firstPath, ...otherPaths ] = files;
		if ( firstPath !== undefined ) {
			picked = { paths: [ firstPath, ...otherPaths ] };
		}
	}
	if ( database ) {
		return { database: true, files: picked };
	}
	if ( picked === 'none' ) {
		throw new Error( 'Nothing to pull: include the database, files, or both.' );
	}
	return { database: false, files: picked };
}

export const pullSiteTool = defineTool(
	'site_pull',
	'Pulls a WordPress.com site to a local WordPress site. Requires WordPress.com authentication ' +
		'(studio auth login). Copies the remote site into the local one, which can take several minutes ' +
		'depending on site size. ' +
		'Make sure a local site exists first (create one with site_create if needed); a running local site is stopped during the pull and restarted afterward. ' +
		'Never call it without explicit user confirmation: it overwrites the local site.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		remoteSite: Type.String( {
			description: 'The remote WordPress.com site URL or numeric site ID to pull from',
		} ),
		database: Type.Optional(
			Type.Boolean( {
				description: 'Whether to pull the database: content, users and settings. Defaults to true.',
			} )
		),
		files: Type.Optional(
			Type.Union(
				[
					Type.Literal( 'all' ),
					Type.Literal( 'none' ),
					Type.Array( Type.String(), { minItems: 1 } ),
				],
				{
					description:
						'Which files to pull: "all" (the default), "none", or paths relative to wp-content, such as "plugins/akismet" or "uploads".',
				}
			)
		),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const remoteSite = await context.host.sync.pull(
				site,
				toPullSyncOptions( args.database ?? true, args.files ?? 'all' ),
				args.remoteSite,
				context.onProgress
			);
			return textResult(
				remoteSite
					? `Pulled ${ remoteSite.name } (${ remoteSite.url }) into "${ site.name }".`
					: 'Pull cancelled.'
			);
		} catch ( error ) {
			throw new Error(
				`Failed to pull site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet:
			'Pull a WordPress.com site to a local site. Requires authentication. Specify the remote site URL or ID, and optionally whether to pull the database and which files.',
		annotations: REMOTE_OVERWRITE,
	}
);
