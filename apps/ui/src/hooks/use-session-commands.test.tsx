import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
			<span data-testid="open">{ String( preview.open ) }</span>
			<button onClick={ () => preview.setOpen( false ) }>close</button>
		</>
	);
}

describe( 'useSessionCommands preview.reload', () => {
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

	it( 'reloads the preview and reveals the panel', async () => {
		renderHarness();
		await waitFor( () => expect( agentListener ).toBeDefined() );

		// Collapse first to prove the reload re-opens the panel.
		fireEvent.click( screen.getByText( 'close' ) );
		expect( screen.getByTestId( 'open' ) ).toHaveTextContent( 'false' );
		const before = Number( screen.getByTestId( 'nonce' ).textContent );

		act( () => {
			agentListener( {
				runId: 'run-1',
				sessionId: 'session-1',
				event: { type: 'preview.reload', timestamp: '2026-07-01T00:00:00.000Z' },
			} as AgentRunEvent );
		} );

		expect( Number( screen.getByTestId( 'nonce' ).textContent ) ).toBe( before + 1 );
		expect( screen.getByTestId( 'open' ) ).toHaveTextContent( 'true' );
	} );

	it( 'ignores reload events for other sessions', async () => {
		renderHarness( 'session-1' );
		await waitFor( () => expect( agentListener ).toBeDefined() );
		const before = Number( screen.getByTestId( 'nonce' ).textContent );

		act( () => {
			agentListener( {
				runId: 'run-1',
				sessionId: 'session-2',
				event: { type: 'preview.reload', timestamp: '2026-07-01T00:00:00.000Z' },
			} as AgentRunEvent );
		} );

		expect( Number( screen.getByTestId( 'nonce' ).textContent ) ).toBe( before );
	} );
} );
