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
} from './host';
export type { StudioAgentTurnConfig, StudioAgentTurnHandle } from './runtime';
export type { AskUserHandler, AskUserQuestion, SiteInfo } from './types';

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
} from './tools/define-tool';
export type { StudioToolsOptions } from './tools';
export { createPresentDesignOptionsTool } from './tools/present-design-options';
export { renderSkill } from './tools/skill';
export { textResult } from './tools/utils';
export { loadSkills } from './skills';
export { buildSystemPrompt } from './system-prompt';
export { createResultNotes } from './result-notes';
export { isImageGenerationAvailable } from './image-generation';
export type { DesignTracksContext } from './design-tracks';

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
export { captureScreenshotBuffer } from './tools/screenshot-helpers';
export { validateBlocks } from './block-validator';
export { getWpcomAiGatewayBaseUrl } from './ai-gateway';
