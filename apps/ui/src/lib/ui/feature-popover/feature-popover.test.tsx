import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Button, FeaturePopover } from '@/lib/ui';
import { renderWithProviders } from '@/test/render';

it( 'renders accessible copy and forwards the footer actions', async () => {
	const onNext = vi.fn();
	const onSkip = vi.fn();
	const { user } = renderWithProviders(
		<FeaturePopover.Root>
			<FeaturePopover.Trigger render={ <Button>Annotate</Button> } />

			<FeaturePopover.Popup
				title="Try Annotate"
				description="Point to anything and describe what you want to change."
				footer={
					<FeaturePopover.Navigation stepLabel="1 of 2" onNext={ onNext } onSkip={ onSkip } />
				}
			/>
		</FeaturePopover.Root>
	);
	await user.click( await screen.findByRole( 'button', { name: 'Annotate' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: 'Try Annotate' } );
	expect( dialog ).toHaveAccessibleDescription(
		'Point to anything and describe what you want to change.'
	);
	expect( within( dialog ).queryByText( 'New' ) ).not.toBeInTheDocument();
	expect( within( dialog ).getByRole( 'status' ) ).toHaveTextContent( '1 of 2' );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Next' } ) );
	expect( onNext ).toHaveBeenCalledOnce();
	await user.click( within( dialog ).getByRole( 'button', { name: 'Skip' } ) );
	expect( onSkip ).toHaveBeenCalledOnce();
} );

it( 'renders an optional announcement badge and forwards dismissal', async () => {
	const onDismiss = vi.fn();
	const { user } = renderWithProviders(
		<FeaturePopover.Root>
			<FeaturePopover.Trigger render={ <Button>Annotate</Button> } />
			<FeaturePopover.Popup
				title="Try Annotate"
				description="Leave a note."
				badge="New"
				onDismiss={ onDismiss }
			/>
		</FeaturePopover.Root>
	);
	await user.click( await screen.findByRole( 'button', { name: 'Annotate' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: 'Try Annotate' } );
	expect( within( dialog ).getByText( 'New' ) ).toBeVisible();
	await user.click( within( dialog ).getByRole( 'button', { name: 'Dismiss tip' } ) );
	expect( onDismiss ).toHaveBeenCalledOnce();
} );
