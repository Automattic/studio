import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
const site = makeSite( { id: 'poetry', name: 'Poetry site' } );
const searchInput = () => screen.getByRole( 'combobox', { name: 'Search commands' } );
const scene = () => screen.getByRole( 'dialog', { name: 'Code is poetry' } );
const dismiss = () => screen.getByRole( 'button', { name: 'Return to Studio' } );

function pressK( target: Document | Element = document ) {
	fireEvent.keyDown( target, { key: 'k', code: 'KeyK', metaKey: isApple, ctrlKey: ! isApple } );
}

async function openPalette() {
	pressK();
	return screen.findByRole( 'combobox', { name: 'Search commands' } );
}

function search( query: string ) {
	fireEvent.change( searchInput(), { target: { value: query } } );
}

async function renderWorkspace( path = '/sites/poetry' ) {
	const view = renderApp( { connector: createFakeConnector( { sites: [ site ] } ), path } );
	await screen.findByRole( 'group', { name: 'Sites' } );
	return view;
}

afterEach( () => {
	act( () => setCommandPaletteOpen( false ) );
} );

describe( 'Code is poetry', () => {
	it.each( [ 'code is poetry', 'CODE IS POETRY', '  Code   is\tPoetry  ' ] )(
		'opens from the complete phrase %j only after Enter, in the same modal',
		async ( query ) => {
			await renderWorkspace();
			await openPalette();
			const palette = screen.getByRole( 'dialog', { name: 'Command palette' } );
			search( query );
			expect( screen.queryByRole( 'dialog', { name: 'Code is poetry' } ) ).not.toBeInTheDocument();
			fireEvent.keyDown( searchInput(), { key: 'Enter' } );
			expect( scene() ).toBe( palette );
			expect( scene() ).toHaveAccessibleDescription(
				'Click anywhere or press Escape to return to Studio.'
			);
			expect( dismiss() ).toHaveFocus();
			expect( within( scene() ).queryByRole( 'combobox' ) ).not.toBeInTheDocument();
			expect( within( scene() ).queryByRole( 'listbox' ) ).not.toBeInTheDocument();
			fireEvent.keyUp( dismiss(), { key: 'Enter' } );
			expect( scene() ).toBeVisible();
		}
	);

	it( 'keeps the phrase out of listings', async () => {
		await renderWorkspace();
		await openPalette();
		expect( screen.queryByRole( 'option', { name: /code is poetry/i } ) ).not.toBeInTheDocument();
		search( 'code is poetry' );
		expect( screen.queryByRole( 'option', { name: /code is poetry/i } ) ).not.toBeInTheDocument();
	} );

	it.each( [ 'code is', 'codeispoetry', 'code is poetry please' ] )(
		'does not activate from %j',
		async ( query ) => {
			await renderWorkspace();
			await openPalette();
			search( query );
			fireEvent.keyDown( searchInput(), { key: 'Enter' } );
			expect( screen.queryByRole( 'dialog', { name: 'Code is poetry' } ) ).not.toBeInTheDocument();
		}
	);

	it( 'ignores composing and repeated activation keys', async () => {
		await renderWorkspace();
		await openPalette();
		search( 'code is poetry' );
		for ( const event of [ { isComposing: true }, { keyCode: 229 }, { repeat: true } ] ) {
			fireEvent.keyDown( searchInput(), { key: 'Enter', ...event } );
			expect( screen.queryByRole( 'dialog', { name: 'Code is poetry' } ) ).not.toBeInTheDocument();
		}
		fireEvent.keyDown( searchInput(), { key: 'Enter' } );
		expect( scene() ).toBeVisible();
	} );

	it.each( [ 'click', 'Escape', 'Enter', 'Space' ] )(
		'dismisses with %s, restores workspace focus and clears the next search',
		async ( action ) => {
			const { user } = await renderWorkspace();
			const previous = screen.getByRole( 'button', { name: 'Add site' } );
			act( () => previous.focus() );
			await openPalette();
			search( 'code is poetry' );
			await user.keyboard( '{Enter}' );
			expect( dismiss() ).toHaveFocus();
			if ( action === 'click' ) {
				await user.click( dismiss() );
			} else {
				await user.keyboard( action === 'Space' ? ' ' : `{${ action }}` );
			}
			await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
			await waitFor( () => expect( previous ).toHaveFocus() );
			expect( await openPalette() ).toHaveValue( '' );
			search( 'code is poetry' );
			fireEvent.keyDown( searchInput(), { key: 'Enter' } );
			expect( scene() ).toBeVisible();
		}
	);

	it( 'works without a selected site', async () => {
		renderApp( { connector: createFakeConnector(), path: '/sites' } );
		fireEvent.keyDown( await screen.findByRole( 'dialog', { name: 'Add site' } ), {
			key: 'Escape',
		} );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await openPalette();
		search( 'code is poetry' );
		fireEvent.keyDown( searchInput(), { key: 'Enter' } );
		expect( scene() ).toBeVisible();
	} );

	it.each( [ 'onAddSite', 'onOpenSettings' ] as const )(
		'contains the native %s shortcut until dismissed',
		async ( event ) => {
			const { connector, history, user } = await renderWorkspace();
			const emit = () =>
				event === 'onAddSite'
					? connector.emit( 'onAddSite' )
					: connector.emit( 'onOpenSettings', {} );
			await openPalette();
			search( 'code is poetry' );
			await user.keyboard( '{Enter}' );
			act( emit );
			expect( scene() ).toBeVisible();
			expect( history.location.search ).toBe( '' );
			await user.keyboard( '{Escape}' );
			await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
			act( emit );
			await screen.findByRole( 'dialog', {
				name: event === 'onAddSite' ? 'Add site' : 'Settings',
			} );
		}
	);

	it( 'keeps the workspace and draft mounted and contains app shortcuts and focus', async () => {
		const { history, user, connector } = await renderWorkspace( '/sites/poetry/new' );
		const composer = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await user.type( composer, 'Keep this draft' );
		await openPalette();
		search( 'code is poetry' );
		await user.keyboard( '{Enter}' );
		pressK( dismiss() );
		await user.keyboard( '{Meta>},{/Meta}{Control>},{/Control}' );
		await user.keyboard(
			'{ArrowUp}{ArrowUp}{ArrowDown}{ArrowDown}{ArrowLeft}{ArrowRight}{ArrowLeft}{ArrowRight}ba'
		);
		expect( scene() ).toBeVisible();
		expect( screen.queryByRole( 'dialog', { name: 'Wapuu World' } ) ).not.toBeInTheDocument();
		await user.tab();
		await waitFor( () => expect( dismiss() ).toHaveFocus() );
		await user.tab( { shift: true } );
		await waitFor( () => expect( dismiss() ).toHaveFocus() );
		expect( history.location.pathname ).toBe( '/sites/poetry/new' );
		expect( history.location.search ).toBe( '' );
		expect( composer ).toBeInTheDocument();
		expect( composer ).toHaveValue( 'Keep this draft' );
		expect( connector.continueSession ).not.toHaveBeenCalled();
		await user.click( dismiss() );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBe( composer );
		expect( composer ).toHaveFocus();
	} );
} );
