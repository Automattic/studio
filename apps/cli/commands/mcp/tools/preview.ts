import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { runCommand as runPreviewCreateCommand } from 'cli/commands/preview/create';
import { getAuthToken } from 'cli/lib/appdata';
import {
	formatDurationUntilExpiry,
	getSnapshotsFromAppdata,
	isSnapshotExpired,
} from 'cli/lib/snapshots';

function ok( data: unknown ) {
	return { content: [ { type: 'text' as const, text: JSON.stringify( data, null, 2 ) } ] };
}

function err( message: string ) {
	return {
		content: [ { type: 'text' as const, text: message } ],
		isError: true as const,
	};
}

export function registerPreviewTools( server: McpServer ) {
	server.tool(
		'preview_list',
		__( 'List preview sites for a WordPress site' ),
		{ sitePath: z.string().describe( __( 'Absolute path to the site directory' ) ) },
		async ( { sitePath } ) => {
			try {
				const token = await getAuthToken();
				const snapshots = await getSnapshotsFromAppdata( token.id, sitePath );
				const result = snapshots.map( ( s ) => ( {
					url: `https://${ s.url }`,
					name: s.name,
					date: new Date( s.date ).toISOString(),
					expiresIn: formatDurationUntilExpiry( s.date ),
					expired: isSnapshotExpired( s ),
				} ) );
				return ok( result );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'preview_create',
		__( 'Create a preview site from a WordPress site' ),
		{ sitePath: z.string().describe( __( 'Absolute path to the site directory' ) ) },
		async ( { sitePath } ) => {
			try {
				await runPreviewCreateCommand( sitePath );
				return ok( { success: true, message: __( 'Preview site created successfully' ) } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);
}
