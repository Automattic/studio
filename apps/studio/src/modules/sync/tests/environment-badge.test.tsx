import { render, screen } from '@testing-library/react';
import { EnvironmentBadge } from 'src/modules/sync/components/environment-badge';

describe( 'EnvironmentBadge', () => {
	it( 'renders the Production badge with correct label', () => {
		render( <EnvironmentBadge type="production" /> );
		const badge = screen.getByText( 'Production' );
		expect( badge ).toBeInTheDocument();
	} );

	it( 'renders the Staging badge with correct label', () => {
		render( <EnvironmentBadge type="staging" /> );
		const badge = screen.getByText( 'Staging' );
		expect( badge ).toBeInTheDocument();
	} );

	it( 'renders the Development badge with correct label', () => {
		render( <EnvironmentBadge type="development" /> );
		const badge = screen.getByText( 'Development' );
		expect( badge ).toBeInTheDocument();
	} );

	it( 'applies specific classes for the Production badge', () => {
		const { container } = render( <EnvironmentBadge type="production" /> );

		const badgeElement = container.firstChild as HTMLElement;
		expect( badgeElement ).toBeInTheDocument();

		expect( badgeElement.className ).toContain( 'bg-a8c-green-5' );
		expect( badgeElement.className ).toContain( 'text-a8c-green-80' );
	} );

	it( 'applies specific classes for the Staging badge', () => {
		const { container } = render( <EnvironmentBadge type="staging" /> );

		const badgeElement = container.firstChild as HTMLElement;
		expect( badgeElement ).toBeInTheDocument();

		expect( badgeElement.className ).toContain( 'text-a8c-yellow-80' );
		expect( badgeElement.className ).toContain( 'bg-a8c-yellow-10' );
	} );

	it( 'applies specific classes for the Development badge', () => {
		const { container } = render( <EnvironmentBadge type="development" /> );

		const badgeElement = container.firstChild as HTMLElement;
		expect( badgeElement ).toBeInTheDocument();

		expect( badgeElement.className ).toContain( 'text-development-text' );
		expect( badgeElement.className ).toContain( 'bg-development-bg' );
	} );

	it( 'applies "selected" styling when selected prop is true', () => {
		const { container } = render( <EnvironmentBadge type="production" selected={ true } /> );

		const badgeElement = container.firstChild as HTMLElement;
		expect( badgeElement ).toBeInTheDocument();

		expect( badgeElement.className ).toContain( 'bg-frame' );
		expect( badgeElement.className ).toContain( 'text-frame-theme' );
	} );
} );
