import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

const mac = () => /Mac|iPhone|iPad/.test( navigator.platform );
const primary = () => ( { metaKey: mac(), ctrlKey: ! mac() } );

async function renderDialog( section = 'general' ) {
	const view = renderApp( {
		connector: createFakeConnector( { sites: [ makeSite( { id: 'one', name: 'Example' } ) ] } ),
		path: `/sites/one?settings=${ section }`,
	} );
	const site = await screen.findByRole( 'tab', { name: 'Site' } );
	await waitFor( () => expect( site ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
	return view;
}

describe( 'Shared settings dialog', () => {
	it( 'keeps one modal and the same frame while switching scopes and traversing history', async () => {
		await renderDialog();
		const dialog = screen.getByRole( 'dialog', { name: 'Settings' } );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Site' } ) );
		expect( await screen.findByRole( 'heading', { name: 'Settings' } ) ).toBeVisible();
		expect( screen.getAllByRole( 'dialog', { name: 'Settings' } ) ).toEqual( [ dialog ] );
		fireEvent.click( screen.getByRole( 'button', { name: 'Back in settings' } ) );
		expect( await screen.findByRole( 'heading', { name: 'General' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Forward in settings' } )
		).not.toBeInTheDocument();
		fireEvent.keyDown( dialog, { key: ']', ...primary() } );
		expect( await screen.findByRole( 'heading', { name: 'Settings' } ) ).toBeVisible();
		expect( screen.getAllByRole( 'dialog', { name: 'Settings' } ) ).toEqual( [ dialog ] );
	} );

	it( 'opens the command palette through the Settings guard when clean', async () => {
		await renderDialog();
		const dialog = screen.getByRole( 'dialog', { name: 'Settings' } );
		fireEvent.keyDown( within( dialog ).getByRole( 'textbox', { name: 'Search settings' } ), {
			key: 'k',
			code: 'KeyK',
			...primary(),
		} );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument()
		);
		expect( await screen.findByRole( 'dialog', { name: 'Command palette' } ) ).toBeVisible();
	} );
} );
