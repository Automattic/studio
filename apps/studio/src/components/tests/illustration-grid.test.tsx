import { render, screen } from '@testing-library/react';
import { IllustrationGrid } from 'src/components/illustration-grid';

// Mock DotGrid since it relies on canvas APIs not available in jsdom
vi.mock( 'src/components/dot-grid', () => ( {
	DotGrid: () => <canvas data-testid="dot-grid" />,
} ) );

describe( 'IllustrationGrid', () => {
	test( 'renders children', () => {
		render(
			<IllustrationGrid>
				<div data-testid="child">Hello</div>
			</IllustrationGrid>
		);
		expect( screen.getByTestId( 'child' ) ).toBeVisible();
	} );

	test( 'renders the dot grid canvas', () => {
		render(
			<IllustrationGrid>
				<div>Content</div>
			</IllustrationGrid>
		);
		expect( screen.getByTestId( 'dot-grid' ) ).toBeInTheDocument();
	} );
} );
