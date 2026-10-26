import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionUIProvider, useSessionPreviewUI } from '@/data/use-session-ui';
import { renderWithProviders } from '@/test/render';
import { useSessionCommands } from './use-session-commands';
import type { AgentRunEvent } from '@/data/core';

function Harness( { sessionId }: { sessionId: string } ) {
	useSessionCommands( sessionId );
	const preview = useSessionPreviewUI();
	return <span data-testid="nonce">{ preview.reloadNonce }</span>;
}

describe( 'useSessionCommands preview reloads', () => {
	async function renderHarness( sessionId = 'session-1' ) {
		const view = renderWithProviders(
			<SessionUIProvider>
				<Harness sessionId={ sessionId } />
			</SessionUIProvider>
		);
		await screen.findByTestId( 'nonce' );
		await waitFor( () =>
			expect( view.connector.listenerCount( 'onAgentEvent' ) ).toBeGreaterThan( 0 )
		);
		const send = ( session: string, event: AgentRunEvent[ 'event' ] ) =>
			act( () =>
				view.connector.emit( 'onAgentEvent', {
					runId: 'run-1',
					sessionId: session,
					event,
				} as AgentRunEvent )
			);
		return { send };
	}

	const nonce = () => Number( screen.getByTestId( 'nonce' ).textContent );

	it( 'reloads the preview only when the agent asks for it, not when a run ends', async () => {
		const { send } = await renderHarness();
		const before = nonce();

		send( 'session-1', { type: 'run.started', timestamp: '2026-07-01T00:00:00.000Z' } );
		send( 'session-1', { type: 'preview.reload', timestamp: '2026-07-01T00:00:00.000Z' } );
		expect( nonce() ).toBe( before + 1 );
		send( 'session-1', {
			type: 'run.exited',
			timestamp: '2026-07-01T00:00:00.000Z',
			status: 'success',
			code: 0,
		} );
		send( 'session-1', { type: 'run.interrupted', timestamp: '2026-07-01T00:00:00.000Z' } );
		expect( nonce() ).toBe( before + 1 );
	} );

	it( 'ignores other sessions', async () => {
		const { send } = await renderHarness( 'session-1' );
		const before = nonce();

		send( 'session-2', { type: 'preview.reload', timestamp: '2026-07-01T00:00:00.000Z' } );
		expect( nonce() ).toBe( before );
	} );
} );
