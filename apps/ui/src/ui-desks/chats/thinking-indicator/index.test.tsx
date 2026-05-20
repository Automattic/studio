import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThinkingIndicator } from './index';

const thinkingMocks = vi.hoisted( () => ( {
	randomThinkingMessage: vi.fn(),
} ) );

vi.mock( '@studio/common/ai/thinking-messages', () => ( {
	randomThinkingMessage: thinkingMocks.randomThinkingMessage,
} ) );

describe( 'desks ThinkingIndicator', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-01-01T00:00:00Z' ) );
		thinkingMocks.randomThinkingMessage.mockReset();
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'keeps the same thinking message while elapsed time updates', () => {
		thinkingMocks.randomThinkingMessage.mockReturnValueOnce( 'Thinking once' );
		thinkingMocks.randomThinkingMessage.mockReturnValue( 'Rotated message' );

		render(
			<ThinkingIndicator
				active
				startedAt={ Date.now() }
				messageKey={ null }
				progressMessage={ null }
			/>
		);

		expect( screen.getByText( 'Thinking once' ) ).toBeVisible();

		act( () => {
			vi.advanceTimersByTime( 4000 );
		} );

		expect( screen.getByText( 'Thinking once' ) ).toBeVisible();
		expect( screen.queryByText( 'Rotated message' ) ).not.toBeInTheDocument();
		expect( thinkingMocks.randomThinkingMessage ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'refreshes the thinking message when the active run step changes', () => {
		thinkingMocks.randomThinkingMessage
			.mockReturnValueOnce( 'Initial thinking' )
			.mockReturnValueOnce( 'Tool thinking' );
		const startedAt = Date.now();

		const { rerender } = render(
			<ThinkingIndicator
				active
				startedAt={ startedAt }
				messageKey={ null }
				progressMessage={ null }
			/>
		);

		rerender(
			<ThinkingIndicator
				active
				startedAt={ startedAt }
				messageKey="tool-call-1"
				progressMessage={ null }
			/>
		);

		expect( screen.getByText( 'Tool thinking' ) ).toBeVisible();
		expect( thinkingMocks.randomThinkingMessage ).toHaveBeenCalledTimes( 2 );
	} );
} );
