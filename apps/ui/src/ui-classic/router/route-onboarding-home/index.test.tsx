import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingHomePage } from './index';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn(),
	hasSites: false,
	isOffline: false,
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

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: () => mocks.isOffline,
} ) );

describe( 'OnboardingHomePage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.hasSites = false;
		mocks.isOffline = false;
	} );

	it( 'offers Create and Connect as distinct Add Site choices', () => {
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'heading', { name: 'Add a site' } ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Start fresh or bring an existing WordPress.com site into Studio.' )
		).toBeInTheDocument();
		expect( screen.getByRole( 'link', { name: /Create a new site/ } ) ).toHaveAttribute(
			'href',
			'/onboarding/create'
		);
		expect( screen.queryByText( 'Import from a backup' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'link', { name: /Connect a site/ } ) ).toHaveAttribute(
			'href',
			'/onboarding/connect'
		);
	} );

	it( 'marks Connect unavailable while offline', () => {
		mocks.isOffline = true;
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'link', { name: /Connect a site/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByText( 'Available online' ) ).toBeInTheDocument();
	} );

	it( 'shows Back when onboarding was opened from an existing site', () => {
		mocks.hasSites = true;
		render( <OnboardingHomePage /> );

		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toBeInTheDocument();
	} );
} );
