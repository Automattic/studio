import { Type } from 'typebox';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

// Called right before a site is actually deleted so the user can explicitly
// approve. Resolves to `true` only when the user confirms. Site deletion is
// irreversible, so the destructive command is gated behind this callback.
export type ConfirmSiteDeletion = ( details: {
	name: string;
	path: string;
	deleteFiles: boolean;
} ) => Promise< boolean >;

export function createDeleteSiteTool( confirm?: ConfirmSiteDeletion ) {
	return defineTool(
		'site_delete',
		'Deletes a WordPress site by name or path. Removes the site from Studio and optionally moves site files to trash. This is irreversible and requires explicit user confirmation before it runs.',
		{
			nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
			deleteFiles: Type.Optional(
				Type.Boolean( {
					description: 'Move site files to trash. Defaults to true. Set to false to keep files.',
				} )
			),
		},
		async ( args ) => {
			try {
				const site = await resolveSite( args.nameOrPath );
				const deleteFiles = args.deleteFiles ?? true;
				if ( confirm ) {
					const confirmed = await confirm( { name: site.name, path: site.path, deleteFiles } );
					if ( ! confirmed ) {
						return textResult( `Site deletion cancelled. "${ site.name }" was not deleted.` );
					}
				}
				await runDeleteSiteCommand( site.path, deleteFiles );
				return textResult( `Site "${ site.name }" deleted.` );
			} catch ( error ) {
				throw new Error(
					`Failed to delete site: ${ error instanceof Error ? error.message : String( error ) }`
				);
			}
		}
	);
}

// Default (unconfirmed) tool for the static registry and MCP dispatch, where the
// host provides its own approval flow. The interactive agent swaps in a
// confirmation-gated instance via `resolveStudioToolDefinitions`.
export const deleteSiteTool = createDeleteSiteTool();
