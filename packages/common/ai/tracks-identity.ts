import type { TracksAiIdentity } from '@studio/common/lib/record-tracks-event';

// The agent runtime backing Studio Code. `apps/cli/ai/runtimes/` is keyed by runtime, so this names
// the one actually in use rather than the product.
export const AGENT_NAME = 'pi';

// Kept in sync with the `@earendil-works/pi-coding-agent` pin in the workspace package.json files —
// the dependency is pinned to an exact version (never a range), so this cannot drift silently, and a
// test asserts the two agree. Read from a constant rather than pi's exported `VERSION` because that
// constant lives in a module which probes the filesystem and shells out to the package manager at
// import time, and this module is loaded by Desktop Main.
const PI_VERSION = '0.82.1';

// Identity props shared by every Studio Code Tracks event. Lives here because the events are emitted
// from two places — the CLI for the chat events, Desktop Main for session creation — and the values
// must not drift between them. `client` names the AI product; `channel` (attached by the wrappers)
// still records the surface. See `docs/design-docs/analytics-tracks.md`.
//
// The version comes from the package manifest rather than pi's exported `VERSION`: that constant
// lives in a module which probes the filesystem and shells out to the package manager at import
// time, and this module is loaded by Desktop Main. The dependency is pinned to an exact version, so
// the two always agree.
export function getAiTracksIdentity( sessionId: string ): TracksAiIdentity {
	return {
		ai_session_id: sessionId,
		agent_name: AGENT_NAME,
		agent_version: PI_VERSION,
		client: 'studio-code',
	};
}
