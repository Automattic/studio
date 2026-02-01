import * as ipcHandlers from 'src/ipc-handlers';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult } from '../../types';
import type { IpcMainInvokeEvent } from 'electron';

const definition: ToolDefinition = {
	name: 'manage_site',
	description: `Manage a WordPress site - start, stop, or delete it.

Actions:
- start: Start the site server so it can be accessed in the browser
- stop: Stop the site server
- delete: Delete the site (optionally including files)

Note: The site ID is provided automatically based on the current site context.`,
	input_schema: {
		type: 'object' as const,
		properties: {
			action: {
				type: 'string',
				enum: [ 'start', 'stop', 'delete' ],
				description: 'The action to perform on the site',
			},
			deleteFiles: {
				type: 'boolean',
				description: 'When deleting, whether to also delete the site files (default: false)',
			},
		},
		required: [ 'action' ],
	},
};

async function execute( input: Record< string, unknown >, siteId: string ): Promise< ToolResult > {
	const action = input.action as string;

	if ( ! action || ! [ 'start', 'stop', 'delete' ].includes( action ) ) {
		return errorResult( 'Action must be one of: start, stop, delete' );
	}

	if ( ! siteId ) {
		return errorResult( 'No site ID provided. Please select a site first.' );
	}

	try {
		const mockEvent = {} as IpcMainInvokeEvent;

		switch ( action ) {
			case 'start': {
				await ipcHandlers.startServer( mockEvent, siteId );
				return successResult( 'Site server started successfully. The site is now accessible.' );
			}

			case 'stop': {
				await ipcHandlers.stopServer( mockEvent, siteId );
				return successResult( 'Site server stopped successfully.' );
			}

			case 'delete': {
				const deleteFiles = input.deleteFiles === true;
				await ipcHandlers.deleteSite( mockEvent, siteId, deleteFiles );
				const filesMessage = deleteFiles
					? ' Site files have also been deleted.'
					: ' Site files have been preserved.';
				return successResult( `Site deleted successfully.${ filesMessage }` );
			}

			default:
				return errorResult( `Unknown action: ${ action }` );
		}
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to ${ action } site: ${ errorMessage }` );
	}
}

export const manageSiteTool: BaseTool = {
	definition,
	execute,
};
