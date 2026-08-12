import { describe, expect, it } from 'vitest';
import { AGENT_NAME, getAiTracksIdentity } from '../tracks-identity';

describe( 'getAiTracksIdentity', () => {
	it( 'reports the agent identity shared by every Studio Code event', () => {
		expect( getAiTracksIdentity( 'session-uuid' ) ).toEqual( {
			ai_session_id: 'session-uuid',
			agent_name: AGENT_NAME,
			client: 'studio-code',
		} );
	} );

	// The pi runtime is pinned per Studio release, so `app_version` already determines the agent
	// version. Sending it too would be a redundant column kept in sync by hand.
	it( 'does not report an agent version', () => {
		expect( getAiTracksIdentity( 'session-uuid' ) ).not.toHaveProperty( 'agent_version' );
	} );
} );
