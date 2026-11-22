import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { DesignSystemView } from './index';

it( 'describes an unsupported theme without claiming the site has no design', async () => {
	renderWithProviders( <DesignSystemView siteId="one" siteDesign={ null } onRetry={ vi.fn() } /> );
	expect(
		await screen.findByText( 'No design system is available for this theme.' )
	).toBeVisible();
	expect( screen.getByText( 'Design systems are available for block themes.' ) ).toBeVisible();
	expect( screen.queryByText( /DESIGN.md/ ) ).not.toBeInTheDocument();
} );

it( 'shows a retry message when WordPress could not be read', async () => {
	const onRetry = vi.fn();
	renderWithProviders(
		<DesignSystemView
			siteId="one"
			siteDesign={ null }
			error={ new Error( 'Offline' ) }
			onRetry={ onRetry }
		/>
	);
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Design system could not load.' );
	expect(
		screen.queryByText( 'No design system is available for this theme.' )
	).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
	expect( onRetry ).toHaveBeenCalledOnce();
} );

it( 'offers another read when the theme design is invalid', async () => {
	const onRetry = vi.fn();
	renderWithProviders(
		<DesignSystemView
			siteId="one"
			siteDesign={ { design: null, themeJson: {} } }
			onRetry={ onRetry }
		/>
	);
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Design system could not load.' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
	expect( onRetry ).toHaveBeenCalledOnce();
} );
