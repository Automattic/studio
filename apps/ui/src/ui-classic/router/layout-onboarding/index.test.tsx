import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingShellView, useOnboardingProgress } from './index';

vi.mock( '@/components/dot-grid', () => ( {
	DotGrid: () => <canvas data-testid="dot-grid" />,
} ) );

function TestRoute() {
	const { setProgress } = useOnboardingProgress();
	const [ page, setPage ] = useState( 'Create' );
	return (
		<>
			<h1>{ page }</h1>
			<button type="button" onClick={ () => setProgress( 'Creating site…' ) }>
				Create
			</button>
			<button type="button" onClick={ () => setProgress( null ) }>
				Fail
			</button>
			<button type="button" onClick={ () => setPage( 'Import' ) }>
				Change route
			</button>
		</>
	);
}

describe( 'OnboardingShellView', () => {
	it( 'announces progress, makes route content inert, and disables Close', () => {
		const { container } = render(
			<OnboardingShellView
				hasSites
				isWide={ false }
				pathname="/onboarding/create"
				onClose={ vi.fn() }
			>
				<TestRoute />
			</OnboardingShellView>
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Create' } ) );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Creating site…' );
		expect( container.querySelector( '[inert]' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Close' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'restores route interaction after progress clears', () => {
		const { container } = render(
			<OnboardingShellView
				hasSites
				isWide={ false }
				pathname="/onboarding/create"
				onClose={ vi.fn() }
			>
				<TestRoute />
			</OnboardingShellView>
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Create' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Fail' } ) );

		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
		expect( container.querySelector( '[inert]' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Close' } ) ).toHaveAttribute(
			'aria-disabled',
			'false'
		);
	} );

	it( 'moves focus to the route heading', () => {
		const { rerender } = render(
			<OnboardingShellView
				hasSites={ false }
				isWide={ false }
				pathname="/onboarding/create"
				onClose={ vi.fn() }
			>
				<h1>Create</h1>
			</OnboardingShellView>
		);
		expect( screen.getByRole( 'heading', { name: 'Create' } ) ).toHaveFocus();

		rerender(
			<OnboardingShellView
				hasSites={ false }
				isWide={ false }
				pathname="/onboarding/import"
				onClose={ vi.fn() }
			>
				<h1>Import</h1>
			</OnboardingShellView>
		);
		expect( screen.getByRole( 'heading', { name: 'Import' } ) ).toHaveFocus();
	} );
} );
