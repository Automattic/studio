// The Studio Code agent for apps that run it in Node: `createAgent( { host } )`
// and what its hosts need around it. The session store, settings and
// run-manager that only show the agent stay importable on their own, so those
// apps never load the runtime.
export { createAgent, type StudioAgent } from './agent';
export type { HostSite, ProgressCallback, StudioAgentHost } from '@studio/agent/shared/host';
export type { StudioAgentTurnConfig, StudioAgentTurnHandle } from './runtime';
export {
	remoteSiteFromStored,
	storedFromRemoteSite,
	wpcomApproval,
	WPCOM_HOST,
	type HostSiteListing,
	type RemoteHost,
	type RemoteSite,
	type StoredSiteSelection,
} from '@studio/agent/shared/remote-hosts';
export type { AskUserHandler, AskUserQuestion, SiteInfo } from '@studio/agent/shared/types';

// Tools a host serves next to Studio's own, such as `studio mcp`'s.
export {
	bindTool,
	defineTool,
	READ_ONLY,
	REMOTE_CHANGE,
	REMOTE_READ,
	type AnyStudioAgentTool,
	type StudioAgentTool,
	type StudioToolDefinition,
	type ToolResult,
} from '@studio/agent/shared/tools/define-tool';
export type { StudioToolsOptions } from '@studio/agent/shared/tools';
export { renderSkill } from '@studio/agent/shared/tools/skill';
export { siteOfCall, textResult } from '@studio/agent/shared/tools/utils';
export { loadSkills } from '@studio/agent/shared/skills';
export { buildSystemPrompt } from '@studio/agent/shared/system-prompt';
export type { ImageGenerator } from '@studio/agent/shared/image-generation';

// What Studio says about a site after a served tool's call, for `studio mcp`.
export { createSiteNotes, notesAfterCall, type SiteNotes } from './site-notes';
export { NO_CHANGES, SiteChanges, type SettledChanges } from './site-changes';
export { studioMessage, validationLines } from '@studio/agent/shared/studio-message';
export { getSessionState } from './runtime/session-state';

// Turns as the host records them.
export { resolveResumeSessionContext } from './sessions/context';
export { createTurnStatsTracker } from './turn-stats';
export {
	addAssistantMessageUsage,
	addToolCallUsage,
	createTokenUsage,
	type TokenUsage,
} from './token-usage';

// Shared with the CLI's own commands.
export {
	closeSharedBrowser,
	ensurePlaywrightChromiumInstalled,
	getSharedBrowser,
} from './browser-utils';
export { captureScreenshotBuffer } from '@studio/agent/shared/tools/screenshot-helpers';
export { validateBlocks } from './block-validator';
export { nodeHostServices } from './node-host';
