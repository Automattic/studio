import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AnnotationOverlay } from './overlay';
import { clearAnnotations, pickAnnotation, setAnnotating } from './store';

const SITE = 'one';

afterEach( () => {
	clearAnnotations( SITE );
	setAnnotating( SITE, false );
} );

async function setup() {
	const connector = createFakeConnector();
	renderWithProviders(
		<AnnotationOverlay siteId={ SITE } anchor={ { left: 20, top: 20 } } onSend={ vi.fn() } />,
		{ connector }
	);
	await waitFor( () =>
		expect( document.querySelector( '[data-annotation-overlay]' ) ).not.toBeNull()
	);
	return connector;
}

const annotate = () => act( () => setAnnotating( SITE, true ) );
const pick = () =>
	act( () => {
		pickAnnotation( SITE, { selector: 'h1', tag: 'h1', path: '/' } );
	} );

it( 'dismisses an empty annotation with Escape while a notification is visible', async () => {
	await setup();
	render( <div role="dialog" aria-modal="false" data-slot="toast" /> );
	annotate();
	pick();
	fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Leave a note' } ), { key: 'Escape' } );
	expect( screen.queryByRole( 'textbox', { name: 'Leave a note' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'toolbar', { name: 'Annotations' } ) ).toBeInTheDocument();
} );

it( 'leaves the annotation open for Escape in a dialog and ignores closed dialogs', async () => {
	await setup();
	annotate();
	pick();
	const dialog = render( <div role="dialog" data-slot="dialog-content" /> );
	fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
	expect( screen.getByRole( 'textbox', { name: 'Leave a note' } ) ).toBeInTheDocument();
	dialog.rerender( <div role="dialog" data-slot="dialog-content" data-closed="" /> );
	fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Leave a note' } ), { key: 'Escape' } );
	expect( screen.queryByRole( 'textbox', { name: 'Leave a note' } ) ).not.toBeInTheDocument();
} );

it( 'remembers confirmation only after deletion, not dismissal', async () => {
	const connector = await setup();
	annotate();
	pick();
	fireEvent.change( screen.getByRole( 'textbox', { name: 'Leave a note' } ), {
		target: { value: 'Keep this draft' },
	} );
	fireEvent.click(
		within( screen.getByRole( 'toolbar' ) ).getByRole( 'button', { name: 'Cancel' } )
	);
	let dialog = await screen.findByRole( 'alertdialog', { name: 'Delete annotation?' } );
	fireEvent.click( within( dialog ).getByRole( 'checkbox' ) );
	fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
	expect( connector.setUserPreferences ).not.toHaveBeenCalled();
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	fireEvent.click(
		within( screen.getByRole( 'toolbar' ) ).getByRole( 'button', { name: 'Cancel' } )
	);
	dialog = await screen.findByRole( 'alertdialog', { name: 'Delete annotation?' } );
	expect( within( dialog ).getByRole( 'checkbox' ) ).not.toBeChecked();
	fireEvent.click( within( dialog ).getByRole( 'checkbox' ) );
	fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Delete annotations' } ) );
	await waitFor( () =>
		expect( connector.setUserPreferences.mock.calls[ 0 ]?.[ 0 ] ).toEqual( {
			confirmDeleteAnnotations: false,
		} )
	);
	expect( screen.queryByRole( 'toolbar' ) ).not.toBeInTheDocument();
} );

it( 'keeps the closing toolbar inert and reuses it when reopened', async () => {
	await setup();
	annotate();
	const toolbar = screen.getByRole( 'toolbar', { name: 'Annotations' } );
	fireEvent.click( within( toolbar ).getByRole( 'button', { name: 'Cancel' } ) );
	expect( toolbar ).toBeInTheDocument();
	expect( toolbar ).toHaveAttribute( 'inert' );
	expect( screen.queryByRole( 'toolbar' ) ).not.toBeInTheDocument();
	annotate();
	expect( screen.getByRole( 'toolbar', { name: 'Annotations' } ) ).toBe( toolbar );
	expect( toolbar ).not.toHaveAttribute( 'inert' );
} );
