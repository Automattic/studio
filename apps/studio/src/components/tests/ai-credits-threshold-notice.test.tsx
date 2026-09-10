import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCreditsThresholdNotice } from 'src/components/ai-credits-threshold-notice';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { setDismissedAiCreditsIntent } from 'src/stores/ui-slice';
import { useGetStudioAssistantQuota } from 'src/stores/wpcom-api';
import type { AiCreditsMeterIntent } from '@studio/common/lib/studio-assistant-quota';

vi.mock( 'src/stores', () => ( {
	useAppDispatch: vi.fn(),
	useRootSelector: vi.fn(),
	useI18nLocale: () => 'en',
} ) );
vi.mock( 'src/stores/wpcom-api', () => ( { useGetStudioAssistantQuota: vi.fn() } ) );
vi.mock( 'src/components/add-ai-credits-button', () => ( {
	AddAiCreditsButton: () => <button type="button">Add AI credits</button>,
} ) );

const dispatch = vi.fn();

// 1,000,000-credit allowance, nothing purchased.
function mockUsage( allowanceRemaining: number ) {
	vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
		data: { costUsage: 0, costCap: 1000000, allowanceRemaining, purchasedRemaining: undefined },
	} );
}

function mockState( {
	dismissedIntent = null,
}: { dismissedIntent?: AiCreditsMeterIntent | null } = {} ) {
	vi.mocked( useRootSelector ).mockImplementation( ( selector ) =>
		selector( { ui: { dismissedAiCreditsIntent: dismissedIntent } } as never )
	);
}

describe( 'AiCreditsThresholdNotice', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useAppDispatch, { partial: true } ).mockReturnValue( dispatch );
		mockState();
	} );

	it( 'warns at 80% usage, reporting the live figure', () => {
		mockUsage( 170000 );
		render( <AiCreditsThresholdNotice /> );

		expect( screen.getByText( 'At 83% usage' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toBeInTheDocument();
	} );

	// The quota arrives after the composer has rendered, so the notice has to
	// announce itself rather than wait to be found. Notice carries no role of
	// its own — it speaks into @wordpress/a11y's shared polite region instead.
	it( 'announces itself to screen readers', () => {
		mockUsage( 170000 );
		render( <AiCreditsThresholdNotice /> );

		expect( document.getElementById( 'a11y-speak-polite' )?.textContent ).toContain(
			'At 83% usage'
		);
	} );

	// Classic has no composer strip, so its one slot carries the 90% step too.
	it( 'escalates at 90% usage', () => {
		mockUsage( 100000 );
		render( <AiCreditsThresholdNotice /> );

		expect( screen.getByText( 'At 90% usage' ) ).toBeInTheDocument();
	} );

	it( 'shows nothing below 80%, or once the credits are spent', () => {
		mockUsage( 500000 );
		const { rerender } = render( <AiCreditsThresholdNotice /> );
		expect( screen.queryByText( /usage$/ ) ).not.toBeInTheDocument();

		mockUsage( 0 );
		rerender( <AiCreditsThresholdNotice /> );
		expect( screen.queryByText( /usage$/ ) ).not.toBeInTheDocument();
	} );

	it( 'records the dismissal against the threshold it was made at', async () => {
		const user = userEvent.setup();
		mockUsage( 200000 );
		render( <AiCreditsThresholdNotice /> );

		await user.click( screen.getByRole( 'button', { name: 'Dismiss' } ) );

		expect( dispatch ).toHaveBeenCalledWith( setDismissedAiCreditsIntent( 'warning' ) );
	} );

	it( 'stays hidden at a threshold already dismissed', () => {
		mockUsage( 200000 );
		mockState( { dismissedIntent: 'warning' } );
		render( <AiCreditsThresholdNotice /> );

		expect( screen.queryByText( 'At 80% usage' ) ).not.toBeInTheDocument();
	} );
} );
