import type { TracksAiIdentity } from '@studio/common/lib/record-tracks-event';

// The agent runtime backing Studio Code, not the product.
export const AGENT_NAME = 'pi';

// Identity props shared by every Studio Code event, so the CLI and Main emitters can't drift.
export function getAiTracksIdentity( sessionId: string ): TracksAiIdentity {
	return {
		ai_session_id: sessionId,
		agent_name: AGENT_NAME,
		client: 'studio-code',
	};
}
