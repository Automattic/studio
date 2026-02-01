import { tools } from './tools';
import type { ToolResult, ToolCall } from '../types';

/**
 * Map of tool names to their implementations for quick lookup.
 */
const toolMap = new Map( tools.map( ( tool ) => [ tool.definition.name, tool ] ) );

/**
 * Execute a tool call and return the result.
 */
export async function executeTool( toolCall: ToolCall, siteId: string ): Promise< ToolResult > {
	const tool = toolMap.get( toolCall.name );

	if ( ! tool ) {
		return {
			success: false,
			error: `Unknown tool: ${ toolCall.name }. Available tools: ${ Array.from(
				toolMap.keys()
			).join( ', ' ) }`,
		};
	}

	try {
		const result = await tool.execute( toolCall.input, siteId );
		return result;
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return {
			success: false,
			error: `Tool execution failed: ${ errorMessage }`,
		};
	}
}

/**
 * Get all tool definitions in the format expected by Claude.
 */
export function getToolDefinitions() {
	return tools.map( ( tool ) => tool.definition );
}

/**
 * Check if a tool exists by name.
 */
export function hasToolByName( name: string ): boolean {
	return toolMap.has( name );
}
