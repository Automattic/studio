import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollapsedSiteSwitcher } from './index';
import type { ReactNode } from 'react';

vi.mock( '@wordpress/theme', () => ( {
	privateApis: {
		ThemeProvider: ( { children }: { children: ReactNode } ) => children,
	},
} ) );

vi.mock( '@/lock-unlock', () => ( {
	unlock: ( value: unknown ) => value,
} ) );

vi.mock( '@/components/site-list', () => ( {
	SiteList: ( { className, onSiteOpen }: { className?: string; onSiteOpen?: () => void } ) => (
		<div className={ className } data-testid="site-list">
			<button onClick={ onSiteOpen }>My site</button>
			<button>Site status: Running. Stop site</button>
		</div>
	),
} ) );

describe( 'CollapsedSiteSwitcher', () => {
	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'renders the shared site list in the floating sidebar theme', () => {
		render(
			<CollapsedSiteSwitcher backgroundColor="#1e1e1e">
				<button aria-label="Show sidebar">Toggle</button>
			</CollapsedSiteSwitcher>
		);

		expect( screen.getByTestId( 'site-list' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Site status: Running. Stop site' } )
		).toBeInTheDocument();
		expect( screen.getByRole( 'navigation', { name: 'Sites' } ) ).toHaveStyle( {
			backgroundColor: '#1e1e1e',
		} );
	} );

	it( 'dismisses after a site opens and resets when the pointer returns to the toggle', () => {
		render(
			<CollapsedSiteSwitcher backgroundColor="#1e1e1e">
				<button aria-label="Show sidebar">Toggle</button>
			</CollapsedSiteSwitcher>
		);

		const root = screen.getByRole( 'navigation', { name: 'Sites' } ).parentElement?.parentElement;
		expect( root ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );

		expect( root ).toHaveAttribute( 'data-dismissed', 'true' );
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toHaveFocus();

		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'Show sidebar' } ).parentElement! );

		expect( root ).not.toHaveAttribute( 'data-dismissed' );
	} );

	it( 'dismisses with Escape and returns focus to the toggle', () => {
		render(
			<CollapsedSiteSwitcher backgroundColor="#1e1e1e">
				<button aria-label="Show sidebar">Toggle</button>
			</CollapsedSiteSwitcher>
		);

		const root = screen.getByRole( 'navigation', { name: 'Sites' } ).parentElement?.parentElement;
		expect( root ).toBeInTheDocument();

		fireEvent.keyDown( root!, { key: 'Escape' } );

		expect( root ).toHaveAttribute( 'data-dismissed', 'true' );
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toHaveFocus();
	} );

	it( 'keeps the mini-sidebar open while the pointer crosses a brief hover gap', async () => {
		vi.useFakeTimers();
		render(
			<CollapsedSiteSwitcher backgroundColor="#1e1e1e">
				<button aria-label="Show sidebar">Toggle</button>
			</CollapsedSiteSwitcher>
		);

		const root = screen.getByRole( 'navigation', { name: 'Sites' } ).parentElement?.parentElement;
		expect( root ).toBeInTheDocument();

		fireEvent.mouseEnter( root! );
		fireEvent.mouseLeave( root! );
		expect( root ).toHaveAttribute( 'data-hover-open', 'true' );

		await act( () => vi.advanceTimersByTime( 300 ) );
		fireEvent.mouseEnter( root! );
		await act( () => vi.advanceTimersByTime( 100 ) );

		expect( root ).toHaveAttribute( 'data-hover-open', 'true' );

		fireEvent.mouseLeave( root! );
		await act( () => vi.advanceTimersByTime( 350 ) );

		expect( root ).not.toHaveAttribute( 'data-hover-open' );
	} );
} );
