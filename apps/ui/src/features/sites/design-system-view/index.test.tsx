import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { DesignSystemView } from './index';

it( 'describes an unsupported theme without claiming the site has no design', async () => {
	renderWithProviders( <DesignSystemView siteId="one" siteDesign={ null } /> );
	expect(
		await screen.findByText( 'No design system is available for this theme.' )
	).toBeVisible();
	expect( screen.getByText( 'Design systems are available for block themes.' ) ).toBeVisible();
	expect( screen.queryByText( /DESIGN.md/ ) ).not.toBeInTheDocument();
} );

it( 'shows a retry message when WordPress could not be read', async () => {
	renderWithProviders(
		<DesignSystemView siteId="one" siteDesign={ null } error={ new Error( 'Offline' ) } />
	);
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
		'The design system could not be loaded. Try reloading the preview.'
	);
	expect(
		screen.queryByText( 'No design system is available for this theme.' )
	).not.toBeInTheDocument();
} );
