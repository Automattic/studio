import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCreditsPurchasedNotice } from 'src/components/ai-credits-purchased-notice';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { setAiCreditsAdded } from 'src/stores/ui-slice';

vi.mock( 'src/stores', () => ( {
	useAppDispatch: vi.fn(),
	useRootSelector: vi.fn(),
	useI18nLocale: () => 'en',
} ) );

const dispatch = vi.fn();

function mockState( creditsAdded: number | null ) {
	vi.mocked( useRootSelector ).mockImplementation( ( selector ) =>
		selector( { ui: { aiCreditsAdded: creditsAdded } } as never )
	);
}

describe( 'AiCreditsPurchasedNotice', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useAppDispatch, { partial: true } ).mockReturnValue( dispatch );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'shows nothing until a purchase is confirmed', () => {
		mockState( null );
		render( <AiCreditsPurchasedNotice /> );

		expect( screen.queryByText( /AI credits added/ ) ).not.toBeInTheDocument();
	} );

	it( 'reports the credits the purchase added', () => {
		mockState( 500000 );
		render( <AiCreditsPurchasedNotice /> );

		expect( screen.getByText( '500,000 AI credits added' ) ).toBeInTheDocument();
	} );

	it( 'clears itself on dismiss', async () => {
		mockState( 500000 );
		render( <AiCreditsPurchasedNotice /> );
		await userEvent.click( screen.getByRole( 'button', { name: 'Dismiss' } ) );

		expect( dispatch ).toHaveBeenCalledWith( setAiCreditsAdded( null ) );
	} );

	it( 'clears itself once it has been read', () => {
		vi.useFakeTimers();
		mockState( 500000 );
		render( <AiCreditsPurchasedNotice /> );

		expect( dispatch ).not.toHaveBeenCalled();
		act( () => {
			vi.advanceTimersByTime( 8000 );
		} );
		expect( dispatch ).toHaveBeenCalledWith( setAiCreditsAdded( null ) );
	} );
} );
