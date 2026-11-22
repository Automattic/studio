import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { restartWalkthroughTracking, useWalkthroughTracking } from './walkthrough-analytics';

it( 'attributes a delayed prompt result to its original attempt after replay', async () => {
	const connector = createFakeConnector();
	let completePrompt: () => void = () => {};
	function Prompt() {
		const [ replay, setReplay ] = useState( false );
		const track = useWalkthroughTracking( 'try-chat', true );
		return (
			<>
				<button
					onClick={ () => {
						completePrompt = () => track( 'prompt_result', 'sent' );
					} }
				>
					Send
				</button>
				<button
					onClick={ () => {
						restartWalkthroughTracking( connector );
						setReplay( ! replay );
					} }
				>
					Replay
				</button>
			</>
		);
	}
	const { user } = renderWithProviders( <Prompt />, { connector } );
	await user.click( await screen.findByRole( 'button', { name: 'Send' } ) );
	const originalAttempt = connector.trackEvent.mock.calls.find(
		( [ event ] ) => event === TRACKS_EVENTS.WALKTHROUGH_STEP_VIEWED
	)?.[ 1 ]?.attempt_id;
	await user.click( screen.getByRole( 'button', { name: 'Replay' } ) );
	await waitFor( () =>
		expect( connector.trackEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.WALKTHROUGH_STEP_VIEWED,
			expect.objectContaining( {
				source: 'replay',
				attempt_id: expect.any( String ),
			} )
		)
	);
	expect( connector.trackEvent.mock.calls[ 1 ]?.[ 1 ]?.attempt_id ).not.toBe( originalAttempt );
	completePrompt();
	expect( connector.trackEvent ).toHaveBeenCalledWith(
		TRACKS_EVENTS.WALKTHROUGH_ACTION,
		expect.objectContaining( {
			action: 'prompt_result',
			outcome: 'sent',
			attempt_id: originalAttempt,
		} )
	);
} );
