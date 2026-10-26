import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToolUseRow } from './index';
import type { NormalizedToolResult } from '@studio/common/ai/tools';

function ToolRow( { result }: { result?: NormalizedToolResult } ) {
	return (
		<ToolUseRow
			name="Read"
			input={ { file_path: 'style.css' } }
			result={ result }
			isRunning={ ! result }
		/>
	);
}

describe( 'tool trace', () => {
	it( 'preserves keyboard disclosure while a running tool completes', async () => {
		const user = userEvent.setup();
		const { rerender } = render( <ToolRow /> );
		const trigger = screen.getByRole( 'button', { name: /style\.css/ } );
		expect( trigger ).toHaveAttribute( 'aria-expanded', 'false' );
		await user.tab();
		expect( trigger ).toHaveFocus();
		await user.keyboard( '{Enter}' );
		expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );
		rerender( <ToolRow result={ { text: 'File contents', isError: false } } /> );
		expect( screen.getByRole( 'button', { name: /style\.css/ } ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect( screen.getByText( 'File contents' ) ).toBeVisible();
		await user.keyboard( ' ' );
		expect( trigger ).toHaveAttribute( 'aria-expanded', 'false' );
	} );

	it( 'shows failed results expanded and allows closing them', async () => {
		const user = userEvent.setup();
		render( <ToolRow result={ { text: 'File missing', isError: true } } /> );
		const trigger = screen.getByRole( 'button', { name: /style\.css/ } );
		expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'File missing' ) ).toBeVisible();
		await user.click( trigger );
		expect( trigger ).toHaveAttribute( 'aria-expanded', 'false' );
	} );
} );
