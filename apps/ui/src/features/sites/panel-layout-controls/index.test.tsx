import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

beforeEach( () => localStorage.clear() );

async function chooseLayout( name: 'Chat' | 'Split view' | 'Panel' ) {
	const toggle = await screen.findByRole( 'button', { name: /^(Show|Hide) panel$/ } );
	const layout = toggle.getAttribute( 'data-workspace-layout' );
	if ( name === 'Chat' ) {
		if ( layout !== 'chat' ) fireEvent.click( toggle );
		return;
	}
	if ( layout === 'chat' ) fireEvent.click( toggle );
	if ( name === 'Split view' && toggle.getAttribute( 'data-workspace-layout' ) === 'split' ) return;
	const full = name === 'Panel';
	const button = screen.getByRole( 'button', { name: /^(Expand panel|Show chat)$/ } );
	if ( button.getAttribute( 'aria-label' ) === ( full ? 'Expand panel' : 'Show chat' ) )
		fireEvent.click( button );
}

it.each( [ true, false ] )(
	'toggles panel and full view without changing site lifecycle (running: %s)',
	async ( running ) => {
		const connector = createFakeConnector(
			{ sites: [ makeSite( { id: 'one', running } ) ] },
			{ getSiteThumbnail: async () => 'data:image/png;base64,eA==' }
		);
		renderApp( { connector, path: '/sites/one/new' } );
		const trigger = await screen.findByRole( 'button', { name: /^(Show|Hide) panel$/ } );
		for ( const [ label, value ] of [
			[ 'Chat', 'chat' ],
			[ 'Split view', 'split' ],
			[ 'Panel', 'panel' ],
		] as const ) {
			await chooseLayout( label );
			await waitFor( () =>
				expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument()
			);
			expect( trigger ).toHaveAttribute( 'data-workspace-layout', value );
			expect( trigger ).toHaveAttribute( 'aria-pressed', String( value !== 'chat' ) );
			await waitFor( () =>
				expect( !! screen.queryByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBe(
					value !== 'panel'
				)
			);
			expect( !! screen.queryByRole( 'complementary', { name: 'Panel' } ) ).toBe(
				value !== 'chat'
			);
			expect( !! screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } ) ).toBe(
				value !== 'chat' && running
			);
			if ( ! running && value !== 'panel' )
				expect(
					await screen.findAllByRole( 'button', { name: 'Start from preview' } )
				).toHaveLength( 1 );
		}
		await chooseLayout( 'Split view' );
		expect( trigger ).toHaveAttribute( 'data-workspace-layout', 'split' );
		expect( connector.startSite ).not.toHaveBeenCalled();
		expect( connector.stopSite ).not.toHaveBeenCalled();
	}
);

it.each( [ 'Split view', 'Panel' ] as const )(
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
		act( () => connector.emit( 'onSetWorkspaceLayout', layout === 'Panel' ? 'split' : 'panel' ) );
		await chooseLayout( 'Chat' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: /^(Show|Hide) panel$/ } ) ).toHaveAttribute(
				'data-workspace-layout',
				layout === 'Panel' ? 'panel' : 'split'
			)
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Stop My site' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: /^(Show|Hide) panel$/ } ) ).toHaveAttribute(
				'data-workspace-layout',
				layout === 'Panel' ? 'panel' : 'split'
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
	await chooseLayout( 'Panel' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Second' } ) );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toHaveTextContent( 'Second' )
	);
	await chooseLayout( 'Chat' );
	fireEvent.click( screen.getByRole( 'button', { name: 'First' } ) );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: /^(Show|Hide) panel$/ } ) ).toHaveAttribute(
			'data-workspace-layout',
			'panel'
		)
	);
	await chooseLayout( 'Split view' );
	expect( await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toHaveValue(
		'Keep my draft'
	);
	act( () => connector.emit( 'onTogglePanel' ) );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: /^(Show|Hide) panel$/ } ) ).toHaveAttribute(
			'data-workspace-layout',
			'chat'
		)
	);
} );

it( 'returns to chat using the panel and full-view controls while preserving the page and draft', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', name: 'First', running: true } ) ],
	} );
	const { user } = renderApp( { connector, path: '/sites/one/new' } );
	const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
	fireEvent.change( input, { target: { value: 'Keep this draft' } } );
	await chooseLayout( 'Panel' );
	await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
	const page = document.querySelector( 'iframe' );
	expect( screen.queryByRole( 'tab', { name: 'Chat' } ) ).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
	expect( await screen.findByRole( 'menuitem', { name: 'Settings' } ) ).toBeVisible();
	await user.keyboard( '{Escape}' );
	await user.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
	expect( await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toHaveValue(
		'Keep this draft'
	);
	expect( screen.getByRole( 'button', { name: 'Show panel' } ) ).toHaveAttribute(
		'data-workspace-layout',
		'chat'
	);
	expect( screen.queryByRole( 'button', { name: 'Show chat' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'tab', { name: 'First' } ) ).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
	await user.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
	expect( screen.getByRole( 'button', { name: 'Show chat' } ) ).toBeVisible();
	expect( screen.getByRole( 'tab', { name: 'First' } ) ).toHaveAttribute( 'aria-selected', 'true' );
	await user.click( screen.getByRole( 'button', { name: 'Show chat' } ) );
	expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toHaveValue(
		'Keep this draft'
	);
	expect( screen.getByRole( 'complementary', { name: 'Panel' } ) ).toBeVisible();
	expect( document.querySelector( 'iframe' ) ).toBe( page );
	expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toHaveTextContent( 'First' );
	expect( connector.startSite ).not.toHaveBeenCalled();
	expect( connector.stopSite ).not.toHaveBeenCalled();
} );

it( 'switches full view immediately in both directions', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', running: true } ) ],
	} );
	renderApp( { connector, path: '/sites/one/new' } );
	const enter = await screen.findByRole( 'button', { name: 'Expand panel' } );
	fireEvent.click( enter );
	expect( screen.getByRole( 'button', { name: 'Show chat' } ) ).toBeVisible();
	expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Show chat' } ) );
	expect( screen.getByRole( 'button', { name: 'Expand panel' } ) ).toBeVisible();
	expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBeVisible();
} );

it( 'keeps the full-view and share controls mounted through panel toggles', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', running: true } ) ],
	} );
	const { user } = renderApp( { connector, path: '/sites/one/new' } );
	const fullView = await screen.findByRole( 'button', { name: 'Expand panel' } );
	const share = screen.getByRole( 'button', { name: 'Share…' } );

	await user.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
	expect( fullView ).toBeInTheDocument();
	expect( fullView.closest( '[inert]' ) ).not.toBeNull();
	expect( screen.queryByRole( 'button', { name: 'Expand panel' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Share…' } ) ).toBe( share );

	await user.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
	expect( screen.getByRole( 'button', { name: 'Expand panel' } ) ).toBe( fullView );
	expect( fullView.closest( '[inert]' ) ).toBeNull();
	expect( screen.getByRole( 'button', { name: 'Share…' } ) ).toBe( share );
} );

it( 'opens chat from a standalone Browser page by hiding the panel', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', name: 'First', running: true } ) ],
	} );
	const { user, history } = renderApp( { connector, path: '/sites/one' } );
	await user.click( await screen.findByRole( 'button', { name: 'Hide panel' } ) );
	expect(
		await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } )
	).toBeVisible();
	expect( history.location.pathname ).toBe( '/sites/one/new' );
	expect( screen.queryByRole( 'button', { name: 'Show chat' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Show panel' } ) ).toBeVisible();
	expect( screen.queryByRole( 'tab', { name: 'Chat' } ) ).not.toBeInTheDocument();
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
		const trigger = await screen.findByRole( 'button', { name: /^(Show|Hide) panel$/ } );
		for ( const layout of [ 'panel', 'split', 'chat' ] as const ) {
			act( () => connector.emit( 'onSetWorkspaceLayout', layout ) );
			expect( trigger ).toHaveAttribute( 'data-workspace-layout', layout );
			await waitFor( () =>
				expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument()
			);
		}
		expect( connector.startSite ).not.toHaveBeenCalled();
		expect( connector.stopSite ).not.toHaveBeenCalled();
	}
);

it.each( [
	{ running: false, thumbnail: false, expected: true },
	{ running: false, thumbnail: true, expected: true },
	{ running: true, thumbnail: false, expected: true },
] )(
	'shows full view whenever the panel is open ($running, $thumbnail)',
	async ( { running, thumbnail, expected } ) => {
		const connector = createFakeConnector(
			{ sites: [ makeSite( { id: 'one', running } ) ] },
			{ getSiteThumbnail: async () => ( thumbnail ? 'data:image/png;base64,eA==' : null ) }
		);
		renderApp( { connector, path: '/sites/one/new' } );
		const toggle = await screen.findByRole( 'button', { name: /^(Show|Hide) panel$/ } );
		if ( toggle.getAttribute( 'aria-label' ) === 'Show panel' ) fireEvent.click( toggle );
		await screen.findByRole( 'complementary', { name: 'Panel' } );
		if ( ! running ) await waitFor( () => expect( connector.getSiteThumbnail ).toHaveBeenCalled() );
		await waitFor( () =>
			expect( !! screen.queryByRole( 'button', { name: 'Expand panel' } ) ).toBe( expected )
		);
		expect( screen.getByRole( 'button', { name: 'Hide panel' } ) ).toBeVisible();
	}
);
