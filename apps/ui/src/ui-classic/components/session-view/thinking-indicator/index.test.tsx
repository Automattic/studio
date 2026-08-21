import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThinkingIndicator } from './index';

describe( 'ThinkingIndicator', () => {
	it( 'uses the shared working mark without adding a nested status', () => {
		const { container } = render(
			<ThinkingIndicator active startedAt={ Date.now() } progressMessage={ null } />
		);

		expect( screen.getAllByRole( 'status' ) ).toHaveLength( 1 );
		expect( container.querySelector( '[aria-hidden="true"]' ) ).toBeInTheDocument();
	} );
} );
