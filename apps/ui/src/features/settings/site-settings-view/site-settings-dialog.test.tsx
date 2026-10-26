import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SiteDetails } from '@/data/core';

const site = makeSite( { id: 'one', name: 'Example', path: '/sites/example', running: true } );

function setup( {
	logExists = false,
	sites = [ site ],
	signedIn = true,
	section = 'site',
}: { logExists?: boolean; sites?: SiteDetails[]; signedIn?: boolean; section?: string } = {} ) {
	const connector = createFakeConnector( signedIn ? { sites } : { sites, user: null }, {
		siteDebugLogExists: async () => logExists,
		getSiteAgentFiles: async ( _siteId, kind ) =>
			kind === 'skills'
				? [
						{
							id: 'studio-cli',
							displayName: 'WordPress Studio CLI',
							description: 'CLI',
							installed: false,
							enabled: false,
						},
				  ]
				: [
						{
							id: 'agents',
							displayName: 'AGENTS.md',
							description: 'Instructions',
							installed: false,
							enabled: false,
						},
				  ],
	} );
	connector.updateSite.mockImplementation( async ( updated ) => {
		connector.state.sites = connector.state.sites.map( ( entry ) =>
			entry.id === updated.id ? updated : entry
		);
		connector.emit( 'onSiteEvent', {
			event: SITE_EVENTS.UPDATED,
			siteId: updated.id,
			running: !! updated.running,
		} );
	} );
	const view = renderApp( { connector, path: `/sites/one?settings=${ section }` } );
	const settingsParam = () => new URLSearchParams( view.history.location.search ).get( 'settings' );
	return { ...view, settingsParam };
}

const siteName = () => screen.findByRole( 'textbox', { name: 'Site name' } );

async function choose( combobox: string, option: string | RegExp ) {
	fireEvent.click( await screen.findByRole( 'combobox', { name: combobox } ) );
	const item = await screen.findByRole( 'option', { name: option } );
	fireEvent.pointerDown( item, { pointerType: 'mouse' } );
	fireEvent.click( item );
}

describe( 'site settings', () => {
	it( 'shows header actions only while there are unsaved changes', async () => {
		setup();
		const name = await siteName();
		expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument();
		fireEvent.change( name, { target: { value: 'Edited' } } );
		expect( screen.getByRole( 'button', { name: 'Discard' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
		fireEvent.change( name, { target: { value: site.name } } );
		expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Skills' } ) );
		await screen.findByText( 'WordPress Studio CLI' );
		expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Instructions' } ) );
		await screen.findByText( 'AGENTS.md' );
		expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument();
	} );

	it( 'navigates from sidebar search to PHP version and saves the change', async () => {
		const { connector } = setup();
		await siteName();
		const search = screen.getByRole( 'textbox', { name: 'Search settings' } );
		fireEvent.change( search, { target: { value: 'PHP version' } } );
		expect( screen.queryByRole( 'combobox', { name: 'PHP version' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'PHP version' } ) );
		await choose( 'PHP version', '8.4' );
		expect( search ).toBeEnabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( connector.updateSite ).toHaveBeenCalledWith(
				expect.objectContaining( { id: 'one', phpVersion: '8.4' } ),
				undefined
			)
		);
	} );

	it( 'allows switching to Studio with unsaved site edits', async () => {
		const { connector, settingsParam } = setup();
		fireEvent.change( await siteName(), { target: { value: 'Edited' } } );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Studio' } ) );
		await waitFor( () => expect( settingsParam() ).toBe( 'general' ) );
		expect( connector.updateSite ).not.toHaveBeenCalled();
		expect( screen.getAllByRole( 'dialog' ) ).toHaveLength( 1 );
	} );

	it( 'keeps the version selector enabled and turns automatic updates off when a version is chosen', async () => {
		setup( { sites: [ { ...site, isWpAutoUpdating: false } ] } );
		await siteName();
		const toggle = screen.getByRole( 'switch', { name: 'Automatic updates' } );
		const selector = screen.getByRole( 'combobox', { name: 'WordPress version' } );
		await waitFor( () => expect( selector ).toHaveTextContent( '6.9' ) );
		expect( toggle ).not.toBeChecked();
		expect( selector ).toBeEnabled();
		fireEvent.click( toggle );
		expect( selector ).toBeEnabled();
		expect( selector ).toHaveTextContent( 'Auto-update' );
		await choose( 'WordPress version', '6.9' );
		expect( toggle ).not.toBeChecked();
		expect( selector ).toHaveTextContent( '6.9' );
		fireEvent.click( toggle );
		expect( selector ).toHaveTextContent( 'Auto-update' );
	} );

	it( 'saves Latest as automatic updates rather than a pinned version', async () => {
		const { connector } = setup( { sites: [ { ...site, isWpAutoUpdating: false } ] } );
		await siteName();
		const selector = screen.getByRole( 'combobox', { name: 'WordPress version' } );
		expect( screen.getByRole( 'switch', { name: 'Automatic updates' } ) ).not.toBeChecked();
		await choose( 'WordPress version', /^Auto-update/ );
		expect( selector ).toHaveTextContent( 'Auto-update' );
		expect( screen.getByRole( 'switch', { name: 'Automatic updates' } ) ).toBeChecked();
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( connector.updateSite ).toHaveBeenCalledWith(
				expect.objectContaining( { id: 'one', isWpAutoUpdating: true } ),
				'latest'
			)
		);
	} );

	it( 'copies the current credential values including a hidden password', async () => {
		const { connector } = setup();
		await siteName();
		expect( screen.getByRole( 'textbox', { name: 'Username' } ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'tab', { name: /^WordPress credentials/ } )
		).not.toBeInTheDocument();
		for ( const [ field, label, value ] of [
			[ 'Username', 'Copy admin username', 'new-admin' ],
			[ 'Password', 'Copy admin password', 'secret-value' ],
			[ 'Email', 'Copy admin email', 'new@example.com' ],
		] ) {
			fireEvent.change( screen.getByLabelText( field, { selector: 'input' } ), {
				target: { value },
			} );
			const button = screen.getByRole( 'button', { name: label } );
			await waitFor( () => expect( button ).toBeEnabled() );
			fireEvent.click( button );
			await waitFor( () => expect( connector.copyText ).toHaveBeenCalledWith( value ) );
			await waitFor( () =>
				expect( within( button.parentElement! ).getByRole( 'status' ) ).toHaveTextContent(
					'Copied'
				)
			);
		}
	} );

	it.each( [
		[ 'Site name', '', 'Site name is required.' ],
		[ 'Username', '', 'Admin username cannot be empty.' ],
		[
			'Username',
			'invalid user',
			'Username can only contain letters, numbers, and _.@- characters.',
		],
		[ 'Username', 'a'.repeat( 61 ), 'Username must be 60 characters or fewer.' ],
		[ 'Password', '', 'Admin password is required.' ],
		[ 'Email', '', 'Admin email cannot be empty.' ],
		[ 'Email', 'invalid', 'Please enter a valid email address.' ],
	] )( 'replaces the %s description with its validation error', async ( label, value, message ) => {
		setup();
		await siteName();
		const input = screen.getByLabelText( label, { selector: 'input' } );
		const description = document.getElementById( input.getAttribute( 'aria-describedby' )! )!;
		const initialValue = ( input as HTMLInputElement ).value;
		const help = description.textContent!;
		fireEvent.change( input, { target: { value } } );
		expect( input ).toHaveAttribute( 'aria-invalid', 'true' );
		expect( input ).toHaveAccessibleDescription( message );
		expect( within( description ).getByRole( 'alert' ) ).toHaveTextContent( message );
		expect( within( description ).getByText( help ) ).toHaveAttribute( 'aria-hidden', 'true' );
		expect( screen.getByRole( 'button', { name: /^Save$/ } ) ).toBeDisabled();
		fireEvent.change( input, { target: { value: initialValue } } );
		expect( input ).not.toHaveAttribute( 'aria-invalid' );
		expect( input ).toHaveAccessibleDescription( help );
		expect( within( description ).queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );

	it( 'replaces the domain description and restores it after correcting the address', async () => {
		setup();
		await siteName();
		fireEvent.click( screen.getByRole( 'switch', { name: 'Use custom domain' } ) );
		const input = screen.getByRole( 'textbox', { name: 'Domain' } );
		fireEvent.change( input, { target: { value: 'invalid' } } );
		expect( screen.getByText( 'Please enter a valid domain name' ) ).toBeVisible();
		expect( input ).toHaveAttribute( 'aria-invalid', 'true' );
		fireEvent.change( input, { target: { value: 'example.local' } } );
		expect( input ).not.toHaveAttribute( 'aria-invalid' );
	} );

	it( 'reveals and hides the password using its input button', async () => {
		setup();
		await siteName();
		const password = screen.getByLabelText( 'Password', { selector: 'input' } );
		expect( password ).toHaveAttribute( 'type', 'password' );
		const show = screen.getByRole( 'button', { name: 'Show password' } );
		expect( password.parentElement ).toContainElement( show );
		fireEvent.click( show );
		expect( password ).toHaveAttribute( 'type', 'text' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Hide password' } ) );
		expect( password ).toHaveAttribute( 'type', 'password' );
	} );

	it( 'opens an existing log inline even when logging is disabled', async () => {
		const { connector } = setup( { logExists: true, section: 'debugging' } );
		expect( await screen.findByRole( 'switch', { name: 'Debug log' } ) ).not.toBeChecked();
		const link = await screen.findByRole( 'button', { name: 'Open log file' } );
		expect( link.closest( '[data-settings-row]' ) ).toHaveTextContent(
			'Write PHP errors to wp-content/debug.log.'
		);
		fireEvent.click( link );
		await waitFor( () => expect( connector.openSiteDebugLog ).toHaveBeenCalledWith( 'one' ) );
	} );

	it( 'keeps the filename as plain text when no log exists', async () => {
		const { connector } = setup( { section: 'debugging' } );
		await waitFor( () =>
			expect( screen.getByText( 'Write PHP errors to wp-content/debug.log.' ) ).toBeInTheDocument()
		);
		await waitFor( () => expect( connector.siteDebugLogExists ).toHaveBeenCalled() );
		expect( screen.queryByRole( 'button', { name: 'Open log file' } ) ).not.toBeInTheDocument();
	} );

	it( 'places the connection card first in General without submitting the site form', async () => {
		const { connector } = setup( { signedIn: false } );
		await siteName();
		const login = await screen.findByRole( 'button', { name: 'Connect' } );
		const card = login.closest( 'fieldset' )!;
		expect( card ).toHaveTextContent( 'Do more with WordPress.com' );
		expect( card.parentElement?.querySelector( 'fieldset' ) ).toBe( card );
		expect( screen.queryByRole( 'button', { name: 'Discard' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument();
		fireEvent.click( login );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith( true, 'settings' )
		);
		expect( connector.updateSite ).not.toHaveBeenCalled();
	} );

	it( 'opens the official documentation for each debugging setting', async () => {
		const { connector } = setup( { section: 'debugging' } );
		await screen.findByRole( 'switch', { name: 'Xdebug' } );
		for ( const button of screen.getAllByRole( 'button', { name: 'Learn more…' } ) ) {
			fireEvent.click( button );
		}
		for ( const url of [
			'https://developer.wordpress.org/reference/functions/wp_get_environment_type/',
			'https://developer.wordpress.com/docs/developer-tools/studio/xdebug/',
			'https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/#wp_debug_display',
			'https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/#script_debug',
		] ) {
			expect( connector.openExternalUrl ).toHaveBeenCalledWith( url );
		}
	} );

	it( 'preserves edits across sections and supports subsequent saves', async () => {
		const { connector, settingsParam } = setup();
		fireEvent.change( await siteName(), { target: { value: 'Renamed' } } );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Debug' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( connector.updateSite ).toHaveBeenCalledWith(
				expect.objectContaining( { name: 'Renamed' } ),
				undefined
			)
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument()
		);
		fireEvent.click( await screen.findByRole( 'switch', { name: 'Debug log' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () => expect( connector.updateSite ).toHaveBeenCalledTimes( 2 ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument()
		);
		expect( settingsParam() ).toBe( 'debugging' );
	} );

	it( 'cancels pending navigation when editing continues', async () => {
		const { connector, settingsParam } = setup();
		const name = await siteName();
		fireEvent.change( name, { target: { value: 'First edit' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
		expect( screen.getByRole( 'button', { name: 'Discard' } ) ).toHaveFocus();
		fireEvent.input( name, { target: { value: 'Continued edit' } } );
		fireEvent.change( name, { target: { value: 'Continued edit' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () => expect( connector.updateSite ).toHaveBeenCalledOnce() );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument()
		);
		expect( settingsParam() ).toBe( 'site' );
	} );

	it( 'retains the draft on a failed save', async () => {
		const { connector, settingsParam } = setup();
		connector.updateSite.mockRejectedValue( new Error( 'Unable to update site' ) );
		fireEvent.change( await siteName(), { target: { value: 'Keep this' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		expect( await screen.findByText( 'Unable to update site' ) ).toBeVisible();
		expect( screen.getByRole( 'textbox', { name: 'Site name' } ) ).toHaveValue( 'Keep this' );
		expect( settingsParam() ).toBe( 'site' );
	} );

	it( 'discards invalid edits before returning to Studio', async () => {
		const { connector } = setup();
		fireEvent.change( await siteName(), { target: { value: '' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Discard' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument()
		);
		expect( connector.updateSite ).not.toHaveBeenCalled();
	} );

	it( 'installs site-specific files immediately without saving the draft', async () => {
		const { connector } = setup();
		await siteName();
		fireEvent.click( screen.getByRole( 'tab', { name: 'Instructions' } ) );
		await screen.findByText( 'AGENTS.md' );
		fireEvent.click( screen.getByRole( 'switch', { name: 'AGENTS.md' } ) );
		await waitFor( () =>
			expect( connector.setSiteAgentFileEnabled ).toHaveBeenCalledWith(
				'one',
				'instructions',
				'agents',
				true
			)
		);
		expect( connector.updateSite ).not.toHaveBeenCalled();
	} );

	it( 'closes after saving the changes that held it open', async () => {
		const { connector } = setup();
		fireEvent.change( await siteName(), { target: { value: 'Renamed' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument()
		);
		expect( connector.updateSite ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'Renamed' } ),
			undefined
		);
	} );

	it( 'locks the form while another site operation runs', async () => {
		setup( { sites: [ { ...site, operation: { pid: 1, kind: 'export' } } ] } );
		expect(
			await screen.findByText(
				'Wait for the current site operation to finish before changing settings.'
			)
		).toBeVisible();
		expect( await siteName() ).toBeDisabled();
	} );

	it( 'disables Xdebug while another site has it, and says which', async () => {
		setup( {
			section: 'debugging',
			sites: [ site, makeSite( { id: 'two', name: 'Other Site', enableXdebug: true } ) ],
		} );
		const xdebug = await screen.findByRole( 'switch', { name: 'Xdebug' } );
		expect( xdebug ).toHaveAttribute( 'data-disabled' );
		expect( xdebug ).toHaveAttribute( 'aria-invalid', 'true' );
		expect( xdebug ).toHaveAccessibleDescription( 'Xdebug is enabled on another site: Other Site' );
	} );

	it( 'keeps an unsupported PHP version listed with the version that runs instead', async () => {
		setup( { section: 'php', sites: [ { ...site, phpVersion: '7.4' } ] } );
		const version = await screen.findByRole( 'combobox', { name: 'PHP version' } );
		expect( version ).toHaveTextContent( '7.4' );
		expect( version ).toHaveAccessibleDescription( 'Native PHP will use 8.2' );
	} );

	it( 'pins the installed version when automatic updates are turned off', async () => {
		const { connector } = setup( { sites: [ { ...site, isWpAutoUpdating: true } ] } );
		await siteName();
		const selector = screen.getByRole( 'combobox', { name: 'WordPress version' } );
		await waitFor( () => expect( selector ).toHaveTextContent( 'Auto-update (6.9)' ) );
		fireEvent.click( screen.getByRole( 'switch', { name: 'Automatic updates' } ) );
		expect( selector ).toHaveTextContent( '6.9' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( connector.updateSite ).toHaveBeenCalledWith(
				expect.objectContaining( { isWpAutoUpdating: false } ),
				'6.9'
			)
		);
	} );

	it( 'rejects a custom domain another site already uses', async () => {
		setup( { sites: [ site, makeSite( { id: 'two', customDomain: 'taken.wp.local' } ) ] } );
		fireEvent.change( await siteName(), { target: { value: 'Taken' } } );
		fireEvent.click( screen.getByRole( 'switch', { name: 'Use custom domain' } ) );
		const domain = screen.getByRole( 'textbox', { name: 'Domain' } );
		expect( domain ).toHaveValue( 'taken.wp.local' );
		expect( domain ).toHaveAttribute( 'aria-invalid', 'true' );
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );
} );
