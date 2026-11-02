import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

beforeEach( () => localStorage.clear() );

async function chooseLayout( name: 'Chat' | 'Split view' | 'Browser' ) {
	fireEvent.click( await screen.findByRole( 'button', { name: 'Preview layout' } ) );
	fireEvent.click( await screen.findByRole( 'menuitemradio', { name } ) );
}

it.each( [ true, false ] )(
	'offers three layouts without changing site lifecycle (running: %s)',
	async ( running ) => {
		const connector = createFakeConnector(
			{ sites: [ makeSite( { id: 'one', running } ) ] },
			{ getSiteThumbnail: async () => 'data:image/png;base64,eA==' }
		);
		renderApp( { connector, path: '/sites/one/new' } );
		const trigger = await screen.findByRole( 'button', { name: 'Preview layout' } );
		for ( const [ label, value ] of [
			[ 'Chat', 'chat' ],
			[ 'Split view', 'split' ],
			[ 'Browser', 'preview' ],
		] as const ) {
			await chooseLayout( label );
			expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument();
			expect( trigger ).toHaveAttribute( 'data-preview-layout', value );
			expect( trigger ).not.toHaveAttribute( 'aria-pressed' );
			await waitFor( () =>
				expect( !! screen.queryByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBe(
					value !== 'preview'
				)
			);
			expect( !! screen.queryByRole( 'complementary', { name: 'Site preview' } ) ).toBe(
				value !== 'chat'
			);
			expect( !! screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } ) ).toBe(
				running && value !== 'chat'
			);
			if ( ! running )
				expect( screen.getAllByRole( 'button', { name: 'Start from preview' } ) ).toHaveLength( 1 );
			fireEvent.click( trigger );
			expect( await screen.findByRole( 'menuitemradio', { name: label } ) ).toBeChecked();
			fireEvent.keyDown( screen.getByRole( 'menu' ), { key: 'Escape' } );
		}
		expect( connector.startSite ).not.toHaveBeenCalled();
		expect( connector.stopSite ).not.toHaveBeenCalled();
	}
);

it.each( [ 'Split view', 'Browser' ] as const )(
	'uses the %s startup setting and returns to Chat on stop',
	async ( layout ) => {
		const connector = createFakeConnector( {
			sites: [ makeSite( { id: 'one', running: false } ) ],
			preferences: { openChatOnSiteStart: layout === 'Split view' },
		} );
		renderApp( { connector, path: '/sites/one/new' } );
		await chooseLayout( layout === 'Browser' ? 'Split view' : 'Browser' );
		await chooseLayout( 'Chat' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Preview layout' } ) ).toHaveAttribute(
				'data-preview-layout',
				layout === 'Browser' ? 'preview' : 'split'
			)
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Stop My site' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Preview layout' } ) ).toHaveAttribute(
				'data-preview-layout',
				'chat'
			)
		);
	}
);

it( 'remembers each site’s layout and preserves the draft across layout changes', async () => {
	const connector = createFakeConnector( {
		sites: [
			makeSite( { id: 'one', name: 'First', running: true } ),
			makeSite( { id: 'two', name: 'Second', running: true } ),
		],
	} );
	renderApp( { connector, path: '/sites/one/new' } );
	const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
	fireEvent.change( input, { target: { value: 'Keep my draft' } } );
	await chooseLayout( 'Browser' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Second' } ) );
	await chooseLayout( 'Chat' );
	fireEvent.click( screen.getByRole( 'button', { name: 'First' } ) );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Preview layout' } ) ).toHaveAttribute(
			'data-preview-layout',
			'preview'
		)
	);
	await chooseLayout( 'Split view' );
	expect( await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toHaveValue(
		'Keep my draft'
	);
	act( () => connector.emit( 'onToggleSitePreview' ) );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Preview layout' } ) ).toHaveAttribute(
			'data-preview-layout',
			'chat'
		)
	);
} );

it( 'explains the layout control on hover', async () => {
	const { user } = renderApp( {
		connector: createFakeConnector( { sites: [ makeSite( { id: 'one', running: true } ) ] } ),
		path: '/sites/one/new',
	} );
	await user.hover( await screen.findByRole( 'button', { name: 'Preview layout' } ) );
	expect( await screen.findByText( 'Change workspace layout' ) ).toBeVisible();
} );

it( 'keeps automatic chat reveals animated after an immediate layout choice', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', running: true } ) ],
	} );
	renderApp( { connector, path: '/sites/one/new' } );
	await chooseLayout( 'Browser' );
	expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
	expect( document.querySelector( '[data-layout-moving]' ) ).toBeInTheDocument();
} );

it( 'keeps stopping animated after an immediate layout choice', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', running: true } ) ],
	} );
	renderApp( { connector, path: '/sites/one/new' } );
	await chooseLayout( 'Chat' );
	await chooseLayout( 'Split view' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Stop My site' } ) );
	await waitFor( () =>
		expect( document.querySelector( '[data-layout-moving]' ) ).toBeInTheDocument()
	);
} );

it.each( [ true, false ] )(
	'selects layouts from desktop shortcuts without changing site lifecycle (running: %s)',
	async ( running ) => {
		const connector = createFakeConnector( { sites: [ makeSite( { id: 'one', running } ) ] } );
		renderApp( { connector, path: '/sites/one/new' } );
		const trigger = await screen.findByRole( 'button', { name: 'Preview layout' } );
		for ( const layout of [ 'preview', 'split', 'chat' ] as const ) {
			act( () => connector.emit( 'onSetPreviewLayout', layout ) );
			expect( trigger ).toHaveAttribute( 'data-preview-layout', layout );
			expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument();
		}
		expect( connector.startSite ).not.toHaveBeenCalled();
		expect( connector.stopSite ).not.toHaveBeenCalled();
	}
);

it( 'does not advertise desktop shortcuts in browser hosts', async () => {
	const connector = createFakeConnector(
		{ sites: [ makeSite( { id: 'one', running: true } ) ] },
		{ onSetPreviewLayout: undefined }
	);
	renderApp( { connector, path: '/sites/one/new' } );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Preview layout' } ) );
	for ( const name of [ 'Chat', 'Split view', 'Browser' ] ) {
		expect( await screen.findByRole( 'menuitemradio', { name } ) ).not.toHaveAttribute(
			'aria-keyshortcuts'
		);
	}
} );
