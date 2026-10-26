import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

const sites = [
	makeSite( { id: 'one', name: 'My site' } ),
	makeSite( { id: 'two', name: 'Other site' } ),
];

async function setup() {
	localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
	const view = renderApp( { connector: createFakeConnector( { sites } ), path: '/sites/one' } );
	const trigger = await screen.findByRole( 'button', { name: 'Show sidebar' } );
	const open = async () => {
		await view.user.hover( trigger );
		return screen.findByRole( 'dialog', { name: 'Sites' } );
	};
	return { ...view, trigger, open };
}

const switcherClosed = () =>
	waitFor( () =>
		expect( screen.queryByRole( 'dialog', { name: 'Sites' } ) ).not.toBeInTheDocument()
	);

beforeEach( () => localStorage.clear() );

describe( 'collapsed site switcher', () => {
	it( 'lists the sites on hover and closes once one opens', async () => {
		const { connector, open } = await setup();
		const switcher = await open();
		fireEvent.click( await within( switcher ).findByRole( 'button', { name: /^Other site/ } ) );
		await switcherClosed();
		await waitFor( () => expect( connector.createSession ).toHaveBeenCalledWith( 'two' ) );
	} );

	it( 'closes on Escape, and leaves Escape alone while closed', async () => {
		const { trigger, open } = await setup();
		const switcher = await open();
		fireEvent.keyDown( switcher, { key: 'Escape' } );
		await switcherClosed();
		expect( fireEvent.keyDown( trigger, { key: 'Escape' } ) ).toBe( true );
	} );

	it( 'opens the full sidebar from its call to action', async () => {
		const { open } = await setup();
		const switcher = await open();
		fireEvent.click( within( switcher ).getByRole( 'button', { name: /^Open sidebar/ } ) );
		expect(
			await screen.findByRole( 'separator', { name: 'Resize sidebar' } )
		).toBeInTheDocument();
	} );
} );
