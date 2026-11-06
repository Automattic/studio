import { act, fireEvent, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AnnotateButton } from './annotate-button';

async function setup(
	props: Partial< ComponentProps< typeof AnnotateButton > > = {},
	connector = createFakeConnector()
) {
	const onClick = vi.fn();
	function Toggle() {
		const [ active, setActive ] = useState( props.active ?? false );
		return (
			<AnnotateButton
				disabled={ false }
				{ ...props }
				active={ active }
				onClick={ () => {
					onClick();
					setActive( ( value ) => ! value );
				} }
			/>
		);
	}
	const view = renderWithProviders( <Toggle />, { connector } );
	await act( async () => {} );
	return { ...view, button: screen.getByRole( 'button', { name: 'Annotate' } ), onClick };
}

describe( 'annotation control', () => {
	it( 'shows the ordinary tooltip and toggles without a feature popover', async () => {
		const { button, user, connector } = await setup();
		await user.hover( button );
		expect( await screen.findByText( 'Point to anything to describe a change' ) ).toBeVisible();
		await user.click( button );
		expect( button ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
		await user.click( button );
		expect( button ).toHaveAttribute( 'aria-pressed', 'false' );
	} );

	it( 'toggles with the annotation shortcut without opening a tip', async () => {
		const { onClick, button } = await setup();
		const event = { key: '>', code: 'Period', ctrlKey: true, shiftKey: true };
		fireEvent.keyDown( document, { ...event, repeat: true } );
		fireEvent.keyDown( document, { ...event, isComposing: true } );
		expect( onClick ).not.toHaveBeenCalled();
		fireEvent.keyDown( document, event );
		expect( button ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		fireEvent.keyDown( document, event );
		expect( button ).toHaveAttribute( 'aria-pressed', 'false' );
	} );

	it( 'leaves the shortcut alone when annotation is disabled or a dialog is open', async () => {
		const { onClick, unmount } = await setup( { disabled: true } );
		const event = { key: '>', code: 'Period', ctrlKey: true, shiftKey: true };
		fireEvent.keyDown( document, event );
		expect( onClick ).not.toHaveBeenCalled();
		unmount();
		const enabled = await setup();
		const dialog = document.createElement( 'div' );
		dialog.dataset.slot = 'dialog-content';
		document.body.append( dialog );
		try {
			fireEvent.keyDown( document, event );
			expect( enabled.onClick ).not.toHaveBeenCalled();
		} finally {
			dialog.remove();
		}
	} );
} );

describe( 'annotation count', () => {
	it( 'shows a notification dot with the count available to assistive technology', async () => {
		const { user, button, onClick } = await setup( { active: false, annotationCount: 2 } );
		expect( button.querySelector( '[data-slot="notification-dot"]' ) ).toBeInTheDocument();
		expect( button ).toHaveTextContent( /^$/ );
		expect( button ).toHaveAccessibleDescription( '2 annotations ready to send' );
		expect( screen.queryByRole( 'button', { name: /Send.*annotation/ } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Review annotations' } )
		).not.toBeInTheDocument();
		await user.click( button );
		expect( onClick ).toHaveBeenCalledOnce();
	} );
} );
