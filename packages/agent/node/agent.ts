import { resolveExternalTools, type ExternalToolsOptions } from '@studio/agent/node/tools';
import {
	runStudioAgentTurn,
	type StudioAgentTurnConfig,
	type StudioAgentTurnHandle,
} from './runtime';
import {
	createStudioSession,
	listStudioSessionFiles,
	openStudioSession,
	type CreateStudioSessionOptions,
} from './sessions/pi-session';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { AnyStudioAgentTool } from '@studio/agent/node/tools/define-tool';

export interface StudioAgent {
	// Runs one turn of a conversation: the prompt, the model's tool calls, its answer.
	runTurn( config: StudioAgentTurnConfig ): StudioAgentTurnHandle;
	// Studio's tools for an agent that runs them itself, such as one connected to an
	// MCP server, with studio_instructions to give it the prompt and the skills.
	tools( options?: ExternalToolsOptions ): AnyStudioAgentTool[];
	// The conversation files turns are recorded in.
	sessions: {
		create( options?: CreateStudioSessionOptions ): Promise< SessionManager >;
		open( filePath: string ): Promise< SessionManager >;
		list( directory: string ): Promise< string[] >;
	};
}

export function createAgent( { host }: { host: StudioAgentHost } ): StudioAgent {
	return {
		runTurn: ( config ) => runStudioAgentTurn( host, config ),
		tools: ( options ) => resolveExternalTools( host, options ),
		sessions: {
			create: ( options ) => createStudioSession( host.sitesRoot, options ),
			open: ( filePath ) => openStudioSession( host.sitesRoot, filePath ),
			list: listStudioSessionFiles,
		},
	};
}
