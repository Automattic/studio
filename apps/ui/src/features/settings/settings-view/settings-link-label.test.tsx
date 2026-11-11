import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveSettingsLink } from '@/data/settings-sections';
import { SettingsLinkContext } from '@/features/settings/settings-dialog/context';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp, renderWithProviders } from '@/test/render';
import { SettingsRow } from './rows';

async function renderLabel() {
	const view = renderWithProviders(
		<SettingsLinkContext.Provider value>
			<SettingsRow title="Language">
				<input aria-label="Language" />
			</SettingsRow>
		</SettingsLinkContext.Provider>
	);
	return {
		...view,
		button: await screen.findByRole( 'button', { name: 'Copy link to Language' } ),
	};
}

describe( 'setting link labels', () => {
	it( 'copies the stable link and keeps the label accessible', async () => {
		const { button, connector } = await renderLabel();
		fireEvent.click( button );
		expect( await screen.findByText( 'Copied' ) ).toBeInTheDocument();
		expect( connector.copyText ).toHaveBeenCalledWith( 'wp-studio://app/v1/settings?id=language' );
		expect( screen.getByRole( 'textbox', { name: 'Language' } ) ).toBeInTheDocument();
	} );

	it( 'leaves site labels and dynamic labels without link buttons', async () => {
		renderWithProviders(
			<>
				<SettingsRow title="Language" />
				<SettingsLinkContext.Provider value>
					<SettingsRow title="My private site" />
				</SettingsLinkContext.Provider>
			</>
		);
		await screen.findByText( 'My private site' );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );

	it( 'resolves stable IDs to their owning section and falls back for unknown IDs', () => {
		expect( resolveSettingsLink( 'language' ) ).toBe( 'general' );
		expect( resolveSettingsLink( 'theme' ) ).toBe( 'appearance' );
		expect( resolveSettingsLink( 'future-setting' ) ).toBe( 'general' );
	} );

	it( 'uses stable IDs for revealing controls', async () => {
		const { connector } = renderApp( {
			connector: createFakeConnector( { sites: [ makeSite( { id: 'one' } ) ] } ),
			path: '/sites/one',
		} );
		await screen.findByRole( 'group', { name: 'Sites' } );
		act( () => connector.emit( 'onOpenSettings', { settingId: 'language' } ) );
		const field = await waitFor( () => {
			const row = document.querySelector( '[data-setting-id="language"]' );
			expect( row ).toHaveAttribute( 'data-settings-match' );
			return row!;
		} );
		const control = screen.getByRole( 'combobox', { name: 'Language' } );
		await waitFor( () => expect( field ).not.toHaveAttribute( 'data-settings-match' ), {
			timeout: 4000,
		} );
		expect( control ).toHaveFocus();
	} );
} );
