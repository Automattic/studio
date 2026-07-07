import { describe, expect, it } from 'vitest';
import { getAgentEndErrorMessage, getAgentEndTurnResult } from '@studio/common/ai/session-events';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

type AgentEndEvent = Extract< AgentSessionEvent, { type: 'agent_end' } >;

function agentEnd( overrides: {
	stopReason?: string;
	errorMessage?: string;
	text?: string;
	empty?: boolean;
} ): AgentEndEvent {
	if ( overrides.empty ) {
		return { type: 'agent_end', messages: [] } as unknown as AgentEndEvent;
	}
	return {
		type: 'agent_end',
		messages: [
			{
				role: 'assistant',
				content: overrides.text ? [ { type: 'text', text: overrides.text } ] : [],
				stopReason: overrides.stopReason ?? 'stop',
				errorMessage: overrides.errorMessage,
			},
		],
	} as unknown as AgentEndEvent;
}

describe( 'getAgentEndErrorMessage', () => {
	it( 'returns the assistant errorMessage when present', () => {
		expect(
			getAgentEndErrorMessage(
				agentEnd( { stopReason: 'error', errorMessage: '  API Error: 500  ' } )
			)
		).toBe( 'API Error: 500' );
	} );

	it( 'falls back to the assistant text content when there is no errorMessage', () => {
		expect(
			getAgentEndErrorMessage( agentEnd( { stopReason: 'error', text: 'Something went wrong' } ) )
		).toBe( 'Something went wrong' );
	} );

	it( 'returns null when the errored turn carries neither a reason nor text', () => {
		expect( getAgentEndErrorMessage( agentEnd( { stopReason: 'error' } ) ) ).toBeNull();
	} );

	it( 'returns null when there is no assistant message', () => {
		expect( getAgentEndErrorMessage( agentEnd( { empty: true } ) ) ).toBeNull();
	} );
} );

describe( 'getAgentEndTurnResult', () => {
	it( 'reports failure for an errored turn', () => {
		expect( getAgentEndTurnResult( agentEnd( { stopReason: 'error' } ) ) ).toEqual( {
			success: false,
			interrupted: false,
		} );
	} );

	it( 'reports an interrupted turn separately from an error', () => {
		expect( getAgentEndTurnResult( agentEnd( { stopReason: 'aborted' } ) ) ).toEqual( {
			success: false,
			interrupted: true,
		} );
	} );

	it( 'reports success for a normal stop', () => {
		expect( getAgentEndTurnResult( agentEnd( { stopReason: 'stop' } ) ) ).toEqual( {
			success: true,
			interrupted: false,
		} );
	} );
} );
