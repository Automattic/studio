import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { EmailView } from './index';
import type { SiteEmail } from '@/data/core';

function makeEmail( overrides: Partial< SiteEmail > = {} ): SiteEmail {
	return {
		id: '20261028-090000-000001-aaaaaa.eml',
		subject: '[My Site] Password Reset',
		from: { name: 'WordPress', address: 'wordpress@localhost' },
		to: [ { name: '', address: 'admin@example.com' } ],
		cc: [],
		replyTo: [],
		date: '2026-10-28T09:00:00.000Z',
		html: null,
		text: 'Reset it here:\nhttp://localhost:9010/wp-login.php?action=rp&key=abc\n',
		attachments: [],
		source: 'Subject: [My Site] Password Reset\n\nReset it here',
		...overrides,
	};
}

function renderEmail( emails: SiteEmail[] ) {
	const connector = createFakeConnector( { emails: { 'site-1': emails } } );
	const onOpenLink = vi.fn();
	renderWithProviders( <EmailView siteId="site-1" active onOpenLink={ onOpenLink } />, {
		connector,
	} );
	return { connector, onOpenLink };
}

describe( 'EmailView', () => {
	it( 'says when the site has sent no email', async () => {
		renderEmail( [] );

		expect( await screen.findByText( 'No email yet' ) ).toBeInTheDocument();
	} );

	it( 'lists email newest first and reads the one picked', async () => {
		const { onOpenLink } = renderEmail( [
			makeEmail(),
			makeEmail( {
				id: '20261027-090000-000001-bbbbbb.eml',
				subject: 'New user',
				to: [ { name: 'Jo', address: 'jo@example.com' } ],
			} ),
		] );

		const list = await screen.findByRole( 'region', { name: 'Email' } );
		expect( await within( list ).findByText( '2 emails' ) ).toBeInTheDocument();
		const rows = within( list ).getAllByRole( 'option' );
		expect( rows.map( ( row ) => row.textContent ) ).toEqual( [
			expect.stringContaining( 'Password Reset' ),
			expect.stringContaining( 'To Jo' ),
		] );
		expect( screen.getByText( 'Select an email to read it.' ) ).toBeInTheDocument();

		fireEvent.click( rows[ 0 ] );

		const message = await screen.findByRole( 'article', { name: '[My Site] Password Reset' } );
		expect( rows[ 0 ] ).toHaveAttribute( 'aria-selected', 'true' );
		expect( within( message ).getByText( 'WordPress <wordpress@localhost>' ) ).toBeInTheDocument();
		expect( within( message ).getByText( 'admin@example.com' ) ).toBeInTheDocument();
		fireEvent.click(
			within( message ).getByRole( 'link', {
				name: 'http://localhost:9010/wp-login.php?action=rp&key=abc',
			} )
		);
		expect( onOpenLink ).toHaveBeenCalledWith(
			'http://localhost:9010/wp-login.php?action=rp&key=abc'
		);

		fireEvent.click( within( message ).getByRole( 'button', { name: 'Back to email list' } ) );
		expect( await screen.findByText( 'Select an email to read it.' ) ).toBeInTheDocument();
	} );

	it( 'shows the HTML first, with the text and the source a tab away', async () => {
		renderEmail( [
			makeEmail( {
				html: '<p>Order <strong>received</strong></p>',
				text: 'Order received',
				attachments: [ { filename: 'invoice.pdf', mimeType: 'application/pdf', size: 2048 } ],
			} ),
		] );

		fireEvent.click( await screen.findByRole( 'option', { name: /Password Reset/ } ) );

		const message = await screen.findByRole( 'article' );
		expect( within( message ).getByTitle( 'Email content' ) ).toHaveAttribute(
			'sandbox',
			'allow-same-origin'
		);
		expect( within( message ).getByText( 'invoice.pdf' ) ).toBeInTheDocument();
		expect( within( message ).getByText( '2 KB' ) ).toBeInTheDocument();

		fireEvent.click( within( message ).getByRole( 'tab', { name: 'Text' } ) );
		expect( within( message ).getByText( 'Order received' ) ).toBeInTheDocument();
		expect( within( message ).queryByTitle( 'Email content' ) ).not.toBeInTheDocument();

		fireEvent.click( within( message ).getByRole( 'tab', { name: 'Source' } ) );
		expect(
			within( message ).getByText( /Subject: \[My Site\] Password Reset/ )
		).toBeInTheDocument();
	} );

	it( 'takes one tab stop and moves through the list with the arrow keys', async () => {
		renderEmail( [
			makeEmail(),
			makeEmail( { id: '20261027-090000-000001-bbbbbb.eml', subject: 'New user' } ),
			makeEmail( { id: '20261026-090000-000001-cccccc.eml', subject: 'Comment to moderate' } ),
		] );

		const list = await screen.findByRole( 'listbox', { name: 'Email' } );
		const rows = within( list ).getAllByRole( 'option' );
		expect( rows.map( ( row ) => row.tabIndex ) ).toEqual( [ 0, -1, -1 ] );

		rows[ 0 ].focus();
		fireEvent.keyDown( list, { key: 'ArrowDown' } );

		expect( rows[ 1 ] ).toHaveFocus();
		expect( rows.map( ( row ) => row.tabIndex ) ).toEqual( [ -1, 0, -1 ] );
		expect( await screen.findByRole( 'article', { name: 'New user' } ) ).toBeInTheDocument();

		fireEvent.keyDown( list, { key: 'End' } );
		expect( rows[ 2 ] ).toHaveFocus();
		expect(
			await screen.findByRole( 'article', { name: 'Comment to moderate' } )
		).toBeInTheDocument();

		fireEvent.keyDown( list, { key: 'ArrowDown' } );
		expect( rows[ 2 ] ).toHaveFocus();
	} );

	it( 'opens the folder the email is saved in', async () => {
		const { connector } = renderEmail( [ makeEmail() ] );

		fireEvent.click( await screen.findByRole( 'button', { name: 'Open email folder' } ) );

		expect( connector.openSiteEmailFolder ).toHaveBeenCalledExactlyOnceWith( 'site-1' );
	} );
} );
