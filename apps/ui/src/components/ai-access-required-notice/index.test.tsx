import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OutOfCreditsNotice } from './index';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/components/add-ai-credits-button', () => ( {
	AddAiCreditsButton: () => <button type="button">Add AI credits</button>,
} ) );

describe( 'OutOfCreditsNotice', () => {
	it( 'names the state, explains it, and offers the fix', () => {
		render( <OutOfCreditsNotice /> );

		// Notice mirrors its content into an a11y live region, so each string
		// is on screen twice.
		expect( screen.getAllByText( 'No AI credits available' ).length ).toBeGreaterThan( 0 );
		expect( screen.getAllByText( /You’ve used your available AI credits/ ).length ).toBeGreaterThan(
			0
		);
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toBeInTheDocument();
	} );
} );
