import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderApp, renderWithProviders } from '@/test/render';
import { Walkthrough } from './walkthrough';
import type { OnboardingHintsState } from '@/data/core';

afterEach( () => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
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

function Targets() {
	return (
		<>
			<textarea aria-label="Message" data-walkthrough="composer" />
			<button data-walkthrough="annotate">Annotate</button>
			<button data-walkthrough="share">Share</button>
			<button data-walkthrough="publish">Publish</button>
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
			<button data-walkthrough="share">Share</button>
			<button data-walkthrough="publish">Publish</button>
			<Walkthrough />
		</>
	);
}

describe( 'first-time walkthrough', () => {
	it( 'lets the site dialog settle and reveals a requested next tip immediately', async () => {
		vi.useFakeTimers();
		const { connector } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		renderApp( { connector, path: '/sites?addSite=create' } );
		await act( () => vi.advanceTimersByTimeAsync( 100 ) );
		expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'dialog', { name: 'Start from scratch' } )
		).not.toBeInTheDocument();
		await act( () => vi.advanceTimersByTimeAsync( 400 ) );
		expect( screen.getByRole( 'dialog', { name: 'Start from scratch' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
		await act( () => vi.advanceTimersByTimeAsync( 32 ) );
		expect( screen.getByRole( 'dialog', { name: 'Start with a design' } ) ).toBeVisible();
	} );

	it( 'cancels a pending tip when the user changes the creation route', async () => {
		vi.useFakeTimers();
		const { connector } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		renderApp( { connector, path: '/sites?addSite=create' } );
		await act( () => vi.advanceTimersByTimeAsync( 100 ) );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Connect' } ) );
		await act( () => vi.advanceTimersByTimeAsync( 500 ) );
		expect(
			screen.queryByRole( 'dialog', { name: 'Start from scratch' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'tab', { name: 'New' } ) );
		await act( () => vi.advanceTimersByTimeAsync( 100 ) );
		expect(
			screen.queryByRole( 'dialog', { name: 'Start from scratch' } )
		).not.toBeInTheDocument();
		await act( () => vi.advanceTimersByTimeAsync( 400 ) );
		expect( screen.getByRole( 'dialog', { name: 'Start from scratch' } ) ).toBeVisible();
	} );

	it( 'introduces all workspace steps without running actions and persists completion', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'composer' } );
		const { user } = renderWithProviders( <Targets />, { connector } );
		expect( await screen.findByRole( 'dialog', { name: 'Make any change' } ) ).toBeVisible();
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( '3/5' );
		expect( screen.queryByRole( 'button', { name: 'Skip tour' } ) ).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Share a preview' } ) ).toBeVisible();
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( '4/5' );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Publish when ready' } ) ).toBeVisible();
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( '5/5' );
		await user.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'completed' ) );
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toHaveFocus();
		expect( connector.authenticate ).not.toHaveBeenCalled();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );

	it( 'continues a saved annotation step at sharing without opening the preview', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'annotate' } );
		renderWithProviders( <Targets />, { connector } );
		expect( await screen.findByRole( 'dialog', { name: 'Share a preview' } ) ).toBeVisible();
		expect( readHints().walkthroughStep ).toBe( 'share' );
		expect( screen.queryByRole( 'dialog', { name: 'Point at it' } ) ).not.toBeInTheDocument();
		expect( connector.startSite ).not.toHaveBeenCalled();
	} );

	it( 'omits annotations when the host does not support them', async () => {
		const { connector } = setup( { walkthroughStep: 'composer' }, { annotate: false } );
		const { user } = renderWithProviders( <Targets />, { connector } );
		await screen.findByRole( 'dialog', { name: 'Make any change' } );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( '3/5' );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Share a preview' } ) ).toBeVisible();
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( '4/5' );
	} );

	it( 'ends the whole walkthrough with Escape', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'composer' } );
		const { user, unmount } = renderWithProviders( <Targets />, { connector } );
		const tip = await screen.findByRole( 'dialog', { name: 'Make any change' } );
		within( tip ).getByRole( 'button', { name: 'Next' } ).focus();
		await user.keyboard( '{Escape}' );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'skipped' ) );
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
		renderApp( { connector, path: '/sites?addSite=create' } );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
		await waitFor( () => expect( connector.getOnboardingHints ).toHaveBeenCalledTimes( 2 ) );
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

	it.each( [ 'Start with Blank site', 'View Substrata' ] )(
		'continues to the user’s choice of %s without selecting for them',
		async ( choice ) => {
			const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
			const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
			const introduction = await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
			expect( introduction ).toHaveTextContent(
				'A blank WordPress site, ready to become whatever you have in mind.'
			);
			expect( introduction ).toHaveTextContent( 'Connect it or import a backup instead.' );
			expect( within( introduction ).getByRole( 'button', { name: 'Skip tour' } ) ).toBeVisible();
			expect( within( introduction ).getByRole( 'status' ) ).toHaveTextContent( '1/5' );
			expect( within( introduction ).getAllByRole( 'button' ) ).toHaveLength( 2 );
			const action = within( introduction ).getByRole( 'button', { name: 'Next' } );
			action.focus();
			await user.keyboard( '{Enter}' );
			const designTip = await screen.findByRole( 'dialog', { name: 'Start with a design' } );
			expect( within( designTip ).getAllByRole( 'button' ) ).toHaveLength( 1 );
			expect( within( designTip ).getByRole( 'button', { name: 'Browse designs' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'View Substrata' } ) ).toHaveFocus();
			expect( screen.getByRole( 'status' ) ).toHaveTextContent( '2/5' );
			await user.click( screen.getByRole( 'button', { name: 'Browse designs' } ) );
			await waitFor( () =>
				expect(
					screen.queryByRole( 'dialog', { name: 'Start with a design' } )
				).not.toBeInTheDocument()
			);
			expect( screen.getByRole( 'button', { name: 'View Substrata' } ) ).toHaveFocus();
			expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'View Substrata' } ) ).toBeVisible();
			expect( screen.queryByLabelText( 'Site name' ) ).not.toBeInTheDocument();
			expect( readHints().walkthroughStep ).toBe( 'create' );
			expect( connector.createSite ).not.toHaveBeenCalled();
			await user.click( await screen.findByRole( 'button', { name: choice } ) );
			await waitFor( () =>
				expect(
					screen.queryByRole( 'dialog', { name: 'Start from scratch' } )
				).not.toBeInTheDocument()
			);
			expect( readHints().walkthroughStep ).toBe( 'create' );
			expect( screen.getByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
			expect( screen.queryByRole( 'dialog', { name: 'Make any change' } ) ).not.toBeInTheDocument();
			expect( connector.createSite ).not.toHaveBeenCalled();
			expect(
				await screen.findByRole( 'dialog', {
					name: 'Make it yours',
				} )
			).toBeVisible();
		}
	);

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

	it( 'guides blueprint creation and continues at the composer after creating', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( await screen.findByRole( 'button', { name: 'View Substrata' } ) );
		const tip = await screen.findByRole( 'dialog', { name: 'Make it yours' } );
		expect( tip ).toHaveTextContent(
			'Create a site with this design and its content, then shape it with prompts.'
		);
		expect( within( tip ).queryByRole( 'status' ) ).not.toBeInTheDocument();
		expect( within( tip ).getAllByRole( 'button' ) ).toHaveLength( 1 );
		expect( within( tip ).getByRole( 'button', { name: 'Got it' } ) ).toBeVisible();
		expect( readHints().walkthroughStep ).toBe( 'create' );
		await user.click( screen.getByRole( 'button', { name: 'Back to Blueprints' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Start from scratch' } ) ).toBeVisible();
		await user.click( await screen.findByRole( 'button', { name: 'View Substrata' } ) );
		const blueprintTip = await screen.findByRole( 'dialog', { name: 'Make it yours' } );
		const create = screen.getByRole( 'button', { name: 'Use Blueprint' } );
		within( blueprintTip ).getByRole( 'button', { name: 'Got it' } ).focus();
		await user.keyboard( '{Enter}' );
		await waitFor( () => expect( blueprintTip ).not.toBeInTheDocument() );
		expect( create ).toHaveFocus();
		expect( connector.createSite ).not.toHaveBeenCalled();
		expect( readHints().walkthroughStep ).toBe( 'create' );
		await user.keyboard( '{Enter}' );
		const setupTip = await screen.findByRole( 'dialog', { name: 'Make it yours' } );
		await user.click( within( setupTip ).getByRole( 'button', { name: 'Got it' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Make any change' } ) ).toBeVisible();
		expect( readHints().walkthroughStep ).toBe( 'composer' );
	} );

	it.each( [ 'blank', 'blueprint' ] )(
		'guides the %s setup CTA before continuing at the composer',
		async ( source ) => {
			const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
			const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
			await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
			if ( source === 'blueprint' ) {
				await user.click( await screen.findByRole( 'button', { name: 'View Substrata' } ) );
				connector.generateProposedSitePath.mockResolvedValueOnce( {
					path: '/sites/taken',
					isEmpty: false,
					isWordPress: true,
				} );
				const blueprintTip = await screen.findByRole( 'dialog', {
					name: 'Make it yours',
				} );
				await user.click( within( blueprintTip ).getByRole( 'button', { name: 'Got it' } ) );
				expect( screen.getByRole( 'button', { name: 'Use Blueprint' } ) ).toHaveFocus();
				await user.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
			} else {
				await user.click( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) );
			}
			await screen.findByLabelText( 'Site name' );
			const tip = await screen.findByRole( 'dialog', { name: 'Make it yours' } );
			expect( tip ).toHaveTextContent(
				'Create a fresh WordPress site, then shape it with prompts.'
			);
			expect( within( tip ).queryByRole( 'status' ) ).not.toBeInTheDocument();
			expect( within( tip ).getAllByRole( 'button' ) ).toHaveLength( 1 );
			expect(
				within( tip ).queryByRole( 'button', { name: 'Skip tour' } )
			).not.toBeInTheDocument();
			expect( readHints().walkthroughStep ).toBe( 'create' );
			expect( connector.createSite ).not.toHaveBeenCalled();
			await user.clear( screen.getByLabelText( 'Site name' ) );
			await user.type( screen.getByLabelText( 'Site name' ), 'My first site' );
			expect( tip ).toBeVisible();
			const create = screen.getByRole( 'button', { name: 'Add site' } );
			await waitFor( () => expect( create ).toBeEnabled() );
			await user.click( within( tip ).getByRole( 'button', { name: 'Got it' } ) );
			await waitFor( () => expect( tip ).not.toBeInTheDocument() );
			expect( create ).toHaveFocus();
			expect( connector.createSite ).not.toHaveBeenCalled();
			expect( readHints().walkthroughStep ).toBe( 'create' );
			await user.keyboard( '{Enter}' );
			expect( await screen.findByRole( 'dialog', { name: 'Make any change' } ) ).toBeVisible();
			expect( readHints().walkthroughStep ).toBe( 'composer' );
			expect( connector.createSite ).toHaveBeenCalledTimes( 1 );
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
		}
	);

	it.each( [ 'blank', 'blueprint' ] )(
		'keeps the %s creation tip dismissed after a failed attempt and retry',
		async ( source ) => {
			const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
			connector.createSite.mockRejectedValueOnce( new Error( 'Could not create the site.' ) );
			const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
			await user.click(
				await screen.findByRole( 'button', {
					name: source === 'blank' ? 'Start with Blank site' : 'View Substrata',
				} )
			);
			if ( source === 'blueprint' ) {
				const detailsTip = await screen.findByRole( 'dialog', { name: 'Make it yours' } );
				await user.click( within( detailsTip ).getByRole( 'button', { name: 'Got it' } ) );
				await user.click( screen.getByRole( 'button', { name: 'Use Blueprint' } ) );
			}
			const title = 'Make it yours';
			await screen.findByRole( 'dialog', { name: title } );
			const create = screen.getByRole( 'button', { name: 'Add site' } );
			await waitFor( () => expect( create ).toBeEnabled() );
			await user.click( create );
			await waitFor( () => expect( connector.createSite ).toHaveBeenCalledTimes( 1 ) );
			await waitFor( () => expect( create ).toBeEnabled() );
			vi.useFakeTimers();
			await act( () => vi.advanceTimersByTimeAsync( 500 ) );
			vi.useRealTimers();
			expect( screen.queryByRole( 'dialog', { name: title } ) ).not.toBeInTheDocument();
			expect( readHints().walkthroughStep ).toBe( 'create' );
			await user.click( create );
			expect( await screen.findByRole( 'dialog', { name: 'Make any change' } ) ).toBeVisible();
			expect( connector.createSite ).toHaveBeenCalledTimes( 2 );
			expect( readHints().walkthroughStep ).toBe( 'composer' );
		}
	);

	it( 'continues an incomplete setup by focusing the form without creating or skipping', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await user.click( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) );
		const tip = await screen.findByRole( 'dialog', { name: 'Make it yours' } );
		const name = screen.getByLabelText( 'Site name' );
		await user.clear( name );
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
		await user.click( within( tip ).getByRole( 'button', { name: 'Got it' } ) );
		await waitFor( () => expect( tip ).not.toBeInTheDocument() );
		expect( name ).toHaveFocus();
		expect( connector.createSite ).not.toHaveBeenCalled();
		expect( readHints().walkthroughStep ).toBe( 'create' );
		await user.type( name, 'My first site' );
		expect( screen.queryByRole( 'dialog', { name: 'Make it yours' } ) ).not.toBeInTheDocument();
	} );

	it( 'skips the tour without submitting an incomplete form', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await user.click( await screen.findByRole( 'button', { name: 'Start with Blank site' } ) );
		const tip = await screen.findByRole( 'dialog', { name: 'Make it yours' } );
		const name = screen.getByLabelText( 'Site name' );
		await user.clear( name );
		expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
		within( tip ).getByRole( 'button', { name: 'Got it' } ).focus();
		await user.keyboard( '{Escape}' );
		await waitFor( () => expect( tip ).not.toBeInTheDocument() );
		expect( name ).toHaveFocus();
		expect( connector.createSite ).not.toHaveBeenCalled();
		expect( readHints().walkthroughStep ).toBe( 'skipped' );
		await user.type( name, 'My first site' );
		expect( screen.queryByRole( 'dialog', { name: 'Make it yours' } ) ).not.toBeInTheDocument();
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
		await screen.findByRole( 'dialog', { name: 'Make any change' } );
		await user.type( screen.getByRole( 'textbox', { name: 'Message' } ), 'Make a portfolio' );
		expect( screen.getByRole( 'textbox', { name: 'Message' } ) ).toHaveValue( 'Make a portfolio' );
		await user.type( screen.getByRole( 'textbox', { name: 'Other UI' } ), 'still works' );
		expect( screen.getByRole( 'textbox', { name: 'Other UI' } ) ).toHaveValue( 'still works' );
	} );

	it( 'pauses sharing guidance during annotation mode and resumes after exiting', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'composer' } );
		const { user } = renderWithProviders( <InteractiveTargets />, { connector } );
		await screen.findByRole( 'dialog', { name: 'Make any change' } );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		await screen.findByRole( 'dialog', { name: 'Share a preview' } );
		await user.click( screen.getByRole( 'button', { name: 'Annotate' } ) );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'share' ) );
		expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect( screen.queryByRole( 'dialog', { name: 'Share a preview' } ) ).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Annotate' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Share a preview' } ) ).toBeVisible();
	} );

	it( 'guides a signed-out user to connect and preserves the step when settings close', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'composer' }, { signedIn: false } );
		const { user } = renderApp( { connector, path: '/sites/site-1/new' } );
		const connectionTip = await screen.findByRole( 'dialog', { name: 'Build with AI' } );
		expect( within( connectionTip ).queryByRole( 'status' ) ).not.toBeInTheDocument();
		expect( connectionTip ).toHaveTextContent(
			'Connect an AI provider and you can build and edit this site by talking to it.'
		);
		await user.click( screen.getByRole( 'button', { name: 'Connect' } ) );
		await screen.findByRole( 'dialog', { name: 'Settings' } );
		expect( screen.queryByRole( 'dialog', { name: 'Build with AI' } ) ).not.toBeInTheDocument();
		expect( readHints().walkthroughStep ).toBe( 'composer' );
		await user.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Build with AI' } ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		const share = await screen.findByRole( 'dialog', { name: 'Share a preview' } );
		expect( share ).toHaveTextContent(
			'Log in to WordPress.com to get a preview link you can send around.'
		);
	} );

	it( 'hands sharing to the login prompt, then resumes publishing after dismissal', async () => {
		const { connector, readHints } = setup( { walkthroughStep: 'share' }, { signedIn: false } );
		const { user } = renderApp( { connector, path: '/sites/site-1/new' } );
		await screen.findByRole( 'dialog', { name: 'Share a preview' } );
		screen.getByRole( 'button', { name: 'Share' } ).focus();
		await user.keyboard( '{Enter}' );
		await screen.findByRole( 'dialog', { name: 'Share your WordPress' } );
		await waitFor( () => expect( readHints().walkthroughStep ).toBe( 'publish' ) );
		expect(
			screen.queryByRole( 'dialog', { name: 'Publish when ready' } )
		).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Close' } ) );
		const publish = await screen.findByRole( 'dialog', { name: 'Publish when ready' } );
		expect( publish ).toHaveTextContent(
			'Log in to WordPress.com when you’re ready to take it live.'
		);
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
			expect( await screen.findByRole( 'dialog', { name: 'Share a preview' } ) ).toBeVisible();
			expect( screen.queryByRole( 'dialog', { name: 'Point at it' } ) ).not.toBeInTheDocument();
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
		await screen.findByRole( 'dialog', { name: 'Build with AI' } );
		await act( async () => {
			queryClient.setQueryData( [ 'ai-settings' ], {
				provider: 'anthropic-api-key',
				hasAnthropicApiKey: true,
				anthropicApiKeyPreview: 'test',
			} );
		} );
		const readyTip = await screen.findByRole( 'dialog', { name: 'Make any change' } );
		expect( readyTip ).toBeVisible();
		await waitFor( () =>
			expect( within( readyTip ).getByRole( 'status' ) ).toHaveTextContent( '3/5' )
		);
	} );

	it( 'allows a configured Anthropic provider without a WordPress.com login', async () => {
		const { connector } = setup( { walkthroughStep: 'composer' }, { signedIn: false } );
		connector.getAiSettings.mockResolvedValue( {
			provider: 'anthropic-api-key',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'test',
		} );
		const { user } = renderWithProviders( <Targets />, { connector } );
		await screen.findByRole( 'dialog', { name: 'Make any change' } );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Share a preview' } ) ).toBeVisible();
	} );

	it( 'continues to sharing when the site is stopped and has no annotation toolbar', async () => {
		const { connector } = setup( { walkthroughStep: 'composer' } );
		const { user } = renderApp( { connector, path: '/sites/site-1/new' } );
		await screen.findByRole( 'dialog', { name: 'Make any change' } );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Share a preview' } ) ).toBeVisible();
		expect( connector.startSite ).not.toHaveBeenCalled();
	} );

	it.each( [ true, false ] )(
		'tours site options before the existing workspace (signed in: %s)',
		async ( signedIn ) => {
			localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
			const { connector, readHints } = setup( { walkthroughStep: 'ineligible' }, { signedIn } );
			const { history, user } = renderApp( { connector, path: '/sites/site-1' } );
			await waitFor( () => expect( connector.listenerCount( 'onShowGettingStarted' ) ).toBe( 1 ) );
			act( () => connector.emit( 'onShowGettingStarted' ) );
			const intro = await screen.findByRole( 'dialog', { name: 'Add a new site' } );
			expect( within( intro ).getByRole( 'button', { name: 'Skip tour' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toHaveAttribute(
				'data-walkthrough',
				'intro'
			);
			expect( within( intro ).queryByRole( 'status' ) ).not.toBeInTheDocument();
			expect( history.location.pathname ).toBe( '/sites/site-1/new' );
			await user.click( within( intro ).getByRole( 'button', { name: 'Next' } ) );
			const fresh = await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
			expect(
				within( fresh ).queryByRole( 'button', { name: 'Skip tour' } )
			).not.toBeInTheDocument();
			await user.click( within( fresh ).getByRole( 'button', { name: 'Next' } ) );
			const design = await screen.findByRole( 'dialog', { name: 'Start with a design' } );
			expect(
				within( design ).queryByRole( 'button', { name: 'Skip tour' } )
			).not.toBeInTheDocument();
			await user.click( within( design ).getByRole( 'button', { name: 'Next' } ) );
			expect(
				await screen.findByRole( 'dialog', {
					name: signedIn ? 'Make any change' : 'Build with AI',
				} )
			).toBeVisible();
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
			expect( readHints().walkthroughStep ).toBe( 'composer' );
			expect( history.location.pathname ).toBe( '/sites/site-1/new' );
			expect( connector.createSite ).not.toHaveBeenCalled();
			expect( connector.setOnboardingCompleted ).not.toHaveBeenCalled();
			expect( localStorage.getItem( 'studio-ui-sidebar-collapsed' ) ).toBe( 'true' );
			localStorage.removeItem( 'studio-ui-sidebar-collapsed' );
		}
	);

	it.each( [ 'Start with Blank site', 'View Substrata' ] )(
		'continues an existing-site tour from %s without creating',
		async ( choice ) => {
			const { connector, readHints } = setup( { walkthroughStep: 'create' } );
			const { user } = renderApp( { connector, path: '/sites/site-1/new?addSite=create' } );
			await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
			await user.click( screen.getByRole( 'button', { name: choice } ) );
			const tip = await screen.findByRole( 'dialog', {
				name: 'Make it yours',
			} );
			await user.click( within( tip ).getByRole( 'button', { name: 'Next' } ) );
			expect( await screen.findByRole( 'dialog', { name: 'Make any change' } ) ).toBeVisible();
			expect( readHints().walkthroughStep ).toBe( 'composer' );
			expect( connector.createSite ).not.toHaveBeenCalled();
		}
	);

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

	it( 'replays the introduction from Help after continuing to browse', async () => {
		const { connector } = setup( { walkthroughStep: 'create' }, { sites: [] } );
		const { user } = renderApp( { connector, path: '/sites?addSite=create' } );
		await screen.findByRole( 'dialog', { name: 'Start from scratch' } );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		const tip = await screen.findByRole( 'dialog', { name: 'Start with a design' } );
		await user.click( within( tip ).getByRole( 'button', { name: 'Browse designs' } ) );
		await waitFor( () => expect( tip ).not.toBeInTheDocument() );
		act( () => connector.emit( 'onShowGettingStarted' ) );
		expect( await screen.findByRole( 'dialog', { name: 'Start from scratch' } ) ).toBeVisible();
		expect( connector.createSite ).not.toHaveBeenCalled();
	} );
} );
