import { Type, type Static, type TObject, type TProperties } from 'typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';

/**
 * Tool authors throw on failure; pi's loop catches and produces a tool-result
 * with `isError: true`. `rawHandler` is exposed so `mcp-server.ts` can
 * dispatch external calls without pi's `{content, details}` wrapping.
 */

export interface ToolTextContent {
	type: 'text';
	text: string;
}

export interface ToolImageContent {
	type: 'image';
	data: string;
	mimeType: string;
}

export type ToolContent = ToolTextContent | ToolImageContent;

export interface ToolResult {
	content: ToolContent[];
}

export type ToolHandler< TProps extends TProperties > = (
	args: Static< TObject< TProps > >
) => Promise< ToolResult >;

export type StudioAgentTool< TProps extends TProperties = TProperties > = AgentTool<
	TObject< TProps >
> & {
	rawHandler: ToolHandler< TProps >;
};

export function defineTool< TProps extends TProperties >(
	name: string,
	description: string,
	properties: TProps,
	handler: ToolHandler< TProps >
): StudioAgentTool< TProps > {
	const parameters = Type.Object( properties );

	return {
		name,
		description,
		parameters,
		label: name,
		rawHandler: handler,
		execute: async ( _toolCallId, params ) => {
			const result = await handler( params as never );
			return { content: result.content, details: undefined };
		},
	};
}
