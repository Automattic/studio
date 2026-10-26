import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { SettingsGroup, SettingsRow, SettingsToggle } from './rows';

describe( 'shared Settings fields', () => {
	it( 'keeps a semantic name and description on each section', async () => {
		renderWithProviders(
			<SettingsGroup title="Preferences" description="Application preferences.">
				<SettingsRow title="Open chats">
					<SettingsToggle label="Open chats" checked onChange={ vi.fn() } />
				</SettingsRow>
			</SettingsGroup>
		);
		expect( await screen.findByRole( 'group', { name: 'Preferences' } ) ).toContainElement(
			screen.getByRole( 'switch', { name: 'Open chats' } )
		);
		expect( screen.getByText( 'Application preferences.' ) ).toBeInTheDocument();
	} );
} );
