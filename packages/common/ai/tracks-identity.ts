import type { TracksAiIdentity } from '@studio/common/lib/record-tracks-event';

// The agent runtime backing Studio Code. `apps/cli/ai/runtimes/` is keyed by runtime, so this names
// the one actually in use rather than the product.
export const AGENT_NAME = 'pi';

// Identity props shared by every Studio Code Tracks event. Lives here because the events are emitted
// from two places — the CLI for the chat events, Desktop Main for session creation — and the values
// must not drift between them. `client` names the AI product; `channel` (attached by the wrappers)
// still records the surface. See `docs/design-docs/analytics-tracks.md`.
//
// No `agent_version`: the pi runtime is pinned to an exact version per Studio release, so the
// `app_version` common prop already determines it. Sending it would be a redundant column that has to
// be kept in sync by hand — pi's own exported `VERSION` is not usable here, as it is a devDependency
// of this package and its module probes the filesystem and shells out to the package manager at
// import time.
export function getAiTracksIdentity( sessionId: string ): TracksAiIdentity {
	return {
		ai_session_id: sessionId,
		agent_name: AGENT_NAME,
		client: 'studio-code',
	};
}
