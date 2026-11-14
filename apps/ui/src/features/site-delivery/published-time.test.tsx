import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PublishedTime } from './published-time';

it.each( [
	{ minutes: 0, label: 'Published just now' },
	{ minutes: 5, label: 'Published 5 minutes ago' },
	{ minutes: 120, label: 'Published 2 hours ago' },
] )( 'shows $label for recent publishes', async ( { minutes, label } ) => {
	renderWithProviders(
		<PublishedTime timestamp={ new Date( Date.now() - minutes * 60_000 ).toISOString() } />
	);
	expect( await screen.findByText( label ) ).toBeVisible();
} );

it( 'shows a date for publishes at least a day old', async () => {
	const date = new Date( Date.now() - 3 * 24 * 60 * 60_000 );
	renderWithProviders( <PublishedTime timestamp={ date.toISOString() } /> );
	expect(
		await screen.findByText(
			`Published ${ date.toLocaleDateString( 'en', {
				month: 'short',
				day: 'numeric',
				...( date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {} ),
			} ) }`
		)
	).toHaveAttribute( 'datetime', date.toISOString() );
} );

it( 'does not display an invalid publish time', async () => {
	renderWithProviders(
		<div aria-label="Published time">
			<PublishedTime timestamp="invalid" />
		</div>
	);
	await screen.findByLabelText( 'Published time' );
	expect( screen.queryByText( /Published/ ) ).not.toBeInTheDocument();
} );
