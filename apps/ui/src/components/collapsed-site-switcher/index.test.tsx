import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollapsedSiteSwitcher } from './index';

vi.mock( '@/components/site-list', () => ( {
	SiteList: ( { className, onSiteOpen }: { className?: string; onSiteOpen?: () => void } ) => (
		<div className={ className } data-testid="site-list">
			<button onClick={ onSiteOpen }>My site</button>
		</div>
	),
} ) );

function renderSwitcher() {
	render(
		<CollapsedSiteSwitcher
			backgroundColor="#1e1e1e"
			trigger={ <button aria-label="Show sidebar">Toggle</button> }
		/>
	);
	return screen.getByRole( 'button', { name: 'Show sidebar' } );
}

describe( 'CollapsedSiteSwitcher', () => {
	it( 'mounts the shared site list only while the popover is open', () => {
		const trigger = renderSwitcher();

		expect( screen.queryByTestId( 'site-list' ) ).not.toBeInTheDocument();

		fireEvent.click( trigger );

		expect( screen.getByTestId( 'site-list' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'site-list' ).parentElement ).toHaveStyle( {
			backgroundColor: '#1e1e1e',
		} );
	} );

	it( 'closes after a site opens', () => {
		const trigger = renderSwitcher();
		fireEvent.click( trigger );

		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );

		expect( screen.queryByTestId( 'site-list' ) ).not.toBeInTheDocument();
	} );

	it( 'closes on Escape', () => {
		const trigger = renderSwitcher();
		fireEvent.click( trigger );
		expect( screen.getByTestId( 'site-list' ) ).toBeInTheDocument();

		fireEvent.keyDown( screen.getByTestId( 'site-list' ), { key: 'Escape' } );

		expect( screen.queryByTestId( 'site-list' ) ).not.toBeInTheDocument();
	} );

	it( 'does not consume Escape while closed', () => {
		const trigger = renderSwitcher();

		const eventWasCancelled = ! fireEvent.keyDown( trigger, { key: 'Escape' } );

		expect( eventWasCancelled ).toBe( false );
		expect( screen.queryByTestId( 'site-list' ) ).not.toBeInTheDocument();
	} );
} );
