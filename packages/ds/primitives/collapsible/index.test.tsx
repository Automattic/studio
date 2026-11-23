import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CollapsiblePanel } from '.';

describe( 'CollapsiblePanel', () => {
	it( 'marks an open panel settled, including after it reopens', async () => {
		const { rerender } = render(
			<CollapsiblePanel open data-testid="panel">
				Chats
			</CollapsiblePanel>
		);
		expect( screen.getByTestId( 'panel' ) ).toHaveAttribute( 'data-settled' );

		rerender(
			<CollapsiblePanel open={ false } data-testid="panel">
				Chats
			</CollapsiblePanel>
		);
		await waitFor( () => expect( screen.queryByTestId( 'panel' ) ).not.toBeInTheDocument() );

		rerender(
			<CollapsiblePanel open data-testid="panel">
				Chats
			</CollapsiblePanel>
		);
		await waitFor( () =>
			expect( screen.getByTestId( 'panel' ) ).toHaveAttribute( 'data-settled' )
		);
	} );
} );
