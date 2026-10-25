import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { OnboardingGuideProvider } from './use-onboarding-guide';
import { useWhatsNewReplay } from './use-whats-new-replay';
import { WHATS_NEW_VERSION } from './whats-new';
import type { Connector } from '@/data/core';

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: () => ( { chatEnabled: false, isReady: true } ),
} ) );

function Replay() {
	useWhatsNewReplay();
	return null;
}

describe( 'useWhatsNewReplay', () => {
	it( 'opens the pages from Help ▸ What’s New and marks them seen when closed', async () => {
		let showWhatsNew = () => {};
		const setOnboardingHints = vi.fn().mockResolvedValue( undefined );
		const connector = {
			onShowWhatsNew: ( listener: () => void ) => {
				showWhatsNew = listener;
				return () => {};
			},
			setOnboardingHints,
		} as unknown as Connector;
		render(
			<QueryClientProvider client={ new QueryClient() }>
				<ConnectorProvider connector={ connector }>
					<OnboardingGuideProvider>
						<Replay />
					</OnboardingGuideProvider>
				</ConnectorProvider>
			</QueryClientProvider>
		);

		act( () => showWhatsNew() );

		expect(
			await screen.findByRole( 'dialog', { name: 'Meet the new WordPress Studio' } )
		).toBeVisible();
		// Chat is off, so the Studio Code page is left out.
		expect( screen.queryByText( 'Studio Code, right beside your site' ) ).not.toBeInTheDocument();

		await userEvent.click( screen.getByRole( 'button', { name: 'Skip' } ) );

		expect( setOnboardingHints ).toHaveBeenCalledWith( { whatsNewSeenVersion: WHATS_NEW_VERSION } );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );
} );
