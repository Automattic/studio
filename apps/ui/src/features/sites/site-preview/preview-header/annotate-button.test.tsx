import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useOnboardingGuide } from '@/features/onboarding';
import { Button } from '@/lib/ui';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AnnotateButton } from './annotate-button';
import type { ComponentProps } from 'react';

async function setup(
	props: Partial< ComponentProps< typeof AnnotateButton > > = {},
	connector = createFakeConnector()
) {
	const onClick = vi.fn();
	const view = renderWithProviders(
		<AnnotateButton
			active={ false }
			disabled={ false }
			iconOnly={ false }
			onClick={ onClick }
			{ ...props }
		/>,
		{ connector }
	);
	await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalled() );
	await act( async () => {} );
	return { ...view, button: screen.getByRole( 'button', { name: 'Annotate' } ), onClick };
}

describe( 'Annotate first-use helper', () => {
	it( 'refreshes first-use state after a failed save so the tip can be retried', async () => {
		const connector = createFakeConnector();
		connector.setOnboardingHints.mockRejectedValueOnce( new Error( 'Save failed' ) );
		const { button, user } = await setup( {}, connector );
		await user.click( button );
		await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalledTimes( 2 ) );
		await user.unhover( button );
		await user.hover( button );
		expect( await screen.findByRole( 'dialog', { name: 'Try Annotate' } ) ).toBeVisible();
	} );

	it( 'preserves the tip when Annotate is used during a guide', async () => {
		function WithGuide() {
			const guide = useOnboardingGuide();
			return (
				<>
					<Button
						onClick={ () =>
							guide.openGuide( {
								pages: [
									{
										illustration: 'sites',
										title: () => 'Guide',
										description: () => 'Guide description',
										action: () => 'Done',
									},
								],
							} )
						}
					>
						Open guide
					</Button>
					<AnnotateButton
						active={ false }
						disabled={ false }
						iconOnly={ false }
						onClick={ vi.fn() }
					/>
				</>
			);
		}
		const { user, connector } = renderWithProviders( <WithGuide /> );
		await user.click( await screen.findByRole( 'button', { name: 'Open guide' } ) );
		await screen.findByRole( 'dialog', { name: 'Guide' } );
		// Simulate an action taken by an interactive guide while its tip is suppressed.
		fireEvent.click( screen.getByRole( 'button', { name: 'Annotate', hidden: true } ) );
		expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Guide' } ) ).not.toBeInTheDocument()
		);
		fireEvent.focus( screen.getByRole( 'button', { name: 'Annotate' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Try Annotate' } ) ).toBeVisible();
	} );

	it( 'opens on keyboard focus without taking focus or activating Annotate', async () => {
		const { button, user, onClick } = await setup();
		await user.tab();
		expect( await screen.findByRole( 'dialog', { name: 'Try Annotate' } ) ).toBeVisible();
		expect( button ).toHaveFocus();
		expect( button ).toHaveAccessibleDescription(
			'Point to anything and describe what you want to change.'
		);
		expect( onClick ).not.toHaveBeenCalled();
	} );

	it( 'dismisses with Escape and restores the normal tooltip', async () => {
		const { button, user, connector } = await setup();
		await user.tab();
		await screen.findByRole( 'dialog' );
		await user.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		expect( connector.setOnboardingHints ).toHaveBeenCalledWith( { annotateHintDismissed: true } );
		expect( button ).toHaveFocus();
		await user.hover( button );
		expect(
			await screen.findByText( 'Annotate', { selector: '[data-slot="tooltip-content"]' } )
		).toBeVisible();
	} );

	it( 'keeps hover reversible and activates Annotate on the first click', async () => {
		const { button, user, connector, onClick } = await setup();
		await user.hover( button );
		await screen.findByRole( 'dialog' );
		await user.unhover( button );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
		expect( onClick ).not.toHaveBeenCalled();
		await user.click( button );
		expect( onClick ).toHaveBeenCalledOnce();
		expect( connector.setOnboardingHints ).toHaveBeenCalledWith( { annotateHintDismissed: true } );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it.each( [ { disabled: true }, { active: true } ] )(
		'does not show while unavailable: %o',
		async ( props ) => {
			const { button, user, connector } = await setup( props );
			await user.hover( button );
			await act( () => new Promise( ( resolve ) => setTimeout( resolve, 600 ) ) );
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
		}
	);

	it( 'honors saved dismissal on a fresh mount, including icon-only buttons', async () => {
		const connector = createFakeConnector(
			{},
			{ getOnboardingHints: async () => ( { annotateHintDismissed: true } ) }
		);
		const { user } = renderWithProviders(
			<AnnotateButton active={ false } disabled={ false } iconOnly onClick={ vi.fn() } />,
			{ connector }
		);
		await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalled() );
		await act( async () => {} );
		await user.tab();
		expect(
			await screen.findByText( 'Annotate', { selector: '[data-slot="tooltip-content"]' } )
		).toBeVisible();
		expect( screen.queryByRole( 'dialog', { name: 'Try Annotate' } ) ).not.toBeInTheDocument();
	} );
} );
