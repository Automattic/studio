// The Studio Code agent for apps that run it in Node: `createAgent( { host } )`
// and what its hosts need around it. The session store, settings and
// run-manager that only show the agent stay importable on their own, so those
// apps never load the runtime.
export { createAgent, type StudioAgent } from './agent';
export type {
	HostSite,
	ProgressCallback,
	StudioAgentHost,
	StudioAgentUi,
	WpCliOutput,
} from '@studio/agent/shared/host';
export type { StudioAgentTurnConfig, StudioAgentTurnHandle } from './runtime';
export type { AskUserHandler, AskUserQuestion, SiteInfo } from '@studio/agent/shared/types';

// Tools a host serves next to Studio's own, such as `studio mcp`'s.
export {
	bindTool,
	defineTool,
	LOCAL_CHANGE,
	LOCAL_OVERWRITE,
	READ_ONLY,
	REMOTE_CHANGE,
	REMOTE_OVERWRITE,
	REMOTE_READ,
	type AnyStudioAgentTool,
	type StudioAgentTool,
	type StudioToolDefinition,
	type ToolResult,
} from '@studio/agent/shared/tools/define-tool';
export type { StudioToolsOptions } from '@studio/agent/shared/tools';
export { createPresentDesignOptionsTool } from '@studio/agent/shared/tools/present-design-options';
export { renderSkill } from '@studio/agent/shared/tools/skill';
export { textResult } from '@studio/agent/shared/tools/utils';
export { loadSkills } from '@studio/agent/shared/skills';
export { buildSystemPrompt } from '@studio/agent/shared/system-prompt';
export { createResultNotes } from '@studio/agent/shared/result-notes';
export type { DesignTracksContext } from '@studio/agent/shared/design-tracks';

// Turns as the host records them.
export { resolveResumeSessionContext } from './sessions/context';
export { createTurnStatsTracker } from './turn-stats';
export { addAssistantMessageUsage, createTokenUsage, type TokenUsage } from './token-usage';

// Shared with the CLI's own commands.
export {
	closeSharedBrowser,
	ensurePlaywrightChromiumInstalled,
	getSharedBrowser,
} from './browser-utils';
export { captureScreenshotBuffer } from '@studio/agent/shared/tools/screenshot-helpers';
export { validateBlocks } from '@studio/agent/shared/block-validator';
export { getWpcomAiGatewayBaseUrl } from '@studio/agent/shared/ai-gateway';
export { nodeHostServices } from './node-host';
