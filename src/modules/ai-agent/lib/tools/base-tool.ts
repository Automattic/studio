import type { ToolDefinition, ToolResult } from '../../types';

/**
 * Base interface for all agent tools.
 * Each tool must implement this interface to be usable by the agent.
 */
export interface BaseTool {
	/** The tool definition including name, description, and input schema */
	definition: ToolDefinition;

	/** Execute the tool with the given input */
	execute( input: Record< string, unknown >, siteId: string ): Promise< ToolResult >;
}

/**
 * Helper function to create a successful tool result
 */
export function successResult( output: string ): ToolResult {
	return { success: true, output };
}

/**
 * Helper function to create an error tool result
 */
export function errorResult( error: string ): ToolResult {
	return { success: false, error };
}
