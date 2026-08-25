import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OutOfCreditsNotice } from './index';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/components/ai-credits-top-up-options', () => ( {
	AiCreditsTopUpOptions: () => <div data-testid="top-up-options" />,
} ) );

describe( 'OutOfCreditsNotice', () => {
	it( 'states what happened and offers the top-ups', () => {
		render( <OutOfCreditsNotice /> );

		expect( screen.getByText( /You’re out of AI credits/ ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'top-up-options' ) ).toBeInTheDocument();
	} );
} );
