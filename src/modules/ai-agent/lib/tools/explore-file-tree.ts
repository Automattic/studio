import * as ipcHandlers from 'src/ipc-handlers';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult } from '../../types';
import type { IpcMainInvokeEvent } from 'electron';
import type { RawDirectoryEntry } from 'src/modules/sync/types';

const definition: ToolDefinition = {
	name: 'explore_file_tree',
	description: `Browse the file tree of the WordPress site. Use this to explore the site structure, find files, and understand the codebase.

Common paths to explore:
- "/" or "." - Root of the WordPress installation
- "wp-content/themes" - Theme files
- "wp-content/plugins" - Plugin files
- "wp-content/uploads" - Uploaded media files

The maxDepth parameter controls how deep to recurse into directories (default: 3).`,
	input_schema: {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string',
				description:
					'The path to explore, relative to the WordPress root (e.g., "wp-content/themes")',
			},
			maxDepth: {
				type: 'number',
				description: 'Maximum depth to recurse into directories (1-5, default: 3)',
			},
		},
		required: [],
	},
};

function formatFileTree( entries: RawDirectoryEntry[], indent = '' ): string {
	const lines: string[] = [];

	for ( const entry of entries ) {
		const prefix = entry.isDirectory ? '/' : '';
		lines.push( `${ indent }${ prefix }${ entry.name }` );

		if ( entry.children && entry.children.length > 0 ) {
			lines.push( formatFileTree( entry.children, indent + '  ' ) );
		}
	}

	return lines.join( '\n' );
}

async function execute( input: Record< string, unknown >, siteId: string ): Promise< ToolResult > {
	if ( ! siteId ) {
		return errorResult( 'No site ID provided. Please select a site first.' );
	}

	const path = ( input.path as string ) || '.';
	let maxDepth = ( input.maxDepth as number ) || 3;

	// Clamp maxDepth to reasonable values
	maxDepth = Math.max( 1, Math.min( 5, maxDepth ) );

	try {
		const mockEvent = {} as IpcMainInvokeEvent;
		const entries = await ipcHandlers.listLocalFileTree( mockEvent, siteId, path, maxDepth );

		if ( entries.length === 0 ) {
			return successResult( `No files found at path: ${ path }` );
		}

		const formattedTree = formatFileTree( entries );
		return successResult(
			`File tree for "${ path }" (depth: ${ maxDepth }):\n\n${ formattedTree }`
		);
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to explore file tree: ${ errorMessage }` );
	}
}

export const exploreFileTreeTool: BaseTool = {
	definition,
	execute,
};
