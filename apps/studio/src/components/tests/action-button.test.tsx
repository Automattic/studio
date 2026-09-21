import { render, screen } from '@testing-library/react';
import { ActionButton } from 'src/components/action-button';

describe( 'ActionButton', () => {
	it( 'keeps the "Stopping…" label when running flips to false while still loading', () => {
		const { rerender } = render(
			<ActionButton isRunning isLoading onClick={ () => {} } buttonLabelOnDisabled="" />
		);
		expect( screen.getByText( 'Stopping…' ) ).toBeInTheDocument();

		// Running state is reconciled to false while the stop is still in flight; the label must not
		// flip to "Starting…" for the brief window before loading clears.
		rerender(
			<ActionButton isRunning={ false } isLoading onClick={ () => {} } buttonLabelOnDisabled="" />
		);

		expect( screen.getByText( 'Stopping…' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Starting…' ) ).not.toBeInTheDocument();
	} );

	it( 'shows "Starting…" for a start action that is loading', () => {
		render(
			<ActionButton isRunning={ false } isLoading onClick={ () => {} } buttonLabelOnDisabled="" />
		);
		expect( screen.getByText( 'Starting…' ) ).toBeInTheDocument();
	} );
} );
