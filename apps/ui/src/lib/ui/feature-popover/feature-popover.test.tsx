import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Button, FeaturePopover } from '@/lib/ui';
import { renderWithProviders } from '@/test/render';

it( 'renders accessible copy and forwards the footer actions', async () => {
	const onNext = vi.fn();
	const onSkip = vi.fn();
	const { user } = renderWithProviders(
		<FeaturePopover.Root>
			<FeaturePopover.Target highlighted>
				<FeaturePopover.Trigger render={ <Button>Annotate</Button> } />
			</FeaturePopover.Target>
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
	expect( within( dialog ).getByRole( 'status' ) ).toHaveTextContent( '1 of 2' );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Next' } ) );
	expect( onNext ).toHaveBeenCalledOnce();
	await user.click( within( dialog ).getByRole( 'button', { name: 'Skip' } ) );
	expect( onSkip ).toHaveBeenCalledOnce();
} );
