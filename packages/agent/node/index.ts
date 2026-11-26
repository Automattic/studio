// The Studio Code agent: `createAgent( { host } )` and what its hosts need
// around it. The session store, settings and run-manager that only show the
// agent stay importable on their own, so those apps never load the runtime.
export { createAgent, type StudioAgent } from './agent';
export type { HostRemoteSite, HostSite, StudioAgentHost } from './host';
export type { AskUserHandler, AskUserQuestion, SiteInfo } from './types';
export type { ImageGenerator } from './image-generation';
export type { DesignTracksContext } from './design-tracks';

// Tools a host serves next to Studio's own, such as `studio mcp`'s.
export {
	bindTool,
	defineTool,
	READ_ONLY,
	REMOTE_CHANGE,
	REMOTE_READ,
	type AnyStudioAgentTool,
} from './tools/define-tool';
export { textResult } from './tools/utils';
export { loadSkills } from './skills';
export { renderHostSkill, selectUserSkills } from './tools/skill';
export type { HostSkills } from './tools/studio-instructions';

// Turns as the host records them.
export { resolveResumeSessionContext } from './sessions/context';
export { createTurnStatsTracker } from './turn-stats';
export { addAssistantMessageUsage, createTokenUsage } from './token-usage';

// Shared with the CLI's own commands.
export {
	closeSharedBrowser,
	ensurePlaywrightChromiumInstalled,
	getSharedBrowser,
} from './browser-utils';
export { captureScreenshotBuffer } from './tools/screenshot-helpers';
export { validateBlocks } from './block-validator';
