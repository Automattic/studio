import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import { selectHeaderPrototype } from './index';

beforeEach( () => {
	localStorage.clear();
	act( () => selectHeaderPrototype( 'start-close' ) );
} );
afterEach( () => act( () => selectHeaderPrototype( 'current' ) ) );

it.each( [ 'header', 'composer', 'thumbnail' ] )(
	'starts from the %s, changes layout, and stops from the preview while preserving delivery actions',
	async ( control ) => {
		const connector = createFakeConnector(
			{ sites: [ makeSite( { id: 'one', running: false } ) ] },
			{ getSiteThumbnail: async () => 'data:image/png;base64,eA==' }
		);
		renderApp( { connector, path: '/sites/one/new' } );
		const header = (
			await screen.findByRole( 'button', { name: 'Publish…' } )
		).closest< HTMLElement >( '[data-site-header-actions]' )!;
		const start = within( header ).getByRole( 'button', { name: 'Start site' } );
		const publish = screen.getByRole( 'button', { name: 'Publish…' } );
		const share = screen.getByRole( 'button', { name: 'Share' } );
		const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
		const composerStart = within( input.closest( '[role="group"]' )! ).getByRole( 'button', {
			name: 'Start site',
		} );
		const thumbnailStart = await screen.findByRole( 'button', { name: 'Start from preview' } );
		fireEvent.click(
			control === 'header' ? start : control === 'composer' ? composerStart : thumbnailStart
		);
		const close = await screen.findByRole( 'button', { name: 'Stop site and close preview' } );
		expect( header ).toContainElement( start );
		expect( header ).toContainElement( close );
		const toolbar = screen.getByRole( 'toolbar', { name: 'Preview browser controls' } );
		expect(
			within( toolbar ).queryByRole( 'button', { name: 'Enter fullscreen' } )
		).not.toBeInTheDocument();
		expect(
			within( toolbar ).queryByRole( 'button', { name: 'Stop site and close preview' } )
		).not.toBeInTheDocument();
		await waitFor( () => expect( close ).toBeEnabled() );
		expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' );
		expect( screen.getByRole( 'button', { name: 'Stop site' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Enter fullscreen' } ) );
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
		await waitFor( () =>
			expect(
				screen.queryByRole( 'combobox', { name: 'Message WordPress Studio' } )
			).not.toBeInTheDocument()
		);
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBe( share );
		fireEvent.click( close );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		await within( header ).findByRole( 'button', { name: 'Start site' } );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'complementary', { name: 'Site preview' } )
			).not.toBeInTheDocument()
		);
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
	}
);

it( 'switches between the current and proposed header without restarting the site', async () => {
	const connector = createFakeConnector( { sites: [ makeSite( { id: 'one', running: true } ) ] } );
	renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'Enter fullscreen' } );
	const publish = screen.getByRole( 'button', { name: 'Publish…' } );
	act( () => selectHeaderPrototype( 'current' ) );
	const toolbar = await screen.findByRole( 'toolbar', { name: 'Preview browser controls' } );
	expect( within( toolbar ).getByRole( 'button', { name: 'Enter fullscreen' } ) ).toBeVisible();
	expect(
		screen.queryByRole( 'button', { name: 'Stop site and close preview' } )
	).not.toBeInTheDocument();
	act( () => selectHeaderPrototype( 'start-close' ) );
	await screen.findByRole( 'button', { name: 'Stop site and close preview' } );
	expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
	expect( connector.startSite ).not.toHaveBeenCalled();
	expect( connector.stopSite ).not.toHaveBeenCalled();
} );

it.each( [ 'split', 'full' ] )(
	'closes the %s preview and its controls before the site finishes stopping, without stop loaders',
	async ( layout ) => {
		localStorage.setItem(
			'studio-ui-running-preview-layout',
			JSON.stringify( { open: true, chatHidden: layout === 'full' } )
		);
		const site = makeSite( { id: 'one', running: true } );
		const connector = createFakeConnector( { sites: [ site ] } );
		let finishStop!: () => void;
		connector.stopSite.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finishStop = resolve;
				} )
		);
		renderApp( { connector, path: '/sites/one/new' } );
		const close = await screen.findByRole( 'button', { name: 'Stop site and close preview' } );
		const header = close.closest< HTMLElement >( '[data-site-header-actions]' )!;
		fireEvent.click( close );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		const play = within( header ).getByRole( 'button', { name: 'Start site' } );
		expect( play ).not.toHaveAttribute( 'aria-busy', 'true' );
		expect( close ).not.toHaveAttribute( 'aria-busy', 'true' );
		expect(
			within( header ).queryByRole( 'button', { name: 'Enter fullscreen' } )
		).not.toBeInTheDocument();
		expect(
			within( header ).queryByRole( 'button', { name: 'Exit fullscreen' } )
		).not.toBeInTheDocument();
		await waitFor( () =>
			expect(
				screen.queryByRole( 'complementary', { name: 'Site preview' } )
			).not.toBeInTheDocument()
		);
		expect( connector.state.sites[ 0 ].running ).toBe( true );
		const composer = screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
		expect( composer ).toBeVisible();
		expect( composer ).toHaveAttribute( 'placeholder', `Work with ${ site.name }` );
		connector.state.sites = [ { ...site, running: false } ];
		await act( async () => finishStop() );
		expect(
			screen.queryByRole( 'complementary', { name: 'Site preview' } )
		).not.toBeInTheDocument();
	}
);
