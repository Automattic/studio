import { Type, type Static, type TObject, type TProperties } from 'typebox';
import type { AgentTool, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';
import type { StudioToolProgressUpdate } from '@studio/common/ai/tool-progress';

/**
 * Tool authors throw on failure; pi's loop catches and produces a tool-result
 * with `isError: true`. `rawHandler` is exposed so `runtimes/mcp` can
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
	// Data for the host's MCP App, kept out of the model's context. Not
	// `structuredContent`: Claude Code gives that to the model instead of `content`.
	_meta?: Record< string, unknown >;
	// Work the tool leaves running after it returns, settling with an optional
	// report for the agent. A runtime that cannot wait for it later awaits it
	// before answering.
	pending?: Promise< string | undefined >;
}

export interface StudioToolResultDetails {
	studioArtifacts?: StudioChatArtifactWidgetDraft[];
	pending?: Promise< string | undefined >;
}

export interface ToolContext {
	onProgress: ( message: string, update?: boolean ) => void;
}

const NOOP_TOOL_CONTEXT: ToolContext = { onProgress: () => {} };

export type ToolHandler< TProps extends TProperties > = (
	args: Static< TObject< TProps > >,
	context: ToolContext
) => Promise< ToolResult >;

// One-line snippet for the prompt's tool list and short usage guidelines,
// the way pi's own tools declare them: the system prompt is assembled from
// the registered tools, so a tool is documented where it is defined.
export interface ToolPromptOptions {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

// What a call can change, for hosts that ask the user before running a tool
// (MCP tool annotations). A tool that declares nothing may destroy data and
// reach beyond this machine, so hosts ask before each call.
export interface ToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	openWorldHint?: boolean;
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true };
// Changes only this machine, without deleting or overwriting the user's work.
export const LOCAL_CHANGE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
};

export interface ToolOptions extends ToolPromptOptions {
	annotations?: ToolAnnotations;
	// The tool renders the site, so it runs only once the pending work of
	// earlier tools, such as images still being generated, has settled.
	settlesPendingWork?: boolean;
}

export type StudioAgentTool< TProps extends TProperties = TProperties > = AgentTool<
	TObject< TProps >
> &
	ToolOptions & {
		rawHandler: (
			args: Static< TObject< TProps > >,
			context?: ToolContext
		) => Promise< ToolResult >;
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
	promptSnippet?: string;
	promptGuidelines?: string[];
	settlesPendingWork?: boolean;
	annotations?: ToolAnnotations;
}

export function defineTool< TProps extends TProperties >(
	name: string,
	description: string,
	properties: TProps,
	handler: ToolHandler< TProps >,
	options: ToolOptions = {}
): StudioAgentTool< TProps > {
	const parameters = Type.Object( properties );

	return {
		name,
		description,
		parameters,
		label: name,
		...( options.promptSnippet ? { promptSnippet: options.promptSnippet } : {} ),
		...( options.promptGuidelines ? { promptGuidelines: options.promptGuidelines } : {} ),
		...( options.settlesPendingWork ? { settlesPendingWork: true } : {} ),
		...( options.annotations ? { annotations: options.annotations } : {} ),
		rawHandler: ( args, context ) => handler( args, context ?? NOOP_TOOL_CONTEXT ),
		execute: async ( _toolCallId, params, _signal, onUpdate ) => {
			const context: ToolContext = {
				onProgress: ( message, update ) => {
					const details: StudioToolProgressUpdate = { studioProgress: { message, update } };
					onUpdate?.( { content: [], details } );
				},
			};
			const result = await handler( params as never, context );
			const details: StudioToolResultDetails | undefined =
				result.studioArtifacts?.length || result.pending
					? { studioArtifacts: result.studioArtifacts, pending: result.pending }
					: undefined;
			return { content: result.content, details };
		},
	};
}
