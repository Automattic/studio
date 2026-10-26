import { Type, type Static, type TObject, type TProperties } from 'typebox';
import type { AgentTool, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';
import type { StudioToolProgressUpdate } from '@studio/common/ai/tool-progress';

/**
 * Tool authors throw on failure; pi's loop catches and produces a tool-result
 * with `isError: true`. `rawHandler` is exposed so `runtimes/mcp` can
 * dispatch external calls without pi's `{content, details}` wrapping.
 */

interface ToolTextContent {
	type: 'text';
	text: string;
}

interface ToolImageContent {
	type: 'image';
	data: string;
	mimeType: string;
}

type ToolContent = ToolTextContent | ToolImageContent;

interface ToolResult {
	content: ToolContent[];
	// Ends the turn after this call, as Pi's AgentToolResult.terminate does.
	terminate?: boolean;
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

interface ToolContext {
	onProgress: ( message: string, update?: boolean ) => void;
}

const NOOP_TOOL_CONTEXT: ToolContext = { onProgress: () => {} };

export type ToolHandler< TProps extends TProperties > = (
	args: Static< TObject< TProps > >,
	context: ToolContext
) => Promise< ToolResult >;

// What a call can change, for hosts that ask the user before running a tool
// (MCP tool annotations). Hosts run read-only tools, and those that neither
// destroy data nor reach beyond this machine, without asking. Every tool
// declares all three, as OpenAI's plugin review requires.
export interface ToolAnnotations {
	readOnlyHint: boolean;
	destructiveHint: boolean;
	openWorldHint: boolean;
}

export const READ_ONLY: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
};
// Reads only, including from WordPress.com.
export const REMOTE_READ: ToolAnnotations = { ...READ_ONLY, openWorldHint: true };
// Changes only this machine, without deleting or overwriting the user's work.
export const LOCAL_CHANGE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
};
// Changes something beyond this machine, without deleting or overwriting the user's work.
export const REMOTE_CHANGE: ToolAnnotations = { ...LOCAL_CHANGE, openWorldHint: true };
// Can delete or overwrite the user's work on this machine.
export const LOCAL_OVERWRITE: ToolAnnotations = { ...LOCAL_CHANGE, destructiveHint: true };
// Can delete or overwrite the user's work, on this machine or beyond it.
export const REMOTE_OVERWRITE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	openWorldHint: true,
};

// What a host running Studio's tools (Studio Code, an MCP client) can do. Each
// tool decides from it whether and how it appears there.
export interface StudioToolHost {
	// The agent has a shell whose `wp` runs Studio's WP-CLI (Studio Code's Bash).
	shell?: boolean;
	// Tool results carry chat artifacts the host shows: the desktop app sets
	// this; standalone CLI and MCP runs leave it off so visual artifacts are
	// ignored instead of leaking into terminal transcripts.
	emitChatArtifacts?: boolean;
	// Studio can generate images, and the host has no image tool of its own.
	imageGeneration?: boolean;
	// False for models that cannot view images. Defaults to true.
	visionEnabled?: boolean;
	// How a local image is linked in the agent's reply so the host shows it to the user.
	// Set by hosts without Studio's chat UI, which shows images as chat artifacts instead.
	imageLink?: ( file: string ) => string;
}

export interface ToolOptions {
	annotations: ToolAnnotations;
	// The tool as it appears on a host, or undefined where it does not.
	// Without it the tool appears on every host as defined.
	forHost?: ( host: StudioToolHost ) => AnyStudioAgentTool | undefined;
	// The tool renders the site, so it runs only once the pending work of
	// earlier tools, such as images still being generated, has settled.
	settlesPendingWork?: boolean;
	// The argument that names the local site a call is about, when it is not
	// `nameOrPath`: notes on the result, such as the site's facts, are about it.
	siteParam?: string;
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
	settlesPendingWork?: boolean;
	annotations: ToolAnnotations;
	forHost?: ( host: StudioToolHost ) => AnyStudioAgentTool | undefined;
	siteParam?: string;
}

export function defineTool< TProps extends TProperties >(
	name: string,
	description: string,
	properties: TProps,
	handler: ToolHandler< TProps >,
	options: ToolOptions
): StudioAgentTool< TProps > {
	const parameters = Type.Object( properties );

	return {
		name,
		description,
		parameters,
		label: name,
		...( options.settlesPendingWork ? { settlesPendingWork: true } : {} ),
		...( options.forHost ? { forHost: options.forHost } : {} ),
		...( options.siteParam ? { siteParam: options.siteParam } : {} ),
		annotations: options.annotations,
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
			return {
				content: result.content,
				details,
				...( result.terminate ? { terminate: true } : {} ),
			};
		},
	};
}
