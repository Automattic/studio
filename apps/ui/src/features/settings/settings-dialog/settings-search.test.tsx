import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

async function renderSearch( section = 'keyboard' ) {
	const view = renderApp( {
		connector: createFakeConnector( { sites: [ makeSite( { id: 'one' } ) ] } ),
		path: `/sites/one?settings=${ section }`,
	} );
	const site = await screen.findByRole( 'tab', { name: 'Site' } );
	await waitFor( () => expect( site ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
	const input = screen.getByRole( 'textbox', { name: 'Search settings' } );
	const matches = () =>
		within( screen.getByRole( 'tablist', { name: 'Matching settings' } ) ).getAllByRole( 'tab' );
	const section_ = () => new URLSearchParams( view.history.location.search ).get( 'settings' );
	return { ...view, input, matches, section: section_ };
}

const row = ( id: string ) => document.querySelector( `[data-setting-id="${ id }"]` );

describe( 'Settings search', () => {
	it.each( [ 'click', 'Enter' ] )(
		'keeps the query and matches after selecting by %s',
		async ( method ) => {
			const { input, matches, section } = await renderSearch();
			fireEvent.change( input, { target: { value: 'reset' } } );
			const found = matches();
			if ( method === 'click' ) {
				fireEvent.click( found[ 0 ] );
			} else {
				fireEvent.keyDown( input, { key: 'Enter' } );
			}
			await waitFor( () => expect( section() ).toBe( 'general' ) );
			await waitFor( () =>
				expect( row( 'reset-interface' ) ).toHaveAttribute( 'data-settings-match' )
			);
			expect( input ).toHaveValue( 'reset' );
			expect( matches().map( ( tab ) => tab.textContent ) ).toEqual(
				found.map( ( tab ) => tab.textContent )
			);
			fireEvent.click( screen.getByRole( 'tab', { name: 'Reset appearance' } ) );
			await waitFor( () => expect( section() ).toBe( 'appearance' ) );
			expect( input ).toHaveValue( 'reset' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Clear search' } ) );
			expect( input ).toHaveValue( '' );
			expect( screen.getByRole( 'tab', { name: 'General' } ) ).toBeVisible();
		}
	);

	it( 'temporarily highlights the whole field and restarts when selecting it again', async () => {
		const { input, unmount } = await renderSearch();
		fireEvent.change( input, { target: { value: 'theme' } } );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Interface theme' } ) );
		await waitFor( () => expect( row( 'theme' ) ).toHaveAttribute( 'data-settings-match' ) );
		const field = row( 'theme' )!;
		const control = within( field as HTMLElement ).getByRole( 'combobox', {
			name: 'Interface theme',
		} );
		expect( within( field as HTMLElement ).getByText( 'Interface theme' ) ).not.toHaveAttribute(
			'data-settings-match'
		);
		await waitFor( () => expect( field ).not.toHaveAttribute( 'data-settings-match' ), {
			timeout: 4000,
		} );
		expect( control ).toHaveFocus();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Interface theme' } ) );
		await waitFor( () => expect( field ).toHaveAttribute( 'data-settings-match' ) );
		unmount();
		expect( field ).not.toHaveAttribute( 'data-settings-match' );
	} );

	it.each( [
		[ 'keyboard', 'wapuu' ],
		[ 'keyboard', 'WordPress.com account' ],
		[ 'keyboard', 'Log out' ],
		[ 'php', 'WordPress credentials' ],
	] )( 'excludes the %s section or group title %s', async ( start, query ) => {
		const { input, section } = await renderSearch( start );
		fireEvent.change( input, { target: { value: query } } );
		expect(
			screen.queryByRole( 'tablist', { name: 'Matching settings' } )
		).not.toBeInTheDocument();
		expect( screen.getByText( 'No settings found.' ) ).toHaveAttribute( 'role', 'status' );
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( section() ).toBe( start );
	} );

	it( 'returns reset controls without the Reset group title', async () => {
		const { input, matches } = await renderSearch();
		fireEvent.change( input, { target: { value: 'reset' } } );
		expect( matches().map( ( tab ) => tab.getAttribute( 'aria-label' ) ) ).toEqual( [
			'Reset interface',
			'Reset appearance',
		] );
	} );

	it( 'finds the CLI toggle instead of its fieldset title', async () => {
		const { input, section } = await renderSearch();
		fireEvent.change( input, { target: { value: 'CLI' } } );
		expect( screen.queryByRole( 'tab', { name: 'WordPress Studio CLI' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'WordPress Studio CLI for terminal' } ) );
		await waitFor( () => expect( section() ).toBe( 'general' ) );
	} );

	it( 'finds the custom domain toggle instead of its heading', async () => {
		const { input, section } = await renderSearch( 'php' );
		fireEvent.change( input, { target: { value: 'local domain' } } );
		expect( screen.queryByRole( 'tab', { name: /^Local domain/ } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Use custom domain' } ) );
		await waitFor( () => expect( section() ).toBe( 'site' ) );
	} );

	it( 'finds individual credential controls', async () => {
		const { input, section } = await renderSearch( 'php' );
		for ( const label of [ 'Username', 'Password', 'Email' ] ) {
			fireEvent.change( input, { target: { value: label } } );
			fireEvent.click( screen.getByRole( 'tab', { name: label } ) );
			await waitFor( () => expect( section() ).toBe( 'site' ) );
		}
	} );

	it( 'finds controls by description and combines label and description words', async () => {
		const { input, section } = await renderSearch();
		fireEvent.change( input, { target: { value: 'coding standards' } } );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Agent instructions' } ) );
		await waitFor( () => expect( section() ).toBe( 'instructions' ) );
		fireEvent.change( input, { target: { value: 'directory creates' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		await waitFor( () => expect( section() ).toBe( 'general' ) );
		await waitFor( () =>
			expect( row( 'default-directory' ) ).toHaveAttribute( 'data-settings-match' )
		);
	} );

	it( 'ranks label matches ahead of description matches', async () => {
		const { input, matches, section } = await renderSearch();
		fireEvent.change( input, { target: { value: 'contrast' } } );
		expect( matches().map( ( tab ) => tab.textContent ) ).toEqual( [
			'ContrastApp',
			'Reset appearanceApp',
		] );
		fireEvent.keyDown( input, { key: 'Enter' } );
		await waitFor( () => expect( section() ).toBe( 'appearance' ) );
		await waitFor( () => expect( row( 'contrast' ) ).toHaveAttribute( 'data-settings-match' ) );
	} );

	it( 'finds reset appearance within its section and opens that section', async () => {
		const { input, section } = await renderSearch();
		fireEvent.change( input, { target: { value: 'appearance' } } );
		expect( screen.queryByRole( 'tab', { name: /^Usage/ } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Reset appearance' } ) );
		await waitFor( () => expect( section() ).toBe( 'appearance' ) );
	} );

	it( 'searches site settings and supports Enter and Escape', async () => {
		const { input, section } = await renderSearch( 'site' );
		fireEvent.change( input, { target: { value: 'PHP version' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		await waitFor( () => expect( section() ).toBe( 'php' ) );
		fireEvent.change( input, { target: { value: 'no-match' } } );
		expect( screen.getByText( 'No settings found.' ) ).toHaveAttribute( 'role', 'status' );
		fireEvent.keyDown( input, { key: 'Escape' } );
		expect( input ).toHaveValue( '' );
		expect( screen.getByRole( 'tab', { name: 'PHP' } ) ).toBeVisible();
	} );
} );
