import type { AuthToken } from '../auth.ts';
import type { Box } from '../locators.ts';
import type { Profile } from '../profile.ts';
import type { Look } from '../schema.ts';
import type { Page } from 'playwright';

export const DRIVERS = [ 'electron', 'browser' ] as const;
export type DriverName = ( typeof DRIVERS )[ number ];

// What a run of Studio Code looks like to the window: `AgentRunEvent` in
// packages/agent/protocol/agent-events.ts.
export interface AgentRunEvent {
	runId: string;
	sessionId: string;
	event: Record< string, unknown >;
}

// A remote site's files, by directory, as WordPress.com's backup browser lists them.
export type RemoteTrees = Record< string, Record< string, unknown > >;

/**
 * Answers Studio's questions about the signed-in account with made-up data,
 * whichever front end asks: the Desktop app asks its main process over IPC,
 * the browser app asks `studio ui`'s HTTP API.
 */
export interface Stubs {
	syncableSites( sites: unknown[] ): Promise< void >;
	previewSites( snapshots: unknown[] ): Promise< void >;
	connectedSites(
		connected: { localSiteId: string }[],
		trees: RemoteTrees,
		hosting: { phpVersion: string; rewindId: string }
	): Promise< void >;
	// Sending a prompt starts a made-up run instead of the agent.
	agentRuns(): Promise< void >;
	lastAgentRun(): Promise< { runId: string; sessionId: string } | undefined >;
	sendAgentEvent( payload: AgentRunEvent ): Promise< void >;
}

/** A running Studio, Desktop or browser, as the harness drives it. */
export interface Studio {
	driver: DriverName;
	window: Page;
	version: string;
	stubs: Stubs;
	// A PNG of the window, or of `clip`, at the look's scale.
	screenshot( clip?: Box ): Promise< Buffer >;
	// Where macOS puts the window buttons, when it draws them over Studio.
	windowButtonPosition(): Promise< { x: number; y: number } | null >;
	// Runs `code` (an expression) in each site preview on screen; resolves with
	// each result and where that preview sits in the window.
	inPreviews< T >( code: string ): Promise< { result: T; offset: { x: number; y: number } }[] >;
	// Takes frames of the window for a recording until the returned function is called.
	startFrames( options: {
		fps: number;
		width: number;
	} ): Promise< () => Promise< { at: number; jpeg: Buffer }[] > >;
	close(): Promise< void >;
}

export interface LaunchOptions {
	profile: Profile;
	look: Look;
	firstRun?: boolean;
	appData?: Record< string, unknown >;
	authToken?: AuthToken | null;
	// What the signed-in account reports, instead of WordPress.com's answers.
	account?: { aiQuota?: unknown; previewSiteUrls?: string[] };
}
