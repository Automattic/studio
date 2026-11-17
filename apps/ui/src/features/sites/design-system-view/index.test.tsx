import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { DesignSystemView } from './index';

it( 'describes a site without Styles without claiming WordPress failed', async () => {
	renderWithProviders(
		<DesignSystemView siteId="one" globalStyles={ null } onRetry={ vi.fn() } />
	);
	expect( await screen.findByText( 'This site has no design system.' ) ).toBeVisible();
	expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
} );

it.each( [
	[ 'WordPress could not be read', { globalStyles: null, error: new Error( 'Offline' ) } ],
	[ 'the Styles make no design', { globalStyles: { settings: {}, styles: {} } } ],
] )( 'offers another read when %s', async ( _, props ) => {
	const onRetry = vi.fn();
	renderWithProviders( <DesignSystemView siteId="one" onRetry={ onRetry } { ...props } /> );
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Design system could not load.' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
	expect( onRetry ).toHaveBeenCalledOnce();
} );
