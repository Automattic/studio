import type { AnyStudioAgentTool, createResultNotes, StudioAgentHost } from '@studio/agent/node';

// The site an MCP call works on is the one it names.
async function siteNamed( host: StudioAgentHost, args: Record< string, unknown > ) {
	if ( typeof args.nameOrPath !== 'string' ) {
		return undefined;
	}
	try {
		return await host.sites.resolve( args.nameOrPath );
	} catch {
		return undefined;
	}
}

// Runs a served tool for an MCP call. MCP wants `{content, isError}`; pi-native
// handlers throw — translate.
export async function runServedTool(
	host: StudioAgentHost,
	tool: AnyStudioAgentTool,
	args: Record< string, unknown >,
	resultNotes: ReturnType< typeof createResultNotes >
) {
	try {
		const result = await tool.rawHandler( args as never );
		const resultText = result.content
			.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
			.join( '\n' );
		const site = await siteNamed( host, args );
		const notes = [ site && ( await resultNotes( site.path, resultText ) ), await result.pending ]
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
