import { resolveSite } from 'cli/ai/tools/utils';
import type { createResultNotes } from 'cli/ai/result-notes';
import type { AnyStudioAgentTool } from 'cli/ai/tools/define-tool';

// The site an MCP call works on is the one it names.
async function siteNamed( args: Record< string, unknown > ) {
	if ( typeof args.nameOrPath !== 'string' ) {
		return undefined;
	}
	try {
		return await resolveSite( args.nameOrPath );
	} catch {
		return undefined;
	}
}

// Runs a served tool for an MCP call. MCP wants `{content, isError}`; pi-native
// handlers throw — translate.
export async function runServedTool(
	tool: AnyStudioAgentTool,
	args: Record< string, unknown >,
	resultNotes: ReturnType< typeof createResultNotes >
) {
	try {
		const result = await tool.rawHandler( args as never );
		const resultText = result.content
			.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
			.join( '\n' );
		const site = await siteNamed( args );
		const notes = [
			site && ( await resultNotes( site.path, { args, result: resultText } ) ),
			await result.pending,
		]
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
