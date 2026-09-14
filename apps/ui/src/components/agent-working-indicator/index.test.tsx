import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentWorkingIndicator } from './index';

describe( 'AgentWorkingIndicator', () => {
	it( 'announces the default working state', () => {
		render( <AgentWorkingIndicator /> );

		expect( screen.getByRole( 'status', { name: 'Working…' } ) ).toBeInTheDocument();
	} );

	it( 'can be decorative when embedded in a larger status', () => {
		const { container } = render( <AgentWorkingIndicator label={ null } /> );

		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
		expect( container.firstChild ).toHaveAttribute( 'aria-hidden', 'true' );
	} );
} );
