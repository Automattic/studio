import type { TracksAiIdentity } from '@studio/common/lib/record-tracks-event';

// The agent runtime backing Studio Code. `apps/cli/ai/runtimes/` is keyed by runtime, so this names
// the one actually in use rather than the product.
export const AGENT_NAME = 'pi';

// Identity props shared by every Studio Code Tracks event. Shared so the two emitters — the CLI for
// chat, Desktop Main for session creation — can't drift. No `agent_version`: pi is pinned per Studio
// release, so `app_version` already determines it. See `docs/design-docs/analytics-tracks.md`.
export function getAiTracksIdentity( sessionId: string ): TracksAiIdentity {
	return {
		ai_session_id: sessionId,
		agent_name: AGENT_NAME,
		client: 'studio-code',
	};
}
