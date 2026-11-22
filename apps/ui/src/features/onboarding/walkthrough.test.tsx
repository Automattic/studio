import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiSettings, createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderApp, renderWithProviders } from '@/test/render';
import { Walkthrough } from './walkthrough';
import type { OnboardingHintsState } from '@/data/core';

afterEach( () => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	localStorage.removeItem( 'studio-ui-sidebar-collapsed' );
} );

function setup(
	initial: OnboardingHintsState,
	{ annotate = true, sites = [ makeSite() ], signedIn = true } = {}
) {
	vi.stubGlobal(
		'fetch',
		vi.fn( async () =>
			Response.json( {
				blueprints: [
					{
						slug: 'substrata',
						title: 'Substrata',
						excerpt: 'A starting design',
						image: 'https://example.test/substrata.jpg',
						playground_url: 'https://playground.test/substrata',
						blueprint: { steps: [] },
					},
				],
			} )
		)
	);
	let hints = { ...initial };
	const connector = createFakeConnector(
		{ sites, user: signedIn ? TEST_USER : null },
		{
			getOnboardingHints: async () => hints,
			setOnboardingHints: async ( patch ) => {
				hints = { ...hints, ...patch };
			},
		}
	);
	connector.capabilities.annotatePreview = annotate;
	return { connector, readHints: () => hints };
}

function Targets( { onAction }: { onAction?: () => void } ) {
	return (
		<>
			<textarea aria-label="Message" data-walkthrough="composer" />
			<button data-walkthrough="annotate">Annotate</button>
			<button data-walkthrough="publish" onClick={ onAction }>
				Publish
			</button>
			<Walkthrough />
		</>
	);
}

function InteractiveTargets() {
	const [ active, setActive ] = useState( false );
	return (
		<>
			<input aria-label="Other UI" />
			<textarea aria-label="Message" data-walkthrough="composer" />
			<span data-walkthrough="annotate">
				<button aria-pressed={ active } onClick={ () => setActive( ! active ) }>
					Annotate
				</button>
			</span>
			<button data-walkthrough="publish">Publish</button>
			<Walkthrough />
		</>
	);
}

describe( 'first-time walkthrough', () => {
	it( 'introduces all workspace steps without running actions and persists completion', async () => {
		const { connector, readHints } = setup( {
			walkthroughStep: 'composer',
			whatsNewSeenVersion: 10,
		} );
		const onAction = vi.fn();
		const { user } = renderWithProviders( <Targets onAction={ onAction } />, { connector } );
		expect( await screen.findByRole( 'dialog', { name: 'Chat with your site' } ) ).toBeVisible();
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Skip tour' } ) ).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		const annotate = await screen.findByRole( 'dialog', {
			name: 'Point to what you want to change',
		} );
		await user.click( within( annotate ).getByRole( 'button', { name: 'Next' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } ) ).toBeVisible();
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'completed' ) );
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toHaveFocus();
		expect( onAction ).not.toHaveBeenCalled();
		expect( readHints().whatsNewSeenVersion ).toBe( 10 );
		const views = connector.trackEvent.mock.calls.filter(
			( [ event ] ) => event === TRACKS_EVENTS.WALKTHROUGH_STEP_VIEWED
		);
		expect( views.map( ( [ , props ] ) => props?.step ) ).toEqual( [
			'composer',
			'annotate',
			'publish',
		] );
		expect( new Set( views.map( ( [ , props ] ) => props?.attempt_id ) ).size ).toBe( 1 );
		expect( connector.trackEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.WALKTHROUGH_ACTION,
			expect.objectContaining( { step: 'publish', action: 'next', outcome: 'completed' } )
		);
	} );

	it.each( [ 'Send message', 'Done' ] )( 'finishes the tour with %s', async ( action ) => {
		const { connector, readHints } = setup( { walkthroughStep: 'publish' } );
		const { user } = renderApp( { connector, path: '/sites/site-1/new' } );
		const publish = await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } );
		await user.click( await within( publish ).findByRole( 'button', { name: 'Next' } ) );
		const tip = await screen.findByRole( 'dialog', { name: 'Ask what’s possible' } );
		expect( connector.continueSession ).not.toHaveBeenCalled();
		await user.click( within( tip ).getByRole( 'button', { name: action } ) );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'completed' ) );
		if ( action === 'Done' ) {
			expect( connector.continueSession ).not.toHaveBeenCalled();
		} else {
			await waitFor( () =>
				expect( connector.continueSession ).toHaveBeenCalledExactlyOnceWith(
					expect.any( String ),
					'What can you do?',
					expect.anything()
				)
			);
			await waitFor( () =>
				expect( connector.trackEvent ).toHaveBeenCalledWith(
					TRACKS_EVENTS.WALKTHROUGH_ACTION,
					expect.objectContaining( {
						step: 'try-chat',
						action: 'prompt_result',
						outcome: 'sent',
					} )
				)
			);
		}
	} );

	it( 'waits for chat readiness before resuming the saved final step', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'try-chat' } );
		const quota = await connector.getStudioAssistantQuota();
		connector.getStudioAssistantQuota.mockClear();
		let finishLoading: () => void = () => {};
		connector.getStudioAssistantQuota.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finishLoading = () => resolve( quota );
				} )
		);
		renderApp( { connector, path: '/sites/site-1/new' } );
		await waitFor( () => expect( connector.getStudioAssistantQuota ).toHaveBeenCalled() );
		await act( async () => finishLoading() );
		expect( await screen.findByRole( 'dialog', { name: 'Ask what’s possible' } ) ).toBeVisible();
		expect( readHints().walkthroughStep ).toBe( 'try-chat' );
		expect( connector.continueSession ).not.toHaveBeenCalled();
	} );

	it( 'resumes a saved annotation tip without opening the preview', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'annotate' } );
		renderWithProviders( <Targets />, { connector } );
		expect(
			await screen.findByRole( 'dialog', { name: 'Point to what you want to change' } )
		).toBeVisible();
		expect( readHints().walkthroughStep ).toBe( 'annotate' );
		expect( connector.startSite ).not.toHaveBeenCalled();
	} );

	it( 'ends the whole walkthrough with Escape', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'composer' } );
		const { user, unmount } = renderWithProviders( <Targets />, { connector } );
		const tip = await screen.findByRole( 'dialog', { name: 'Chat with your site' } );
		within( tip ).getByRole( 'button', { name: 'Next' } ).focus();
		await user.keyboard( '{Escape}' );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'skipped' ) );
		expect( connector.trackEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.WALKTHROUGH_ACTION,
			expect.objectContaining( { step: 'composer', action: 'escape', outcome: 'skipped' } )
		);
		unmount();
		renderWithProviders( <Targets />, { connector } );
		await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalledTimes( 2 ) );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'offers Skip tour on the opening step and preserves dismissal after relaunch', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user, unmount } = renderApp( { connector, path: '/sites?addSite=create' } );
		const introduction = await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( within( introduction ).getByRole( 'button', { name: 'Skip tour' } ) );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'skipped' ) );
		unmount();
		connector.getOnboardingHints.mockClear();
		renderApp( { connector, path: '/sites?addSite=create' } );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
		await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalled() );
		expect(
			screen.queryByRole( 'dialog', { name: 'Start from scratch' } )
		).not.toBeInTheDocument();
	} );

	it.each( [ undefined, 'ineligible', 'completed', 'skipped' ] as const )(
		'does not autostart for %s profiles',
		async ( walkthroughStep ) => {
			const { connector } = setup( { walkthroughStep } );
			renderWithProviders( <Targets />, { connector } );
			await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalled() );
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		}
	);

	it( 'introduces creation choices without selecting or creating a site', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		const introduction = await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		expect( within( introduction ).getByRole( 'button', { name: 'Skip tour' } ) ).toBeVisible();
		expect( within( introduction ).queryByRole( 'status' ) ).not.toBeInTheDocument();
		within( introduction ).getByRole( 'button', { name: 'Next' } ).focus();
		await user.keyboard( '{Enter}' );
		const designTip = await screen.findByRole( 'dialog', { name: 'Start with a design' } );
		expect(
			within( designTip ).queryByRole( 'button', { name: 'Skip tour' } )
		).not.toBeInTheDocument();
		expect( within( designTip ).queryByRole( 'status' ) ).not.toBeInTheDocument();
		await user.click( within( designTip ).getByRole( 'button', { name: 'Browse designs' } ) );
		await waitFor( () => expect( designTip ).not.toBeInTheDocument() );
		expect( screen.getByRole( 'button', { name: 'View Substrata' } ) ).toHaveFocus();
		expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeVisible();
		expect( screen.queryByLabelText( 'Site name' ) ).not.toBeInTheDocument();
		expect( readHints().walkthroughStep ).toBe( 'create' );
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it.each( [ 'Connect', 'Import' ] )(
		'keeps %s available without touring the tab',
		async ( tab ) => {
			const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
			const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
			await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
			if ( tab === 'Import' ) {
				await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
				await screen.findByRole( 'dialog', { name: 'Start with a design' } );
			}
			await user.click( screen.getByRole( 'tab', { name: tab } ) );
			expect(
				screen.queryByRole( 'dialog', { name: 'Start from scratch' } )
			).not.toBeInTheDocument();
			expect(
				screen.queryByRole( 'dialog', { name: 'Start with a design' } )
			).not.toBeInTheDocument();
			expect( readHints().walkthroughStep ).toBe( 'create' );
			expect( connector.createSite ).not.toHaveBeenCalled();
			await user.click( screen.getByRole( 'tab', { name: 'New' } ) );
			expect(
				await screen.findByRole( 'dialog', {
					name: tab === 'Connect' ? 'Start from scratch' : 'Start with a design',
				} )
			).toBeVisible();
		}
	);

	it( 'continues to Blank site when blueprints are unavailable', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		vi.mocked( fetch ).mockResolvedValue( Response.json( { blueprints: [] } ) );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		const tip = await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( within( tip ).getByRole( 'button', { name: 'Got it' } ) );
		await waitFor( () => expect( tip ).not.toBeInTheDocument() );
		expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toHaveFocus();
		expect( readHints().walkthroughStep ).toBe( 'create' );
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'returns to creation guidance when leaving Blueprint details', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( screen.getByRole( 'button', { name: 'View Substrata' } ) );
		await screen.findByRole( 'dialog', { name: 'Make it yours' } );
		await user.click( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Start from scratch' } ) ).toBeVisible();
		expect( readHints().walkthroughStep ).toBe( 'create' );
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it.each( [ 'blank', 'blueprint' ] )(
		'continues from %s site creation to the composer',
		async ( source ) => {
			const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
			const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
			await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
			if ( source === 'blueprint' ) {
				await user.click( await screen.findByRole( 'button', { name: 'View Substrata' } ) );
				const blueprintTip = await screen.findByRole( 'dialog', {
					name: 'Make it yours',
				} );
				await user.click(
					within( blueprintTip ).getByRole( 'button', { name: 'Start with this site' } )
				);
				expect(
					await screen.findByRole( 'dialog', { name: 'Chat with your site' } )
				).toBeVisible();
				expect( readHints().walkthroughStep ).toBe( 'composer' );
				expect( connector.createSite ).toHaveBeenCalledTimes( 1 );
				return;
			}
			await user.click( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) );
			await screen.findByLabelText( 'Site name' );
			expect( screen.queryByRole( 'dialog', { name: 'Make it yours' } ) ).not.toBeInTheDocument();
			expect( readHints().walkthroughStep ).toBe( 'create' );
			const create = screen.getByRole( 'button', { name: 'Add site' } );
			await waitFor( () => expect( create ).toBeEnabled() );
			await user.click( create );
			expect( await screen.findByRole( 'dialog', { name: 'Chat with your site' } ) ).toBeVisible();
			expect( readHints().walkthroughStep ).toBe( 'composer' );
			expect( connector.createSite ).toHaveBeenCalledTimes( 1 );
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
		}
	);

	it( 'resumes the tour after a successful creation retry', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		connector.createSite.mockRejectedValueOnce( new Error( 'Could not create the site.' ) );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await user.click( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) );
		const create = screen.getByRole( 'button', { name: 'Add site' } );
		await waitFor( () => expect( create ).toBeEnabled() );
		await user.click( create );
		await waitFor( () => expect( connector.createSite ).toHaveBeenCalledTimes( 1 ) );
		await waitFor( () => expect( create ).toBeEnabled() );
		expect( readHints().walkthroughStep ).toBe( 'create' );
		await user.click( create );
		expect( await screen.findByRole( 'dialog', { name: 'Chat with your site' } ) ).toBeVisible();
		expect( connector.createSite ).toHaveBeenCalledTimes( 2 );
		expect( readHints().walkthroughStep ).toBe( 'composer' );
	} );

	it( 'Escape skips the introduction without closing site creation', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		screen.getByRole( 'button', { name: 'Skip tour' } ).focus();
		await user.keyboard( '{Escape}' );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'skipped' ) );
		expect( screen.getByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
	} );

	it( 'allows typing and other UI while a walkthrough tip is open', async () => {
		const { connector } = setup( { walkthroughStep: 'composer' } );
		const { user } = renderWithProviders( <InteractiveTargets />, { connector } );
		await screen.findByRole( 'dialog', { name: 'Chat with your site' } );
		await user.type( screen.getByRole( 'textbox', { name: 'Message' } ), 'Make a portfolio' );
		expect( screen.getByRole( 'textbox', { name: 'Message' } ) ).toHaveValue( 'Make a portfolio' );
		await user.type( screen.getByRole( 'textbox', { name: 'Other UI' } ), 'still works' );
		expect( screen.getByRole( 'textbox', { name: 'Other UI' } ) ).toHaveValue( 'still works' );
	} );

	it( 'pauses publishing guidance during annotation mode and resumes after exiting', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'composer' } );
		const { user } = renderWithProviders( <InteractiveTargets />, { connector } );
		await screen.findByRole( 'dialog', { name: 'Chat with your site' } );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		await screen.findByRole( 'dialog', { name: 'Point to what you want to change' } );
		await user.click( screen.getByRole( 'button', { name: 'Annotate' } ) );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'publish' ) );
		expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(
			screen.queryByRole( 'dialog', { name: 'Publish your WordPress' } )
		).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Annotate' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } ) ).toBeVisible();
	} );

	it( 'guides a signed-out user to connect and preserves the step when settings close', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'composer' }, { signedIn: false } );
		const { user } = renderApp( { connector, path: '/sites/site-1/new' } );
		const connectionTip = await screen.findByRole( 'dialog', { name: 'Get ready to chat' } );
		await waitFor( () =>
			expect( connector.trackEvent ).toHaveBeenCalledWith(
				TRACKS_EVENTS.WALKTHROUGH_STEP_VIEWED,
				expect.objectContaining( { step: 'composer', variant: 'connect' } )
			)
		);
		expect( within( connectionTip ).queryByRole( 'status' ) ).not.toBeInTheDocument();
		expect( connectionTip ).toHaveTextContent(
			'Sign in with your AI subscription or start with WordPress.com. Chat to make changes.'
		);
		await user.click(
			within( screen.getByRole( 'dialog', { name: 'Get ready to chat' } ) ).getByRole( 'button', {
				name: 'Connect',
			} )
		);
		await screen.findByRole( 'dialog', { name: 'Settings' } );
		const providerTip = await screen.findByRole( 'dialog', {
			name: 'Connect with WordPress.com',
		} );
		expect( providerTip ).toHaveTextContent(
			'Sign in or create a free account to start making changes to your site through chat.'
		);
		await user.click( within( providerTip ).getByRole( 'button', { name: 'Got it' } ) );
		expect(
			within( screen.getByRole( 'group', { name: 'AI providers' } ) ).getByRole( 'button', {
				name: 'Connect to WordPress.com',
			} )
		).toHaveFocus();
		expect( screen.queryByRole( 'dialog', { name: 'Get ready to chat' } ) ).not.toBeInTheDocument();
		expect( readHints().walkthroughStep ).toBe( 'composer' );
		await user.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Get ready to chat' } ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		const publish = await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } );
		expect( publish ).toHaveTextContent(
			'Share a preview to get feedback, or publish your site so anyone can discover it.'
		);
	} );

	it( 'resumes the tour after connecting WordPress.com from the tour', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'composer' }, { signedIn: false } );
		let finishSelecting: () => void = () => {};
		connector.setAiProvider.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finishSelecting = () => resolve( aiSettings( 'wpcom', [ 'wpcom' ] ) );
				} )
		);
		const { user } = renderApp( { connector, path: '/sites/site-1/new' } );
		await screen.findByRole( 'dialog', { name: 'Get ready to chat' } );
		await user.click(
			within( screen.getByRole( 'dialog', { name: 'Get ready to chat' } ) ).getByRole( 'button', {
				name: 'Connect',
			} )
		);
		const providerTip = await screen.findByRole( 'dialog', { name: 'Connect with WordPress.com' } );
		await user.click( within( providerTip ).getByRole( 'button', { name: 'Got it' } ) );
		await user.click(
			within( screen.getByRole( 'group', { name: 'AI providers' } ) ).getByRole( 'button', {
				name: 'Connect to WordPress.com',
			} )
		);

		await waitFor( () => expect( connector.setAiProvider ).toHaveBeenCalledWith( 'wpcom' ) );
		expect( screen.getByRole( 'dialog', { name: 'Settings' } ) ).toBeVisible();
		await act( async () => finishSelecting() );
		await waitFor( () => {
			expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument();
		} );
		expect( readHints().walkthroughStep ).toBe( 'composer' );
		expect( await screen.findByRole( 'dialog', { name: 'Chat with your site' } ) ).toBeVisible();
		expect( connector.trackEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.WALKTHROUGH_ACTION,
			expect.objectContaining( {
				step: 'wpcom-connect',
				action: 'authenticated',
				outcome: 'resumed',
			} )
		);
	} );

	it( 'continues a saved sharing step at Publish', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'share' }, { signedIn: false } );
		renderApp( { connector, path: '/sites/site-1/new' } );
		expect( await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } ) ).toBeVisible();
		expect( readHints().walkthroughStep ).toBe( 'publish' );
	} );

	it.each( [
		{
			title: 'Out of credits',
			quota: { allowanceRemaining: 0, purchasedRemaining: 0 },
			message: 'Add AI credits to keep the conversation going.',
		},
		{
			title: 'Add a payment method',
			quota: { hasPaymentMethod: false },
			message: 'WordPress.com AI needs a payment method on file',
		},
		{
			title: 'Join the beta',
			quota: { studioCodeAiHasAccess: false },
			message: 'access',
		},
		{
			title: 'Thanks for testing the beta',
			quota: { studioCodeAiHasAccess: false, costUsage: 1 },
			message: 'Apply again to keep going.',
		},
		{
			title: 'Switch providers',
			quota: { studioCodeAiHasAccess: false, studioCodeAiAccess: 'blocked' as const },
			message: 'Your current provider isn’t available here.',
		},
	] )(
		'points to the existing access action for $title ($message)',
		async ( { title, quota, message } ) => {
			const { connector } = setup( { walkthroughStep: 'composer' } );
			connector.getStudioAssistantQuota.mockResolvedValue( {
				costResetDate: undefined,
				studioCodeAiHasAccess: undefined,
				studioCodeAiAccess: undefined,
				purchasedAtTopUp: undefined,
				allowanceRemaining: undefined,
				purchasedRemaining: undefined,
				costUsage: 0,
				costCap: 100,
				emailVerified: true,
				hasPaymentMethod: true,
				...quota,
			} );
			const { user } = renderApp( { connector, path: '/sites/site-1/new' } );
			const tip = await screen.findByRole( 'dialog', { name: title } );
			expect( tip ).toHaveTextContent( message );
			expect( within( tip ).queryByRole( 'status' ) ).not.toBeInTheDocument();
			await user.click( within( tip ).getByRole( 'button', { name: 'Next' } ) );
			expect(
				await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } )
			).toBeVisible();
		}
	);

	it.each( [
		[ 'provider', 'Couldn’t reach your provider', 'check your provider settings' ],
		[ 'quota', 'AI is unavailable right now', 'Give it a moment, then try again.' ],
		[ 'offline', 'You’re offline', 'Reconnect to send your first prompt.' ],
	] )( 'names the %s interruption without tour progress', async ( kind, title, description ) => {
		const { connector } = setup( { walkthroughStep: 'composer' } );
		if ( kind === 'provider' ) {
			connector.getAiSettings.mockRejectedValue( new Error( 'Provider unavailable' ) );
		} else {
			connector.getStudioAssistantQuota.mockRejectedValue(
				new Error( kind === 'offline' ? 'offline' : 'Quota unavailable' )
			);
		}
		renderApp( { connector, path: '/sites/site-1/new' } );
		const tip = await screen.findByRole( 'dialog', { name: title } );
		expect( tip ).toHaveTextContent( description );
		expect( within( tip ).queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );

	it( 'changes to prompting when the provider becomes ready', async () => {
		const { connector } = setup(
			{ walkthroughStep: 'composer' },
			{ signedIn: false, sites: [ makeSite( { running: true } ) ] }
		);
		const { queryClient } = renderApp( { connector, path: '/sites/site-1/new' } );
		await screen.findByRole( 'dialog', { name: 'Get ready to chat' } );
		await act( async () => {
			const settings = aiSettings( 'anthropic', [ 'anthropic' ] );
			connector.getAiSettings.mockResolvedValue( settings );
			await queryClient.invalidateQueries( { queryKey: [ 'ai-settings' ] } );
		} );
		const readyTip = await screen.findByRole( 'dialog', { name: 'Chat with your site' } );
		expect( readyTip ).toBeVisible();
	} );

	it( 'continues to publishing when the site is stopped and has no annotation toolbar', async () => {
		const { connector } = setup( { walkthroughStep: 'composer' } );
		const { user } = renderApp( { connector, path: '/sites/site-1/new' } );
		await screen.findByRole( 'dialog', { name: 'Chat with your site' } );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } ) ).toBeVisible();
		expect( connector.startSite ).not.toHaveBeenCalled();
	} );

	it.each( [ 1280, 800 ] )(
		'leaves the sidebar under user control during the introduction at %ipx',
		async ( width ) => {
			vi.stubGlobal( 'innerWidth', width );
			localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
			const { connector, readHints } = setup( { walkthroughStep: 'intro' } );
			const { user } = renderApp( { connector, path: '/sites/site-1' } );
			expect( await screen.findByRole( 'dialog', { name: 'Open the sidebar' } ) ).toBeVisible();
			expect( screen.queryByRole( 'dialog', { name: 'Sidebar' } ) ).not.toBeInTheDocument();
			expect(
				screen.queryByRole( 'separator', { name: 'Resize sidebar' } )
			).not.toBeInTheDocument();
			expect( localStorage.getItem( 'studio-ui-sidebar-collapsed' ) ).toBe( 'true' );
			await user.click(
				within( screen.getByRole( 'main' ) ).getByRole( 'button', { name: 'Show sidebar' } )
			);
			expect( await screen.findByRole( 'dialog', { name: 'Add a new site' } ) ).toBeVisible();
			const hideSidebar = screen
				.getAllByRole( 'button', { name: 'Hide sidebar' } )
				.find( ( button ) => ! button.closest( '[inert]' ) );
			await user.click( hideSidebar! );
			const intro = await screen.findByRole( 'dialog', { name: 'Open the sidebar' } );
			expect( readHints().walkthroughStep ).toBe( 'intro' );
			expect( screen.queryByRole( 'dialog', { name: 'Sidebar' } ) ).not.toBeInTheDocument();
			expect(
				screen.queryByRole( 'separator', { name: 'Resize sidebar' } )
			).not.toBeInTheDocument();
			await user.click( within( intro ).getByRole( 'button', { name: 'Skip tour' } ) );
			await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'skipped' ) );
			expect( localStorage.getItem( 'studio-ui-sidebar-collapsed' ) ).toBe( 'true' );
			expect( connector.createSite ).not.toHaveBeenCalled();
		}
	);

	it.each( [ 1280, 800 ] )(
		'tours site options before returning to an existing workspace at %ipx',
		async ( width ) => {
			vi.stubGlobal( 'innerWidth', width );
			localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
			const { connector, readHints } = setup( { walkthroughStep: 'ineligible' } );
			const { history, user } = renderApp( { connector, path: '/sites/site-1' } );
			await waitFor( () => expect( connector.listenerCount( 'onShowGettingStarted' ) ).toBe( 1 ) );
			act( () => connector.emit( 'onShowGettingStarted' ) );
			const sidebarTip = await screen.findByRole( 'dialog', { name: 'Open the sidebar' } );
			await waitFor( () =>
				expect( connector.trackEvent ).toHaveBeenCalledWith(
					TRACKS_EVENTS.WALKTHROUGH_STEP_VIEWED,
					expect.objectContaining( { step: 'intro', source: 'replay', variant: 'sidebar_closed' } )
				)
			);
			within( sidebarTip ).getByRole( 'button', { name: 'Show sidebar' } ).focus();
			await user.keyboard( '{Enter}' );
			const intro = await screen.findByRole( 'dialog', { name: 'Add a new site' } );
			const addSite = screen
				.getAllByRole( 'button', { name: 'Add site' } )
				.find( ( button ) => ! button.closest( '[inert]' ) );
			await waitFor( () => expect( addSite ).toHaveFocus() );
			expect( within( intro ).getByRole( 'button', { name: 'Skip tour' } ) ).toBeVisible();
			expect( history.location.pathname ).toBe( '/sites/site-1/new' );
			await user.keyboard( '{Enter}' );
			const fresh = await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
			expect(
				within( fresh ).queryByRole( 'button', { name: 'Skip tour' } )
			).not.toBeInTheDocument();
			await user.click( within( fresh ).getByRole( 'button', { name: 'Next' } ) );
			const design = await screen.findByRole( 'dialog', { name: 'Start with a design' } );
			await user.click( within( design ).getByRole( 'button', { name: 'Next' } ) );
			expect( await screen.findByRole( 'dialog', { name: 'Chat with your site' } ) ).toBeVisible();
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
			expect( readHints().walkthroughStep ).toBe( 'composer' );
			expect( history.location.pathname ).toBe( '/sites/site-1/new' );
			expect( connector.createSite ).not.toHaveBeenCalled();
			expect( connector.setOnboardingCompleted ).not.toHaveBeenCalled();
			expect( localStorage.getItem( 'studio-ui-sidebar-collapsed' ) ).toBe(
				width === 800 ? 'true' : 'false'
			);
		}
	);

	it( 'dismisses the Blueprint tip without leaving the details', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' } );
		const { user } = renderApp( { connector, path: '/sites/site-1/new?addSite=create' } );
		await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( screen.getByRole( 'button', { name: 'View Substrata' } ) );
		const tip = await screen.findByRole( 'dialog', {
			name: 'Make it yours',
		} );
		await user.click( within( tip ).getByRole( 'button', { name: 'Got it' } ) );
		expect( screen.queryByRole( 'dialog', { name: 'Make it yours' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toHaveFocus();
		expect( readHints().walkthroughStep ).toBe( 'create' );
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'reopens site creation when replaying without a site', async () => {
		const { connector } = setup( { walkthroughStep: 'skipped' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await user.click( await screen.findByRole( 'button', { name: 'Close Add site' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		act( () => connector.emit( 'onShowGettingStarted' ) );
		expect( await screen.findByRole( 'dialog', { name: 'Start from scratch' } ) ).toBeVisible();
	} );

	it( 'restores outside dismissal immediately after skipping the creation tour', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		const tip = await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( within( tip ).getByRole( 'button', { name: 'Skip tour' } ) );
		await waitFor( () => expect( tip ).not.toBeInTheDocument() );
		fireEvent.click(
			screen
				.getAllByRole( 'presentation', { hidden: true } )
				.find( ( element ) => element.dataset.variant === 'dimmed' )!
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
		);
		expect( readHints().walkthroughStep ).toBe( 'skipped' );
	} );

	it( 'replays a skipped tour from Help while site creation remains open', async () => {
		const { connector } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		const tip = await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( within( tip ).getByRole( 'button', { name: 'Skip tour' } ) );
		await waitFor( () => expect( tip ).not.toBeInTheDocument() );
		act( () => connector.emit( 'onShowGettingStarted' ) );
		expect( await screen.findByRole( 'dialog', { name: 'Start from scratch' } ) ).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'replays the introduction from command search after continuing to browse', async () => {
		const { connector } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		const tip = await screen.findByRole( 'dialog', { name: 'Start with a design' } );
		await user.click( within( tip ).getByRole( 'button', { name: 'Browse designs' } ) );
		await waitFor( () => expect( tip ).not.toBeInTheDocument() );
		const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
		fireEvent.keyDown( document, { key: 'k', code: 'KeyK', metaKey: isApple, ctrlKey: ! isApple } );
		await user.type(
			await screen.findByRole( 'combobox', { name: 'Search commands' } ),
			'Take a tour'
		);
		await user.click( screen.getByRole( 'option', { name: 'Take a tour' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Start from scratch' } ) ).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );
} );
