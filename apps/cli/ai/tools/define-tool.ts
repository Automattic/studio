import { Type, type Static, type TObject, type TProperties } from 'typebox';
import type { AgentTool, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';
import type { StudioToolProgressUpdate } from '@studio/common/ai/tool-progress';

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
	studioArtifacts?: StudioChatArtifactWidgetDraft[];
}

export interface StudioToolResultDetails {
	studioArtifacts?: StudioChatArtifactWidgetDraft[];
}

export interface ToolContext {
	onProgress: ( message: string, update?: boolean ) => void;
}

const NOOP_TOOL_CONTEXT: ToolContext = { onProgress: () => {} };

export type ToolHandler< TProps extends TProperties > = (
	args: Static< TObject< TProps > >,
	context: ToolContext
) => Promise< ToolResult >;

export type StudioAgentTool< TProps extends TProperties = TProperties > = AgentTool<
	TObject< TProps >
> & {
	rawHandler: ( args: Static< TObject< TProps > >, context?: ToolContext ) => Promise< ToolResult >;
};

// Tool registries are heterogeneous: each entry has a different TypeBox
// argument schema, but callers operate on them uniformly by name.
export interface AnyStudioAgentTool {
	name: string;
	description: string;
	label: string;
	parameters: unknown;
	rawHandler: ( args: never, context?: ToolContext ) => Promise< ToolResult >;
	execute: (
		toolCallId: string,
		params: never,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback
	) => Promise< { content: ToolContent[]; details?: unknown; terminate?: boolean } >;
	prepareArguments?: ( args: unknown ) => unknown;
	executionMode?: unknown;
}

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
		rawHandler: ( args, context ) => handler( args, context ?? NOOP_TOOL_CONTEXT ),
		execute: async ( _toolCallId, params, _signal, onUpdate ) => {
			const context: ToolContext = {
				onProgress: ( message, update ) => {
					const details: StudioToolProgressUpdate = { studioProgress: { message, update } };
					onUpdate?.( { content: [], details } );
				},
			};
			const result = await handler( params as never, context );
			const details: StudioToolResultDetails | undefined = result.studioArtifacts?.length
				? { studioArtifacts: result.studioArtifacts }
				: undefined;
			return { content: result.content, details };
		},
	};
}
