import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { getNoticeHistory, getVisibleToasts } from '@/data/app-messages';
import { useCopySite } from '@/data/queries/use-sites';
import { AppToasts } from '@/features/notifications';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { SiteDetails } from '@/data/core';

function DuplicateAction() {
	const copy = useCopySite();
	return <button onClick={ () => copy.mutate( 'source' ) }>Duplicate</button>;
}

function Harness() {
	const [ visible, setVisible ] = useState( true );
	return (
		<>
			<AppToasts />
			{ visible ? <DuplicateAction /> : null }
			<button onClick={ () => setVisible( false ) }>Close menu</button>
		</>
	);
}

it.each( [ 'success', 'failure' ] )(
	'keeps duplication feedback visible after closing the menu, then reports %s',
	async ( result ) => {
		const created = makeSite( { id: 'copy', name: 'Source Copy', running: false } );
		let resolve!: ( site: SiteDetails ) => void;
		let reject!: ( error: Error ) => void;
		const operation = new Promise< SiteDetails >( ( done, fail ) => {
			resolve = done;
			reject = fail;
		} );
		const connector = createFakeConnector(
			{ sites: [ makeSite( { id: 'source', name: 'Source' } ) ] },
			{ copySite: () => operation }
		);
		const { history } = renderWithProviders( <Harness />, { connector } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Duplicate' } ) );
		await screen.findByText( 'Duplicating site…' );
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( { processing: true, dismissible: false } );
		expect(
			screen.queryByRole( 'button', { name: 'Dismiss Duplicating site…' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close menu' } ) );
		expect( screen.getByText( 'Duplicating site…' ) ).toBeVisible();
		await act( async () => {
			if ( result === 'success' ) resolve( created );
			else reject( new Error( 'Not enough disk space' ) );
		} );
		const title = result === 'success' ? 'Site duplicated: Source Copy' : 'Failed to copy site';
		await screen.findByText( title );
		expect( screen.queryByText( 'Duplicating site…' ) ).not.toBeInTheDocument();
		expect( getNoticeHistory() ).toHaveLength( 1 );
		expect( screen.getByRole( 'button', { name: `Dismiss ${ title }` } ) ).toBeVisible();
		if ( result === 'success' ) {
			fireEvent.click( screen.getByRole( 'button', { name: 'Open' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/copy/new' ) );
		} else {
			expect( getNoticeHistory()[ 0 ].description ).toBe( 'Not enough disk space' );
		}
	}
);
