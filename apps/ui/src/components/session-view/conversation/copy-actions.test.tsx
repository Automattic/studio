import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { Conversation } from '.';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

const { copyText } = vi.hoisted( () => ( { copyText: vi.fn().mockResolvedValue( undefined ) } ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( { copyText } ),
} ) );

function renderConversation( entries: SessionEntry[] ) {
	const data = { summary: { id: 'session-1' }, entries } as unknown as LoadedAiSession;
	return render(
		<QueryClientProvider client={ new QueryClient() }>
			<Tooltip.Provider delay={ 0 }>
				<Conversation
					data={ data }
					isRunning={ false }
					startedAt={ null }
					pendingQuestions={ new Set() }
					pendingAnswers={ {} }
					freeFormQuestion={ null }
					onAnswerQuestion={ vi.fn() }
					onChooseFreeForm={ vi.fn() }
				/>
			</Tooltip.Provider>
		</QueryClientProvider>
	);
}

describe( 'Conversation message actions', () => {
	it( 'copies a user prompt from the button beside its bubble', async () => {
		renderConversation( [
			{
				type: 'custom',
				customType: 'studio.user_prompt',
				data: { text: 'Hello there', source: 'prompt' },
			} as SessionEntry,
		] );

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy message' } ) );

		expect( copyText ).toHaveBeenCalledWith( 'Hello there' );
		await waitFor( () => expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Copied' ) );
	} );

	it( 'copies the whole reply from its last text block only', () => {
		renderConversation( [
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'First part.' },
						{ type: 'text', text: 'Second part.' },
					],
				},
			} as unknown as SessionEntry,
		] );

		const buttons = screen.getAllByRole( 'button', { name: 'Copy message' } );
		expect( buttons ).toHaveLength( 1 );
		expect( screen.getByText( 'Second part.' ).closest( '[data-message-text]' ) ).toContainElement(
			buttons[ 0 ]
		);

		fireEvent.click( buttons[ 0 ] );

		expect( copyText ).toHaveBeenCalledWith( 'First part.\n\nSecond part.' );
	} );
} );
