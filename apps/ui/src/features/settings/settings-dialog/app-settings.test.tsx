import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppMessagesForTests } from '@/data/app-messages';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SiteDetails } from '@/data/core';

function site( overrides: Partial< SiteDetails > = {} ) {
	return makeSite( { id: 'one', path: '/sites/my-site', ...overrides } );
}

function setup( sites: SiteDetails[] = [ site() ] ) {
	const connector = createFakeConnector( { sites, user: null } );
	connector.updateSite.mockImplementation( async ( updated ) => {
		connector.state.sites = connector.state.sites.map( ( entry ) =>
			entry.id === updated.id ? { ...entry, ...updated } : entry
		);
		connector.emit( 'onSiteEvent', {
			event: SITE_EVENTS.UPDATED,
			siteId: updated.id,
			running: updated.running,
		} );
	} );
	return renderApp( { connector } );
}

async function openSettings() {
	await screen.findByRole( 'button', { name: 'Site menu' } );
	fireEvent.click( screen.getByRole( 'button', { name: /^Settings$/ } ) );
	return screen.findByRole( 'dialog', { name: 'Settings' } );
}

function scopeTab( name: string ) {
	return within( screen.getByRole( 'tablist', { name: 'Settings scope' } ) ).getByRole( 'tab', {
		name,
	} );
}

beforeEach( () => {
	localStorage.clear();
	resetAppMessagesForTests();
} );

afterEach( () => {
	act( () => setCommandPaletteOpen( false ) );
} );

describe( 'Settings in the Studio workspace', () => {
	it( 'searches both settings scopes and opens the matching field across scopes', async () => {
		setup();
		await openSettings();
		const search = await screen.findByRole( 'textbox', { name: 'Search settings' } );
		fireEvent.change( search, { target: { value: 'MCP' } } );
		const matches = screen.getByRole( 'tablist', { name: 'Matching settings' } );
		expect( within( matches ).getAllByText( 'App' )[ 0 ] ).toBeVisible();
		expect( within( matches ).queryByText( 'Site' ) ).not.toBeInTheDocument();
		fireEvent.change( search, { target: { value: 'PHP version' } } );
		fireEvent.click( screen.getByRole( 'tab', { name: /^PHP version/ } ) );
		const php = await screen.findByRole( 'combobox', { name: 'PHP version' } );
		await waitFor( () =>
			expect( php.closest( '[data-settings-row]' ) ).toHaveAttribute( 'data-settings-match' )
		);
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Search settings' } ), {
			target: { value: 'Language' },
		} );
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Search settings' } ), {
			key: 'Enter',
		} );
		expect( await screen.findByRole( 'combobox', { name: 'Language' } ) ).toBeVisible();
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Search settings' } ), {
			target: { value: 'zzzzzz' },
		} );
		expect(
			within( screen.getByRole( 'dialog', { name: 'Settings' } ) ).getByText( 'No settings found.' )
		).toBeVisible();
		expect(
			screen.queryByRole( 'tablist', { name: 'Matching settings' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'tablist', { name: 'Settings sections' } )
		).not.toBeInTheDocument();
	} );

	it( 'switches settings scopes and remembers the settings site', async () => {
		setup( [ site(), site( { id: 'two', name: 'Second' } ) ] );
		const dialog = await openSettings();
		expect( scopeTab( 'App' ) ).toHaveAttribute( 'aria-selected', 'true' );
		fireEvent.click( scopeTab( 'Site' ) );
		expect( await screen.findByRole( 'textbox', { name: 'Site name' } ) ).toHaveValue( 'My site' );
		expect( screen.getByRole( 'dialog', { name: 'Settings' } ) ).toBe( dialog );
		expect(
			screen.queryByRole( 'button', { name: 'Switch site settings' } )
		).not.toBeInTheDocument();
		fireEvent.click( scopeTab( 'App' ) );
		await screen.findByRole( 'combobox', { name: 'Language' } );
		expect( screen.getByRole( 'dialog', { name: 'Settings' } ) ).toBe( dialog );
		fireEvent.click( scopeTab( 'Site' ) );
		expect( await screen.findByRole( 'textbox', { name: 'Site name' } ) ).toHaveValue( 'My site' );
		fireEvent.click( scopeTab( 'App' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Close settings' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	} );

	it( 'disables the Site settings scope when no site is available', async () => {
		setup( [] );
		fireEvent.click(
			within( await screen.findByRole( 'dialog', { name: 'Add site' } ) ).getByRole( 'button', {
				name: 'Close Add site',
			} )
		);
		fireEvent.click( await screen.findByRole( 'button', { name: /^Settings$/ } ) );
		await screen.findByRole( 'dialog', { name: 'Settings' } );
		expect( scopeTab( 'Site' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( scopeTab( 'Site' ) );
		expect( scopeTab( 'App' ) ).toHaveAttribute( 'aria-selected', 'true' );
	} );
} );

it( 'offers installed browsers and saves or clears the site browser preference', async () => {
	const connector = createFakeConnector( { sites: [ site() ], user: null } );
	const installed = await connector.getInstalledApps();
	connector.getInstalledApps.mockResolvedValue( { ...installed, chrome: true, safari: false } );
	renderApp( { connector } );
	await openSettings();
	const browser = await screen.findByRole( 'combobox', { name: 'Default browser' } );
	expect( browser ).toHaveTextContent( 'System default' );
	await userEvent.click( browser );
	expect( await screen.findByRole( 'option', { name: 'Google Chrome' } ) ).toBeVisible();
	expect( screen.queryByRole( 'option', { name: 'Safari' } ) ).not.toBeInTheDocument();
	await userEvent.click( screen.getByRole( 'option', { name: 'Google Chrome' } ) );
	await waitFor( () =>
		expect( connector.setUserPreferences ).toHaveBeenCalledWith( { browser: 'chrome' }, undefined )
	);
	await userEvent.click( screen.getByRole( 'combobox', { name: 'Default browser' } ) );
	await userEvent.click( await screen.findByRole( 'option', { name: 'System default' } ) );
	await waitFor( () =>
		expect( connector.setUserPreferences ).toHaveBeenCalledWith( { browser: null }, undefined )
	);
} );
