import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useOnboardingGuide } from '@/features/onboarding';
import { Button } from '@/lib/ui';
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
	await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalled() );
	await act( async () => {} );
	return { ...view, button: screen.getByRole( 'button', { name: 'Annotate' } ), onClick };
}

describe( 'Annotate first-use helper', () => {
	it( 'keeps hover and focus as tooltips and shows the tip after activation only once', async () => {
		const { button, user, connector, onClick } = await setup();
		await user.hover( button );
		expect(
			await screen.findByText( 'Point to anything to describe a change', {
				selector: '[data-slot="tooltip-content"]',
			} )
		).toBeVisible();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		await user.unhover( button );
		await user.tab();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( onClick ).not.toHaveBeenCalled();
		await user.click( button );
		const tip = await screen.findByRole( 'dialog', { name: 'Annotate your site' } );
		expect( tip ).toHaveAccessibleDescription(
			'Click anything, or drag to select an area, then describe the change. Click Annotate again when you’re done.'
		);
		expect( tip ).not.toHaveAttribute( 'data-instant' );
		expect( button ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( button ).toHaveFocus();
		await waitFor( () =>
			expect( connector.setOnboardingHints ).toHaveBeenCalledExactlyOnceWith( {
				annotateHintDismissed: true,
			} )
		);
		await user.click( screen.getByRole( 'button', { name: 'Dismiss tip' } ) );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		await user.click( button );
		await user.click( button );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'opens after the annotation shortcut and closes when annotation mode exits', async () => {
		const { onClick, button } = await setup();
		const event = { key: '>', code: 'Period', ctrlKey: true, shiftKey: true };
		fireEvent.keyDown( document, { ...event, repeat: true } );
		fireEvent.keyDown( document, { ...event, isComposing: true } );
		expect( onClick ).not.toHaveBeenCalled();
		fireEvent.keyDown( document, event );
		await screen.findByRole( 'dialog', { name: 'Annotate your site' } );
		expect( button ).toHaveAttribute( 'aria-keyshortcuts' );
		fireEvent.keyDown( document, event );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
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

	it( 'dismisses the tip with Escape and restores the ordinary mode tooltip', async () => {
		const { button, user } = await setup();
		await user.click( button );
		await screen.findByRole( 'dialog' );
		await user.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await user.unhover( button );
		await user.hover( button );
		expect(
			await screen.findByText( 'Exit annotation mode', {
				selector: '[data-slot="tooltip-content"]',
			} )
		).toBeVisible();
	} );

	it( 'waits for a guide to close before showing the activated feature', async () => {
		function WithGuide() {
			const guide = useOnboardingGuide();
			const [ active, setActive ] = useState( false );
			return (
				<>
					<Button
						onClick={ () => {
							setActive( true );
							guide.openGuide( {
								pages: [
									{
										illustration: 'sites',
										title: () => 'Guide',
										description: () => 'Guide description',
										action: () => 'Done',
									},
								],
							} );
						} }
					>
						Open guide
					</Button>
					<AnnotateButton
						active={ active }
						disabled={ false }
						onClick={ () => setActive( ( value ) => ! value ) }
					/>
				</>
			);
		}
		const { user, connector } = renderWithProviders( <WithGuide /> );
		await user.click( await screen.findByRole( 'button', { name: 'Open guide' } ) );
		await screen.findByRole( 'dialog', { name: 'Guide' } );
		expect(
			screen.queryByRole( 'dialog', { name: 'Annotate your site' } )
		).not.toBeInTheDocument();
		expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: 'Done' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Annotate your site' } ) ).toBeVisible();
	} );

	it( 'honors saved dismissal on a fresh mount', async () => {
		const connector = createFakeConnector(
			{},
			{ getOnboardingHints: async () => ( { annotateHintDismissed: true } ) }
		);
		const { button, user } = await setup( {}, connector );
		await user.click( button );
		expect( button ).toHaveAttribute( 'aria-pressed', 'true' );
		expect(
			screen.queryByRole( 'dialog', { name: 'Annotate your site' } )
		).not.toBeInTheDocument();
		expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
	} );

	it( 'keeps a failed save visible and retries on the next activation', async () => {
		const connector = createFakeConnector();
		connector.setOnboardingHints.mockRejectedValueOnce( new Error( 'Save failed' ) );
		const { button, user } = await setup( {}, connector );
		await user.click( button );
		await screen.findByRole( 'dialog', { name: 'Annotate your site' } );
		await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalledTimes( 2 ) );
		expect( screen.getByRole( 'dialog', { name: 'Annotate your site' } ) ).toBeVisible();
		await user.click( button );
		await user.click( button );
		await waitFor( () => expect( connector.setOnboardingHints ).toHaveBeenCalledTimes( 2 ) );
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
