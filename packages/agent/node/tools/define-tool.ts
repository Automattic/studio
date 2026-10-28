import { Type, type Static, type TObject, type TProperties } from 'typebox';
import type { AgentTool, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { StudioChatArtifactWidgetDraft } from '@studio/agent/protocol/chat-artifacts';
import type { StudioToolProgressUpdate } from '@studio/agent/protocol/tool-progress';

/**
 * Tool authors throw on failure; pi's loop catches and produces a tool-result
 * with `isError: true`. A definition runs once bound to a host (`bindTool`);
 * the bound tool's `rawHandler` lets `studio mcp` dispatch external calls
 * without pi's `{content, details}` wrapping.
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

export interface ToolResult {
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
	// The files that work writes, as paths in their site: a call naming one
	// waits for the work.
	pendingFiles?: string[];
}

export interface StudioToolResultDetails {
	studioArtifacts?: StudioChatArtifactWidgetDraft[];
	pending?: Promise< string | undefined >;
	pendingFiles?: string[];
}

export interface ToolContext {
	host: StudioAgentHost;
	onProgress: ( message: string, update?: boolean ) => void;
	/** Aborted when the turn is stopped, so a tool that waits stops waiting. */
	signal?: AbortSignal;
}

// What a caller of a bound tool passes; the host is already bound.
type CallContext = Pick< ToolContext, 'onProgress' >;

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

// What the agent running Studio's tools (Studio Code, an MCP client) can do.
// Each tool decides from it whether and how it appears there.
export interface StudioToolsOptions {
	// The agent has a shell whose `wp` runs Studio's WP-CLI (Studio Code's Bash).
	shell?: boolean;
	// Studio can generate images, and the agent has no image tool of its own.
	imageGeneration?: boolean;
	// False for models that cannot view images. Defaults to true.
	visionEnabled?: boolean;
	// How a local image is linked in the agent's reply so the host shows it to the user.
	// Set by hosts without Studio's chat UI, which shows images as chat artifacts instead.
	imageLink?: ( file: string ) => string;
}

export interface ToolOptions {
	annotations: ToolAnnotations;
	// The tool as it appears to an agent, or undefined where it does not.
	// Without it the tool appears everywhere as defined.
	forHost?: (
		options: StudioToolsOptions,
		host: StudioAgentHost
	) => StudioToolDefinition | undefined;
	// The tool renders the site, so it runs only once the pending work of
	// earlier tools, such as images still being generated, has settled.
	settlesPendingWork?: boolean;
	// The argument that names the local site a call is about, when it is not
	// `nameOrPath`: notes on the result, such as the site's facts, are about it.
	siteParam?: string;
}

// A tool as defined: everything but the host it runs against.
export interface StudioToolDefinition< TProps extends TProperties = TProperties >
	extends ToolOptions {
	name: string;
	description: string;
	label: string;
	parameters: TObject< TProps >;
	// Method syntax, so definitions with different arguments share one list.
	handler( args: Static< TObject< TProps > >, context: ToolContext ): Promise< ToolResult >;
}

// A tool bound to a host, ready for pi or an MCP call.
export type StudioAgentTool< TProps extends TProperties = TProperties > = AgentTool<
	TObject< TProps >
> &
	Omit< ToolOptions, 'forHost' > & {
		rawHandler: (
			args: Static< TObject< TProps > >,
			context?: CallContext
		) => Promise< ToolResult >;
	};

// Tool registries are heterogeneous: each entry has a different TypeBox
// argument schema, but callers operate on them uniformly by name.
export interface AnyStudioAgentTool {
	name: string;
	description: string;
	label: string;
	parameters: unknown;
	rawHandler: ( args: never, context?: CallContext ) => Promise< ToolResult >;
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
	siteParam?: string;
}

export function defineTool< TProps extends TProperties >(
	name: string,
	description: string,
	properties: TProps,
	handler: ToolHandler< TProps >,
	options: ToolOptions
): StudioToolDefinition< TProps > {
	return {
		name,
		description,
		parameters: Type.Object( properties ),
		label: name,
		...( options.settlesPendingWork ? { settlesPendingWork: true } : {} ),
		...( options.forHost ? { forHost: options.forHost } : {} ),
		...( options.siteParam ? { siteParam: options.siteParam } : {} ),
		annotations: options.annotations,
		handler,
	};
}

export function bindTool< TProps extends TProperties >(
	{ handler, forHost: _forHost, ...tool }: StudioToolDefinition< TProps >,
	host: StudioAgentHost
): StudioAgentTool< TProps > {
	return {
		...tool,
		rawHandler: ( args, context ) =>
			handler( args, { host, onProgress: context?.onProgress ?? ( () => {} ) } ),
		execute: async ( _toolCallId, params, signal, onUpdate ) => {
			const context: ToolContext = {
				host,
				signal,
				onProgress: ( message, update ) => {
					const details: StudioToolProgressUpdate = { studioProgress: { message, update } };
					onUpdate?.( { content: [], details } );
				},
			};
			const result = await handler( params as never, context );
			const details: StudioToolResultDetails | undefined =
				result.studioArtifacts?.length || result.pending
					? {
							studioArtifacts: result.studioArtifacts,
							pending: result.pending,
							pendingFiles: result.pendingFiles,
					  }
					: undefined;
			return {
				content: result.content,
				details,
				...( result.terminate ? { terminate: true } : {} ),
			};
		},
	};
}
