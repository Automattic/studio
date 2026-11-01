import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import {
	completeAccountJourney,
	clearAccountJourneys,
	getAccountJourney,
	rememberAccountJourney,
	useAnalyticsExposure,
} from './account-analytics';
import type { AuthAnalytics } from '@studio/common/lib/auth-tracks';

afterEach( () => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
} );

describe( 'account journey measurement', () => {
	it( 'invalidates captured work on account changes', () => {
		const connector = createFakeConnector();
		const analytics = {
			placement: 'publish',
			intent: 'publish',
			journey_id: crypto.randomUUID(),
		} as const;
		rememberAccountJourney( connector, analytics, 'site' );
		const captured = getAccountJourney( connector, 'publish', 'site' );
		clearAccountJourneys( connector );
		completeAccountJourney( connector, captured, { completion_kind: 'preview_create' } );
		expect( connector.trackEvent ).not.toHaveBeenCalled();
	} );
	it( 'does not attribute a captured task that finishes after the journey expires', () => {
		vi.useFakeTimers();
		const connector = createFakeConnector();
		const analytics = {
			placement: 'publish',
			intent: 'publish',
			journey_id: crypto.randomUUID(),
		} as const;
		rememberAccountJourney( connector, analytics, 'site' );
		const captured = getAccountJourney( connector, 'publish', 'site' );
		vi.advanceTimersByTime( 24 * 60 * 60 * 1000 + 1 );
		completeAccountJourney( connector, captured, { completion_kind: 'preview_create' } );
		expect( connector.trackEvent ).not.toHaveBeenCalled();
	} );
	it( 'keeps the emitted initiation timestamp equal to the expiry clock across retries', () => {
		vi.useFakeTimers();
		const connector = createFakeConnector();
		const context: AuthAnalytics = {
			placement: 'publish',
			intent: 'publish',
			journey_id: crypto.randomUUID(),
		};
		rememberAccountJourney( connector, context, 'site' );
		expect( context.journey_started_at ).toBe( Date.now() );
		vi.advanceTimersByTime( 1_000 );
		const retry: AuthAnalytics = { ...context };
		rememberAccountJourney( connector, retry, 'site' );
		expect( retry.journey_started_at ).toBe( Date.now() );
		vi.advanceTimersByTime( 24 * 60 * 60 * 1000 );
		completeAccountJourney( connector, context, { completion_kind: 'sync_push' } );
		expect( connector.trackEvent ).not.toHaveBeenCalled();
		completeAccountJourney( connector, retry, { completion_kind: 'sync_push' } );
		expect( connector.trackEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.ACCOUNT_JOURNEY_COMPLETED, {
			...retry,
			completion_kind: 'sync_push',
		} );
	} );

	it( 'observes a prompt that mounts after the parent effect', async () => {
		const observe = vi.fn();
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				observe = observe;
				disconnect() {}
			}
		);
		function DeferredPrompt() {
			const [ mounted, setMounted ] = useState( false );
			const ref = useAnalyticsExposure( TRACKS_EVENTS.ACCOUNT_PROMPT_VIEWED, {
				placement: 'welcome',
			} );
			return (
				<>
					<button onClick={ () => setMounted( true ) }>Mount</button>
					{ mounted && <div ref={ ref }>Deferred</div> }
				</>
			);
		}
		renderWithProviders( <DeferredPrompt /> );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Mount' } ) );
		await waitFor( () => expect( observe ).toHaveBeenCalledWith( screen.getByText( 'Deferred' ) ) );
	} );
	it( 'does not cross sites, expire attribution into another day, or count a completion twice', () => {
		vi.useFakeTimers();
		const connector = createFakeConnector();
		const analytics = {
			placement: 'share',
			intent: 'share',
			journey_id: crypto.randomUUID(),
		} as const;
		rememberAccountJourney( connector, analytics, 'site-a' );
		expect( getAccountJourney( connector, 'share', 'site-b' ) ).toBeUndefined();
		const captured = getAccountJourney( connector, 'share', 'site-a' );
		completeAccountJourney( connector, captured, { completion_kind: 'preview_create' } );
		completeAccountJourney( connector, captured, { completion_kind: 'preview_create' } );
		expect( connector.trackEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.ACCOUNT_JOURNEY_COMPLETED,
			{ ...analytics, completion_kind: 'preview_create' }
		);
		rememberAccountJourney(
			connector,
			{ ...analytics, journey_id: crypto.randomUUID() },
			'site-a'
		);
		vi.advanceTimersByTime( 24 * 60 * 60 * 1000 + 1 );
		expect( getAccountJourney( connector, 'share', 'site-a' ) ).toBeUndefined();
	} );

	it( 'waits for visibility, deduplicates rerenders, and counts reopening', async () => {
		let callback: IntersectionObserverCallback;
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor( listener: IntersectionObserverCallback ) {
					callback = listener;
				}
				observe() {}
				disconnect() {}
			}
		);
		function Prompt( { open }: { open: boolean } ) {
			const ref = useAnalyticsExposure(
				TRACKS_EVENTS.ACCOUNT_PROMPT_VIEWED,
				{ placement: 'share' },
				open
			);
			return (
				<div ref={ ref } hidden={ ! open }>
					Prompt
				</div>
			);
		}
		const connector = createFakeConnector();
		function Harness() {
			const [ open, setOpen ] = useState( true );
			return (
				<>
					<button onClick={ () => setOpen( ! open ) }>Toggle</button>
					<Prompt open={ open } />
				</>
			);
		}
		renderWithProviders( <Harness />, { connector } );
		await screen.findByText( 'Prompt' );
		expect( connector.trackEvent ).not.toHaveBeenCalled();
		const visible = () =>
			act( () =>
				callback(
					[
						{
							isIntersecting: true,
							target: screen.getByText( 'Prompt' ),
						} as unknown as IntersectionObserverEntry,
					],
					{} as IntersectionObserver
				)
			);
		visible();
		visible();
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 1 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Toggle' } ) );
		visible();
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 1 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Toggle' } ) );
		visible();
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 2 );
	} );
} );
