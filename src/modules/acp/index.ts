/**
 * ACP Module Exports
 *
 * Agent Client Protocol support for WordPress Studio.
 */

// Types
export * from './types';

// Config - Built-in agents only
export { BUILTIN_AGENTS, DEFAULT_AGENT_ID, AGENT_ICONS } from './config/agents';
export { getBuiltinAgents, getBuiltinAgentById, getAgentIcon } from './config/agents';

// Registry - Dynamic ACP agent discovery
export {
	getAcpRegistry,
	getRegistryAgent,
	getAgentCommand,
	getPlatformKey,
	refreshRegistry,
	type AcpRegistry,
	type RegistryAgent,
	type AgentDistribution,
} from './lib/acp-registry';

// Agent Detection
export {
	detectInstalledAgents,
	detectAgentById,
	getAgentStatusDict,
	refreshAgentDetection,
} from './lib/agent-detection';

// Process Manager (uses official ACP SDK)
export {
	AcpProcessManager,
	getAcpProcessManager,
	type AcpCallbackHandler,
} from './lib/acp-process-manager';

// Callbacks
export {
	createCallbacksHandler,
	createReadOnlyCallbacksHandler,
	createFullAccessCallbacksHandler,
} from './lib/acp-callbacks';
