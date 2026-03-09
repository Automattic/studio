import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { readAppdata } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { sendWpCliCommand } from 'cli/lib/wordpress-server-manager';

function ok( data: unknown ) {
	return { content: [ { type: 'text' as const, text: JSON.stringify( data, null, 2 ) } ] };
}

function err( message: string ) {
	return {
		content: [ { type: 'text' as const, text: message } ],
		isError: true as const,
	};
}

export function registerWpCliTool( server: McpServer ) {
	server.tool(
		'wp',
		__( 'Run a WP-CLI command on a running WordPress site' ),
		{
			sitePath: z.string().describe( __( 'Absolute path to the site directory' ) ),
			args: z
				.array( z.string() )
				.describe( __( 'WP-CLI arguments (e.g. ["plugin", "list", "--format=json"])' ) ),
		},
		async ( { sitePath, args } ) => {
			try {
				const appdata = await readAppdata();
				const site = appdata.sites.find( ( s ) => s.path === sitePath );
				if ( ! site ) {
					return err( __( 'Site not found at the specified path' ) );
				}

				await connect();
				try {
					const result = await sendWpCliCommand( site.id, args );
					return ok( result );
				} finally {
					await disconnect();
				}
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);
}
