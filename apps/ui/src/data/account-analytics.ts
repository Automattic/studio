import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useEffect, useRef, useCallback, useState } from 'react';
import { useConnector } from '@/data/core';
import type { Connector } from '@/data/core';
import type { AuthAnalytics } from '@studio/common/lib/auth-tracks';
import type { TracksProps } from '@studio/common/lib/record-tracks-event';

type Journey = { analytics: AuthAnalytics; startedAt: number };
const generations = new WeakMap< Connector, number >();
const journeyContexts = new WeakMap< AuthAnalytics, { generation: number; startedAt: number } >();
const JOURNEY_WINDOW_MS = 24 * 60 * 60 * 1000;
const journeys = new WeakMap< Connector, Map< string, Journey > >();

export function rememberAccountJourney(
	connector: Connector,
	analytics: AuthAnalytics,
	scope = ''
) {
	let pending = journeys.get( connector );
	if ( ! pending ) {
		pending = new Map();
		journeys.set( connector, pending );
	}
	const startedAt = Date.now();
	journeyContexts.set( analytics, { generation: generations.get( connector ) ?? 0, startedAt } );
	pending.set( `${ analytics.intent }:${ scope }`, { analytics, startedAt } );
}

export function getAccountJourney(
	connector: Connector,
	intent: AuthAnalytics[ 'intent' ],
	scope = ''
) {
	const pending = journeys.get( connector );
	const key = `${ intent }:${ scope }`;
	const journey = pending?.get( key );
	if ( journey && Date.now() - journey.startedAt <= JOURNEY_WINDOW_MS ) {
		return journey.analytics;
	}
	pending?.delete( key );
}

const completedJourneys = new WeakMap< Connector, Set< string > >();
export function completeAccountJourney( connector: Connector, analytics?: AuthAnalytics ) {
	const context = analytics ? journeyContexts.get( analytics ) : undefined;
	if (
		! analytics ||
		( analytics.journey_id && completedJourneys.get( connector )?.has( analytics.journey_id ) ) ||
		! context ||
		context.generation !== ( generations.get( connector ) ?? 0 ) ||
		Date.now() - context.startedAt > JOURNEY_WINDOW_MS
	)
		return;
	if ( analytics.journey_id ) {
		const completed = completedJourneys.get( connector ) ?? new Set< string >();
		if ( completed.size >= 1000 ) completed.delete( completed.values().next().value! );
		completed.add( analytics.journey_id );
		completedJourneys.set( connector, completed );
	}
	for ( const [ key, pending ] of journeys.get( connector ) ?? [] ) {
		if ( pending.analytics.journey_id === analytics.journey_id )
			journeys.get( connector )?.delete( key );
	}
	void connector
		.trackEvent( TRACKS_EVENTS.ACCOUNT_JOURNEY_COMPLETED, analytics )
		.catch( () => undefined );
}

const providerIntents = new WeakMap<
	Connector,
	{ intent: 'build' | 'annotate'; scope?: string; journey_id: string }
>();
export function setProviderIntent(
	connector: Connector,
	context?: { intent: 'build' | 'annotate'; scope?: string }
) {
	if ( context ) providerIntents.set( connector, { ...context, journey_id: crypto.randomUUID() } );
	else providerIntents.delete( connector );
}
export function getProviderIntent( connector: Connector ) {
	return providerIntents.get( connector );
}

export function clearAccountJourneys( connector: Connector ) {
	generations.set( connector, ( generations.get( connector ) ?? 0 ) + 1 );
	journeys.delete( connector );
	providerIntents.delete( connector );
	completedJourneys.delete( connector );
}

// Observe visibility rather than mount: dialogs and settings panels can stay mounted while hidden.
export function useAnalyticsExposure< T extends HTMLElement = HTMLDivElement >(
	event: typeof TRACKS_EVENTS.ACCOUNT_PROMPT_VIEWED | typeof TRACKS_EVENTS.ONBOARDING_VIEWED,
	props: TracksProps,
	active = true
) {
	const connector = useConnector();
	const [ element, setElement ] = useState< T | null >( null );
	const recorded = useRef< string | undefined >( undefined );
	const signature = JSON.stringify( props );
	useEffect( () => {
		if ( ! active ) {
			recorded.current = undefined;
			return;
		}
		const node = element;
		if ( ! node ) return;
		const record = () => {
			if ( recorded.current === signature || node.closest( '[hidden], [aria-hidden="true"]' ) )
				return;
			recorded.current = signature;
			void connector.trackEvent( event, JSON.parse( signature ) ).catch( () => undefined );
		};
		if ( typeof IntersectionObserver === 'undefined' ) {
			record();
			return;
		}
		const observer = new IntersectionObserver( ( entries ) => {
			if ( entries.some( ( entry ) => entry.isIntersecting ) ) record();
		} );
		observer.observe( node );
		return () => observer.disconnect();
	}, [ connector, event, signature, active, element ] );
	return useCallback( ( node: T | null ) => {
		setElement( node );
	}, [] );
}
