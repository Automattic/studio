import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { __ } from '@wordpress/i18n';
import { getUserInfo } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';

function ok( data: unknown ) {
	return { content: [ { type: 'text' as const, text: JSON.stringify( data, null, 2 ) } ] };
}

export function registerAuthTools( server: McpServer ) {
	server.tool( 'auth_status', __( 'Check WordPress.com authentication status' ), {}, async () => {
		try {
			const token = await getAuthToken();
			const userData = await getUserInfo( token.accessToken );
			return ok( {
				authenticated: true,
				username: userData.username,
				email: token.email,
				displayName: token.displayName,
			} );
		} catch ( error ) {
			return ok( {
				authenticated: false,
				message: error instanceof Error ? error.message : String( error ),
			} );
		}
	} );
}
