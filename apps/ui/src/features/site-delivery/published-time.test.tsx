import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PublishedTime } from './published-time';

beforeEach( () => {
	vi.spyOn( Date, 'now' ).mockReturnValue( new Date( 2026, 10, 19, 12 ).getTime() );
} );

afterEach( () => vi.restoreAllMocks() );

it.each( [
	{ date: new Date( 2026, 10, 19, 12 ), label: 'Last updated just now' },
	{ date: new Date( 2026, 10, 19, 11, 55 ), label: 'Last updated 5 minutes ago' },
	{ date: new Date( 2026, 10, 19, 10 ), label: 'Last updated 2 hours ago' },
	{ date: new Date( 2026, 10, 18, 23, 59 ), label: 'Last updated on Nov 18' },
	{ date: new Date( 2025, 10, 18, 12 ), label: 'Last updated on Nov 18, 2025' },
] )( 'shows "$label" with the exact publish time', async ( { date, label } ) => {
	renderWithProviders( <PublishedTime timestamp={ date.toISOString() } /> );
	const note = await screen.findByText( label );
	expect( note ).toHaveAttribute( 'datetime', date.toISOString() );
	expect( note ).toHaveAttribute( 'title', date.toLocaleString( 'en' ) );
} );

it( 'does not display an invalid publish time', async () => {
	renderWithProviders(
		<div aria-label="Published time">
			<PublishedTime timestamp="invalid" />
		</div>
	);
	await screen.findByLabelText( 'Published time' );
	expect( screen.queryByRole( 'time' ) ).not.toBeInTheDocument();
} );
