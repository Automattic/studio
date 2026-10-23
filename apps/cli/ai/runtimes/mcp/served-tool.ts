import path from 'node:path';
import { createBlockSettingsNotes } from 'cli/ai/block-settings';
import { resolveSite } from 'cli/ai/tools/utils';
import type { AnyStudioAgentTool } from 'cli/ai/tools/define-tool';

// The declared settings of the core blocks a result shows, read from the local
// site the call names, as Studio Code gets them. Each result describes its own
// blocks: an MCP session has no turns to describe them once per.
async function blockSettingsNotes( args: Record< string, unknown >, text: string ) {
	if ( typeof args.nameOrPath !== 'string' || ! text.includes( '<!-- wp:' ) ) {
		return '';
	}
	try {
		const site = await resolveSite( args.nameOrPath );
		return createBlockSettingsNotes( path.join( site.path, 'wp-includes', 'blocks' ) )( text );
	} catch {
		return '';
	}
}

// Runs a served tool for an MCP call. MCP wants `{content, isError}`; pi-native
// handlers throw — translate.
export async function runServedTool( tool: AnyStudioAgentTool, args: Record< string, unknown > ) {
	try {
		const result = await tool.rawHandler( args as never );
		const resultText = result.content
			.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
			.join( '\n' );
		const notes = [ await blockSettingsNotes( args, resultText ), await result.pending ]
			.filter( Boolean )
			.join( '\n' );
		return {
			content: notes
				? [ ...result.content, { type: 'text' as const, text: notes } ]
				: result.content,
			_meta: result._meta,
			isError: false,
		};
	} catch ( error ) {
		const message = error instanceof Error ? error.message : String( error );
		return {
			content: [ { type: 'text' as const, text: message } ],
			isError: true,
		};
	}
}
