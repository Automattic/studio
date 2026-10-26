import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SidebarHeader } from './index';

describe( 'SidebarHeader', () => {
	it( 'opens the app menu when the host has no native menu bar', async () => {
		const connector = createFakeConnector( {}, { showsAppMenuButton: true } );
		renderWithProviders( <SidebarHeader />, { connector } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Menu' } ) );
		await waitFor( () => expect( connector.popupAppMenu ).toHaveBeenCalledWith( { x: 0, y: 0 } ) );
	} );

	it( 'hides the app menu button when the host has a native menu bar', async () => {
		renderWithProviders( <SidebarHeader /> );
		expect( await screen.findByRole( 'button', { name: /sidebar$/ } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Menu' } ) ).not.toBeInTheDocument();
	} );
} );
