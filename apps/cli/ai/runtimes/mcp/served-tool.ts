import type { AnyStudioAgentTool } from '@studio/agent/node';

// Runs a served tool for an MCP call. MCP wants `{content, isError}`; pi-native
// handlers throw — translate.
export async function runServedTool( tool: AnyStudioAgentTool, args: Record< string, unknown > ) {
	try {
		const result = await tool.rawHandler( args as never );
		return { content: result.content, _meta: result._meta, isError: false };
	} catch ( error ) {
		const message = error instanceof Error ? error.message : String( error );
		return {
			content: [ { type: 'text' as const, text: message } ],
			isError: true,
		};
	}
}
