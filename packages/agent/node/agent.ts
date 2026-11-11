import { resolveStudioTools, type StudioToolsOptions } from '@studio/agent/shared/tools';
import {
	runStudioAgentTurn,
	type StudioAgentTurnConfig,
	type StudioAgentTurnHandle,
} from './runtime';
import { prepareMcpServers } from './runtime/mcp-tools';
import {
	createStudioSession,
	listStudioSessionFiles,
	openStudioSession,
	type CreateStudioSessionOptions,
} from './sessions/pi-session';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { StudioAgentHost } from '@studio/agent/shared/host';
import type { AnyStudioAgentTool } from '@studio/agent/shared/tools/define-tool';

export interface StudioAgent {
	// Runs one turn of a conversation: the prompt, the model's tool calls, its answer.
	runTurn( config: StudioAgentTurnConfig ): StudioAgentTurnHandle;
	// The Studio tools, for hosts that run them themselves, such as an MCP server.
	tools( options?: StudioToolsOptions ): AnyStudioAgentTool[];
	// Gets ready for the first turn while the user writes it: connects to the
	// MCP servers whose tools the turns are given.
	prepare(): void;
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
		tools: ( options ) => resolveStudioTools( host, options ),
		prepare: () => prepareMcpServers( host.remoteHosts ),
		sessions: {
			create: ( options ) => createStudioSession( host.sitesRoot, options ),
			open: ( filePath ) => openStudioSession( host.sitesRoot, filePath ),
			list: listStudioSessionFiles,
		},
	};
}
