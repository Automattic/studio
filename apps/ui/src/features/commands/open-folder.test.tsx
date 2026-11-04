import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

const folder = {
	name: 'Existing WordPress',
	path: '/projects/existing',
	isEmpty: false,
	isWordPress: true,
};

async function setup() {
	const connector = createFakeConnector( { sites: [ makeSite( { id: 'one' } ) ] } );
	const view = renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'My site' } );
	return { ...view, connector };
}

describe( 'Open Folder', () => {
	it( 'loads a Blueprint bundle into the upload setup with its relative assets intact', async () => {
		const { connector } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( {
			...folder,
			name: 'formwork.zip',
			path: '/downloads/formwork.zip',
			isWordPress: false,
			blueprint: {
				blueprintJson: { meta: { title: 'Fashion Magazine', author: 'Automattic' } },
				blueprintJsonPath: '/tmp/bundle/formwork/blueprint.json',
				tempDir: '/tmp/bundle',
			},
		} );
		act( () => connector.emit( 'onOpenFolder' ) );
		const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
		await within( dialog ).findByRole( 'heading', { name: 'Fashion Magazine' } );
		expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( 'Fashion Magazine' );
		expect(
			within( dialog ).queryByText( 'Existing local WordPress site' )
		).not.toBeInTheDocument();
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Create site from Blueprint' } )
		);
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalled() );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ].blueprint ).toMatchObject( {
			filePath: '/tmp/bundle/formwork/blueprint.json',
			blueprint: { meta: { title: 'Fashion Magazine' } },
		} );
	} );

	it( 'prepares an existing WordPress folder using the normal site setup', async () => {
		const { connector } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( folder );
		act( () => connector.emit( 'onOpenFolder' ) );
		const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
		await within( dialog ).findByText( 'Existing local WordPress site' );
		expect( within( dialog ).getByLabelText( 'Site name' ) ).toHaveValue( folder.name );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Advanced settings' } ) );
		expect( within( dialog ).getByLabelText( 'Local path' ) ).toHaveValue( folder.path );
		expect( connector.createSite ).not.toHaveBeenCalled();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Create site' } ) );
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalled() );
		expect( connector.createSite.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			name: folder.name,
			path: folder.path,
		} );
	} );

	it.each( [ true, false ] )(
		'opens a registered site instead of adding it again (running: %s)',
		async ( running ) => {
			const { connector, history } = await setup();
			connector.state.sites.push( makeSite( { id: 'two', path: folder.path, running } ) );
			connector.selectSiteFolder.mockResolvedValueOnce( folder );
			act( () => connector.emit( 'onOpenFolder' ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
			expect( connector.createSite ).not.toHaveBeenCalled();
			expect( connector.startSite ).toHaveBeenCalledTimes( running ? 0 : 1 );
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
		}
	);

	it( 'rejects a nonempty folder without WordPress', async () => {
		const { connector } = await setup();
		connector.selectSiteFolder.mockResolvedValueOnce( { ...folder, isWordPress: false } );
		act( () => connector.emit( 'onOpenFolder' ) );
		await screen.findByText( 'Choose an empty folder or an existing WordPress site.' );
		expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );
} );
