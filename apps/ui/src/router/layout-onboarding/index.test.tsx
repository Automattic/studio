import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import onboardingLayoutStyles from '@/components/onboarding-layout/style.module.css';
import { ConnectorProvider } from '@/data/core';
import { OnboardingShellView } from './index';
import type { Connector } from '@/data/core';
import type { ReactNode } from 'react';

// FullscreenChrome reports which surface the window controls sit on; the stub
// is enough because the browser has no overlay to repaint.
function Providers( { children }: { children: ReactNode } ) {
	return <ConnectorProvider connector={ {} as Connector }>{ children }</ConnectorProvider>;
}

vi.mock( '@/components/dot-grid', () => ( {
	DotGrid: () => <canvas data-testid="dot-grid" />,
} ) );

describe( 'OnboardingShellView', () => {
	it( 'moves focus to the route heading', () => {
		const { rerender } = render(
			<OnboardingShellView hasSites={ false } pathname="/onboarding/tour" onClose={ vi.fn() }>
				<h1>Create</h1>
			</OnboardingShellView>,
			{ wrapper: Providers }
		);
		expect( screen.getByRole( 'heading', { name: 'Create' } ) ).toHaveFocus();

		rerender(
			<OnboardingShellView hasSites={ false } pathname="/onboarding/tour" onClose={ vi.fn() }>
				<h1>Import</h1>
			</OnboardingShellView>
		);
		expect( screen.getByRole( 'heading', { name: 'Import' } ) ).toHaveFocus();
	} );

	it( 'closes on Escape', () => {
		const onClose = vi.fn();
		render(
			<OnboardingShellView hasSites pathname="/onboarding/tour" onClose={ onClose }>
				<h1>Tour</h1>
			</OnboardingShellView>,
			{ wrapper: Providers }
		);
		fireEvent.keyDown( document.body, { key: 'Escape' } );

		expect( onClose ).toHaveBeenCalled();
	} );

	it( 'ignores Escape without sites', () => {
		const onClose = vi.fn();
		render(
			<OnboardingShellView hasSites={ false } pathname="/onboarding/tour" onClose={ onClose }>
				<h1>Tour</h1>
			</OnboardingShellView>,
			{ wrapper: Providers }
		);
		fireEvent.keyDown( document.body, { key: 'Escape' } );

		expect( onClose ).not.toHaveBeenCalled();
	} );

	it( 'ignores Escape when a popup already consumed it', () => {
		const onClose = vi.fn();
		render(
			<OnboardingShellView hasSites pathname="/onboarding/tour" onClose={ onClose }>
				<h1>Tour</h1>
			</OnboardingShellView>,
			{ wrapper: Providers }
		);
		const event = new KeyboardEvent( 'keydown', { key: 'Escape', cancelable: true } );
		event.preventDefault();
		document.body.dispatchEvent( event );

		expect( onClose ).not.toHaveBeenCalled();
	} );

	it( 'reserves content space when Close is visible', () => {
		render(
			<OnboardingShellView hasSites pathname="/onboarding/tour" onClose={ vi.fn() }>
				<h1>Create</h1>
			</OnboardingShellView>,
			{ wrapper: Providers }
		);

		const content = screen.getByRole( 'heading', { name: 'Create' } ).parentElement?.parentElement;
		expect( content ).toHaveClass( onboardingLayoutStyles.contentWithClose );
	} );
} );
