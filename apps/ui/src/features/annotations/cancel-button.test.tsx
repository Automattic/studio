import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { USER_PREFERENCES_QUERY_KEY } from '@/data/queries/use-user-preferences';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AnnotationCancelButton } from './cancel-button';
import {
	changeAnnotation,
	clearAnnotations,
	getSiteAnnotations,
	pickAnnotation,
	setAnnotating,
} from './store';

const SITE = 'discard-preference';
afterEach( () => clearAnnotations( SITE ) );

function addNote() {
	act( () => {
		setAnnotating( SITE, true );
		const id = pickAnnotation( SITE, { selector: 'h1' } )!;
		changeAnnotation( SITE, id, { comment: 'Keep this until discarded' } );
	} );
}

async function setup( confirmDeleteAnnotations = true ) {
	const connector = createFakeConnector( { preferences: { confirmDeleteAnnotations } } );
	addNote();
	const view = renderWithProviders( <AnnotationCancelButton siteId={ SITE } iconOnly />, {
		connector,
	} );
	await waitFor( () =>
		expect( view.queryClient.getQueryData( USER_PREFERENCES_QUERY_KEY ) ).toMatchObject( {
			confirmDeleteAnnotations,
		} )
	);
	return view;
}

it( 'respects the existing setting when confirmation is disabled', async () => {
	const { user, connector } = await setup( false );
	await user.click( screen.getByRole( 'button', { name: 'Discard annotations' } ) );
	expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
	expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 0 );
	expect( connector.setUserPreferences ).not.toHaveBeenCalled();
} );

it( 'does not save the checkbox on Cancel and resets it when reopened', async () => {
	const { user, connector } = await setup();
	await user.click( screen.getByRole( 'button', { name: 'Discard annotations' } ) );
	const dialog = await screen.findByRole( 'alertdialog' );
	await user.click( within( dialog ).getByRole( 'checkbox', { name: "Don't ask again" } ) );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
	expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 1 );
	expect( connector.setUserPreferences ).not.toHaveBeenCalled();
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	await user.click( screen.getByRole( 'button', { name: 'Discard annotations' } ) );
	expect( screen.getByRole( 'checkbox', { name: "Don't ask again" } ) ).not.toBeChecked();
	await user.click( screen.getByRole( 'button', { name: 'Discard' } ) );
	expect( connector.setUserPreferences ).not.toHaveBeenCalled();
	expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 0 );
} );

it( 'saves the opt-out on Discard and skips later confirmations', async () => {
	const { user, connector } = await setup();
	await user.click( screen.getByRole( 'button', { name: 'Discard annotations' } ) );
	await user.click( await screen.findByRole( 'checkbox', { name: "Don't ask again" } ) );
	await user.click( screen.getByRole( 'button', { name: 'Discard' } ) );
	await waitFor( () =>
		expect( connector.setUserPreferences ).toHaveBeenCalledWith(
			{ confirmDeleteAnnotations: false },
			undefined
		)
	);
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	addNote();
	await user.click( screen.getByRole( 'button', { name: 'Discard annotations' } ) );
	expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
	expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 0 );
} );
