import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useSessionCommands } from './use-session-commands';
import { SessionUIProvider, useSessionPreviewUI } from './use-session-ui';
import type { AgentRunEvent, Connector } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

const useConnectorMock = vi.mocked( useConnector );

function Harness( { sessionId }: { sessionId: string } ) {
	useSessionCommands( sessionId );
	const preview = useSessionPreviewUI();
	return (
		<>
			<span data-testid="nonce">{ preview.reloadNonce }</span>
		</>
	);
}

describe( 'useSessionCommands preview reloads', () => {
	let agentListener: ( event: AgentRunEvent ) => void;

	beforeEach( () => {
		useConnectorMock.mockReturnValue( {
			onAgentEvent: vi.fn( ( listener ) => {
				agentListener = listener;
				return vi.fn();
			} ),
			onToggleSitePreview: vi.fn( () => vi.fn() ),
		} as unknown as Connector );
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	function renderHarness( sessionId = 'session-1' ) {
		return render( <Harness sessionId={ sessionId } />, {
			wrapper: ( { children }: { children: ReactNode } ) => (
				<SessionUIProvider>{ children }</SessionUIProvider>
			),
		} );
	}

	function send( sessionId: string, event: AgentRunEvent[ 'event' ] ) {
		act( () => agentListener( { runId: 'run-1', sessionId, event } as AgentRunEvent ) );
	}
	const nonce = () => Number( screen.getByTestId( 'nonce' ).textContent );

	it( 'reloads the preview only when the agent asks for it, not when a run ends', async () => {
		renderHarness();
		await waitFor( () => expect( agentListener ).toBeDefined() );
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
		renderHarness( 'session-1' );
		await waitFor( () => expect( agentListener ).toBeDefined() );
		const before = nonce();

		send( 'session-2', { type: 'preview.reload', timestamp: '2026-07-01T00:00:00.000Z' } );
		expect( nonce() ).toBe( before );
	} );
} );
