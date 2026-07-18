import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingHomePage } from './index';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn(),
	hasSites: false,
} ) );

vi.mock( '@tanstack/react-router', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@tanstack/react-router') >();
	return {
		...actual,
		Link: ( { to, children, ...props }: ComponentProps< 'a' > & { to: string } ) => (
			<a href={ to } { ...props }>
				{ children }
			</a>
		),
		useNavigate: () => mocks.navigate,
	};
} );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: mocks.hasSites ? [ { id: 'site-1' } ] : [] } ),
} ) );

// ImportDropCard only reaches for the connector in interaction handlers, so a
// bare stub keeps the render happy.
vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {} ),
} ) );

describe( 'OnboardingHomePage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.hasSites = false;
	} );

	it( 'offers the create, connect, and import paths', () => {
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'heading', { name: 'Add a site' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'link', { name: /Create a new site/ } ) ).toHaveAttribute(
			'href',
			'/onboarding/create'
		);
		expect( screen.getByText( 'Connect a site' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Import from a backup' ) ).toBeInTheDocument();
	} );

	it( 'shows Back to the tour only for first-run users without sites', () => {
		render( <OnboardingHomePage /> );
		expect( screen.getByRole( 'button', { name: /Back/ } ) ).toBeInTheDocument();
	} );

	it( 'hides the Back button once sites exist', () => {
		mocks.hasSites = true;
		render( <OnboardingHomePage /> );
		expect( screen.queryByRole( 'button', { name: /Back/ } ) ).not.toBeInTheDocument();
	} );
} );
