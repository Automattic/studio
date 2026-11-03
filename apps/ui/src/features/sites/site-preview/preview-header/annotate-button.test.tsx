import { act, screen, waitFor } from '@testing-library/react';
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
		<AnnotateButton active={ false } disabled={ false } onClick={ onClick } { ...props } />,
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

	it( 'suppresses the tip during a guide and makes it available afterward', async () => {
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
					<AnnotateButton active={ false } disabled={ false } onClick={ vi.fn() } />
				</>
			);
		}
		const { user, connector } = renderWithProviders( <WithGuide /> );
		await user.click( await screen.findByRole( 'button', { name: 'Open guide' } ) );
		await screen.findByRole( 'dialog', { name: 'Guide' } );
		expect( screen.queryByRole( 'dialog', { name: 'Try Annotate' } ) ).not.toBeInTheDocument();
		expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Guide' } ) ).not.toBeInTheDocument()
		);
		await user.hover( screen.getByRole( 'button', { name: 'Annotate' } ) );
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
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
		}
	);

	it( 'honors saved dismissal on a fresh mount', async () => {
		const connector = createFakeConnector(
			{},
			{ getOnboardingHints: async () => ( { annotateHintDismissed: true } ) }
		);
		const { user } = renderWithProviders(
			<AnnotateButton active={ false } disabled={ false } onClick={ vi.fn() } />,
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

describe( 'batched annotation controls', () => {
	it( 'keeps the mode toggle available and deletes a note without editing it', async () => {
		const batch = {
			notes: [ { id: 'one', number: 1, comment: 'Soften the blue', images: [] } ],
			busy: false,
			onSend: vi.fn(),
			onReview: vi.fn( () => true ),
			onEdit: vi.fn(),
			onClear: vi.fn(),
			onDelete: vi.fn(),
		};
		const { user, button, onClick } = await setup( { active: true, batch } );
		expect( button ).toHaveAttribute( 'aria-pressed', 'true' );
		await user.click( button );
		expect( onClick ).toHaveBeenCalledOnce();
		expect( screen.getByRole( 'button', { name: 'Send 1 annotation' } ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Send 1 annotation' } ) );
		expect( batch.onSend ).toHaveBeenCalledOnce();
		expect( batch.onReview ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: 'Review annotations' } ) );
		await user.click( await screen.findByRole( 'button', { name: 'Delete annotation 1' } ) );
		expect( batch.onDelete ).toHaveBeenCalledExactlyOnceWith( 'one' );
		expect( batch.onEdit ).not.toHaveBeenCalled();
		expect( batch.onSend ).toHaveBeenCalledOnce();
	} );
} );
