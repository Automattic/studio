import { screen, waitFor, within } from '@testing-library/react';
import { useId, useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button, FeaturePopover } from '@/lib/ui';
import { renderWithProviders } from '@/test/render';

function Walkthrough() {
	const [ step, setStep ] = useState< 0 | 1 | null >( null );
	const firstId = useId();
	const secondId = useId();
	const next = useRef< HTMLButtonElement >( null );
	const start = useRef< HTMLButtonElement >( null );
	return (
		<>
			<Button ref={ start } onClick={ () => setStep( 0 ) }>
				Start walkthrough
			</Button>
			<FeaturePopover.Root
				open={ step !== null }
				triggerId={ step === 1 ? secondId : firstId }
				onOpenChange={ ( open, details ) => {
					if ( details.reason !== 'trigger-press' && ! open ) setStep( null );
				} }
			>
				<FeaturePopover.Target highlighted={ step === 0 } aria-label="First target">
					<FeaturePopover.Trigger id={ firstId } render={ <Button>Annotate</Button> } />
				</FeaturePopover.Target>
				<FeaturePopover.Target highlighted={ step === 1 } aria-label="Second target">
					<FeaturePopover.Trigger id={ secondId } render={ <Button>Publish</Button> } />
				</FeaturePopover.Target>
				<FeaturePopover.Popup
					title={ step === 1 ? 'Publish your site' : 'Try Annotate' }
					description="A guided step."
					initialFocus={ next }
					finalFocus={ start }
					footer={
						<FeaturePopover.Navigation
							stepLabel={ `${ ( step ?? 0 ) + 1 } of 2` }
							nextLabel={ step === 1 ? 'Done' : 'Next' }
							onNext={ () => setStep( step === 0 ? 1 : null ) }
							onSkip={ () => setStep( null ) }
							nextButtonRef={ next }
						/>
					}
				/>
			</FeaturePopover.Root>
		</>
	);
}

describe( 'Feature popovers', () => {
	it( 'advances between anchored steps, keeps focus on Next, and returns focus on completion', async () => {
		const { user } = renderWithProviders( <Walkthrough /> );
		const start = await screen.findByRole( 'button', { name: 'Start walkthrough' } );
		await user.click( start );
		const first = await screen.findByRole( 'dialog', { name: 'Try Annotate' } );
		expect( within( first ).getByRole( 'status' ) ).toHaveTextContent( '1 of 2' );
		expect(
			screen.getByRole( 'button', { name: 'Annotate' } ).closest( '[data-highlighted]' )
		).not.toBeNull();
		expect(
			screen.getByRole( 'button', { name: 'Publish' } ).closest( '[data-highlighted]' )
		).toBeNull();
		await waitFor( () =>
			expect( within( first ).getByRole( 'button', { name: 'Next' } ) ).toHaveFocus()
		);
		await user.hover( start );
		expect( first ).toBeVisible();
		await user.keyboard( '{Enter}' );
		const second = await screen.findByRole( 'dialog', { name: 'Publish your site' } );
		expect( within( second ).getByRole( 'status' ) ).toHaveTextContent( '2 of 2' );
		expect(
			screen.getByRole( 'button', { name: 'Annotate' } ).closest( '[data-highlighted]' )
		).toBeNull();
		expect(
			screen.getByRole( 'button', { name: 'Publish' } ).closest( '[data-highlighted]' )
		).not.toBeNull();
		expect( within( second ).getByRole( 'button', { name: 'Done' } ) ).toHaveFocus();
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		await user.keyboard( '{Enter}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await waitFor( () => expect( start ).toHaveFocus() );
		expect( document.querySelector( '[data-highlighted]' ) ).toBeNull();
	} );

	it( 'allows skipping and Escape without completing the other steps', async () => {
		const { user } = renderWithProviders( <Walkthrough /> );
		await user.click( await screen.findByRole( 'button', { name: 'Start walkthrough' } ) );
		await user.click( await screen.findByRole( 'button', { name: 'Skip' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await user.click( await screen.findByRole( 'button', { name: 'Start walkthrough' } ) );
		await screen.findByRole( 'dialog' );
		await user.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	} );
} );
