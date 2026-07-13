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

describe( 'OnboardingHomePage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.hasSites = false;
	} );

	it( 'shows only the working Create and Import jobs in the updated card design', () => {
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'heading', { name: 'Add a site' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'link', { name: /Create a new site/ } ) ).toHaveAttribute(
			'href',
			'/onboarding/create'
		);
		expect( screen.getByRole( 'link', { name: /Import from a backup/ } ) ).toHaveAttribute(
			'href',
			'/onboarding/import'
		);
		expect( screen.queryByText( 'Connect a site' ) ).not.toBeInTheDocument();
	} );

	it( 'shows Back when onboarding was opened from an existing site', () => {
		mocks.hasSites = true;
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toBeInTheDocument();
	} );
} );
