import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

beforeEach( () => localStorage.clear() );

async function chooseLayout( name: 'Chat' | 'Split view' | 'Browser' ) {
	const toggle = await screen.findByRole( 'button', { name: /^(Show|Hide) preview$/ } );
	const layout = toggle.getAttribute( 'data-preview-layout' );
	if ( name === 'Chat' ) {
		if ( layout !== 'chat' ) fireEvent.click( toggle );
		return;
	}
	if ( layout === 'chat' ) fireEvent.click( toggle );
	if ( name === 'Split view' && toggle.getAttribute( 'data-preview-layout' ) === 'split' ) return;
	const full = name === 'Browser';
	const button = screen.getByRole( 'button', { name: /^(Enter|Exit) full view$/ } );
	if ( button.getAttribute( 'aria-label' ) === ( full ? 'Enter full view' : 'Exit full view' ) )
		fireEvent.click( button );
}

it.each( [ true, false ] )(
	'toggles preview and full view without changing site lifecycle (running: %s)',
	async ( running ) => {
		const connector = createFakeConnector(
			{ sites: [ makeSite( { id: 'one', running } ) ] },
			{ getSiteThumbnail: async () => 'data:image/png;base64,eA==' }
		);
		renderApp( { connector, path: '/sites/one/new' } );
		const trigger = await screen.findByRole( 'button', { name: /^(Show|Hide) preview$/ } );
		for ( const [ label, value ] of [
			[ 'Chat', 'chat' ],
			[ 'Split view', 'split' ],
			[ 'Browser', 'preview' ],
		] as const ) {
			if ( ! running && label === 'Browser' ) continue;
			await chooseLayout( label );
			await waitFor( () =>
				expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument()
			);
			expect( trigger ).toHaveAttribute( 'data-preview-layout', value );
			expect( trigger ).toHaveAttribute( 'aria-pressed', String( value !== 'chat' ) );
			await waitFor( () =>
				expect( !! screen.queryByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBe(
					value !== 'preview'
				)
			);
			expect( !! screen.queryByRole( 'complementary', { name: 'Site preview' } ) ).toBe(
				value !== 'chat'
			);
			expect( !! screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } ) ).toBe(
				value !== 'chat' && running
			);
			if ( ! running )
				expect( screen.getAllByRole( 'button', { name: 'Start from preview' } ) ).toHaveLength( 1 );
		}
		expect( connector.startSite ).not.toHaveBeenCalled();
		expect( connector.stopSite ).not.toHaveBeenCalled();
	}
);

it.each( [ 'Split view', 'Browser' ] as const )(
	'uses the %s startup setting and preserves it on stop',
	async ( layout ) => {
		const connector = createFakeConnector(
			{
				sites: [ makeSite( { id: 'one', running: false } ) ],
				preferences: { openChatOnSiteStart: layout === 'Split view' },
			},
			{ getSiteThumbnail: async () => 'data:image/png;base64,eA==' }
		);
		renderApp( { connector, path: '/sites/one/new' } );
		act( () => connector.emit( 'onSetPreviewLayout', layout === 'Browser' ? 'split' : 'preview' ) );
		await chooseLayout( 'Chat' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: /^(Show|Hide) preview$/ } ) ).toHaveAttribute(
				'data-preview-layout',
				layout === 'Browser' ? 'preview' : 'split'
			)
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Stop My site' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: /^(Show|Hide) preview$/ } ) ).toHaveAttribute(
				'data-preview-layout',
				layout === 'Browser' ? 'preview' : 'split'
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
		expect( screen.getByRole( 'button', { name: /^(Show|Hide) preview$/ } ) ).toHaveAttribute(
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
		expect( screen.getByRole( 'button', { name: /^(Show|Hide) preview$/ } ) ).toHaveAttribute(
			'data-preview-layout',
			'chat'
		)
	);
} );

it( 'switches between project chat and browser tabs without leaving full view', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', name: 'First', running: true } ) ],
	} );
	const { user } = renderApp( { connector, path: '/sites/one/new' } );
	const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
	fireEvent.change( input, { target: { value: 'Keep this draft' } } );
	await chooseLayout( 'Browser' );
	const browserTab = screen.getByRole( 'tab', { name: 'First' } );
	await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
	const page = document.querySelector( 'iframe' );

	await user.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
	expect( await screen.findByRole( 'menuitem', { name: 'Settings' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toHaveAttribute(
		'data-preview-layout',
		'preview'
	);
	await user.click( screen.getByRole( 'button', { name: 'Show chat for First' } ) );
	await waitFor( () =>
		expect( screen.queryByRole( 'menuitem', { name: 'Settings' } ) ).not.toBeInTheDocument()
	);

	expect( await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toHaveValue(
		'Keep this draft'
	);
	expect( screen.getByRole( 'button', { name: 'Show preview' } ) ).toHaveAttribute(
		'data-preview-layout',
		'chat'
	);
	expect( screen.getByRole( 'button', { name: 'Show chat for First' } ) ).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect( screen.getByRole( 'button', { name: 'Exit full view' } ) ).toBeVisible();
	expect( browserTab ).toBeVisible();
	expect( browserTab ).toHaveAttribute( 'aria-selected', 'false' );
	expect( document.querySelector( 'iframe' ) ).toBe( page );
	await user.click( browserTab );
	expect( browserTab ).toHaveAttribute( 'aria-selected', 'true' );
	expect( screen.getByRole( 'button', { name: 'Show chat for First' } ) ).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	expect(
		screen.queryByRole( 'combobox', { name: 'Message WordPress Studio' } )
	).not.toBeInTheDocument();
	expect( screen.getByRole( 'complementary', { name: 'Site preview' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Exit full view' } ) ).toBeVisible();
	expect( document.querySelector( 'iframe' ) ).toBe( page );
	expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toBeVisible();
	expect( connector.startSite ).not.toHaveBeenCalled();
	expect( connector.stopSite ).not.toHaveBeenCalled();
} );

it( 'keeps automatic chat reveals animated after a manual layout choice', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', running: true } ) ],
	} );
	renderApp( { connector, path: '/sites/one/new' } );
	await chooseLayout( 'Browser' );
	await waitFor( () =>
		expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument()
	);
	fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
	expect( document.querySelector( '[data-layout-moving]' ) ).toBeInTheDocument();
} );

it( 'switches full view immediately in both directions', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', running: true } ) ],
	} );
	renderApp( { connector, path: '/sites/one/new' } );
	const enter = await screen.findByRole( 'button', { name: 'Enter full view' } );
	fireEvent.click( enter );
	expect( screen.getByRole( 'button', { name: 'Exit full view' } ) ).toBeVisible();
	expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Exit full view' } ) );
	expect( screen.getByRole( 'button', { name: 'Enter full view' } ) ).toBeVisible();
	expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBeVisible();
} );

it( 'opens the project chat from a standalone Browser page without leaving full view', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', name: 'First', running: true } ) ],
	} );
	const { user, history } = renderApp( { connector, path: '/sites/one' } );
	await user.click( await screen.findByRole( 'button', { name: 'Show chat for First' } ) );
	expect(
		await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } )
	).toBeVisible();
	expect( history.location.pathname ).toBe( '/sites/one/new' );
	expect( screen.getByRole( 'button', { name: 'Exit full view' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Show chat for First' } ) ).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect( screen.getByRole( 'tab', { name: 'First' } ) ).toBeVisible();
	expect( connector.startSite ).not.toHaveBeenCalled();
	expect( connector.stopSite ).not.toHaveBeenCalled();
} );

it( 'keeps the layout unchanged when stopping after a manual layout choice', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', running: true } ) ],
	} );
	renderApp( { connector, path: '/sites/one/new' } );
	await chooseLayout( 'Chat' );
	await chooseLayout( 'Split view' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Stop My site' } ) );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Start My site' } ) ).toBeVisible()
	);
} );

it.each( [ true, false ] )(
	'selects layouts from desktop shortcuts without changing site lifecycle (running: %s)',
	async ( running ) => {
		const connector = createFakeConnector( { sites: [ makeSite( { id: 'one', running } ) ] } );
		renderApp( { connector, path: '/sites/one/new' } );
		const trigger = await screen.findByRole( 'button', { name: /^(Show|Hide) preview$/ } );
		for ( const layout of [ 'preview', 'split', 'chat' ] as const ) {
			act( () => connector.emit( 'onSetPreviewLayout', layout ) );
			expect( trigger ).toHaveAttribute( 'data-preview-layout', layout );
			await waitFor( () =>
				expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument()
			);
		}
		expect( connector.startSite ).not.toHaveBeenCalled();
		expect( connector.stopSite ).not.toHaveBeenCalled();
	}
);

it.each( [
	{ running: false, thumbnail: false, expected: false },
	{ running: false, thumbnail: true, expected: false },
	{ running: true, thumbnail: false, expected: true },
] )(
	'shows full view for a browser preview rather than a saved thumbnail ($running, $thumbnail)',
	async ( { running, thumbnail, expected } ) => {
		const connector = createFakeConnector(
			{ sites: [ makeSite( { id: 'one', running } ) ] },
			{ getSiteThumbnail: async () => ( thumbnail ? 'data:image/png;base64,eA==' : null ) }
		);
		renderApp( { connector, path: '/sites/one/new' } );
		const toggle = await screen.findByRole( 'button', { name: /^(Show|Hide) preview$/ } );
		if ( toggle.getAttribute( 'aria-label' ) === 'Show preview' ) fireEvent.click( toggle );
		await screen.findByRole( 'complementary', { name: 'Site preview' } );
		if ( ! running ) await waitFor( () => expect( connector.getSiteThumbnail ).toHaveBeenCalled() );
		await waitFor( () =>
			expect( !! screen.queryByRole( 'button', { name: 'Enter full view' } ) ).toBe( expected )
		);
		expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toBeVisible();
	}
);
