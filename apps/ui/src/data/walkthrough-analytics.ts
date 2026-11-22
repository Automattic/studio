import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useCallback, useEffect } from 'react';
import { useConnector } from '@/data/core';
import type { Connector } from '@/data/core';

type Attempt = {
	id: string;
	source: 'automatic' | 'replay';
	views: Map< string, number >;
};
const attempts = new WeakMap< Connector, Attempt >();

export function restartWalkthroughTracking( connector: Connector ) {
	attempts.set( connector, { id: crypto.randomUUID(), source: 'replay', views: new Map() } );
}

function getAttempt( connector: Connector ): Attempt {
	let attempt = attempts.get( connector );
	if ( ! attempt ) {
		attempt = { id: crypto.randomUUID(), source: 'automatic', views: new Map() };
		attempts.set( connector, attempt );
	}
	return attempt;
}

export function useWalkthroughTracking( step: string, visible: boolean, variant = 'default' ) {
	const connector = useConnector();
	const attempt = getAttempt( connector );
	const track = useCallback(
		( action: string, outcome?: string ) => {
			const viewedAt = attempt.views.get( `${ step }:${ variant }` );
			void connector
				.trackEvent( TRACKS_EVENTS.WALKTHROUGH_ACTION, {
					tour_version: 1,
					attempt_id: attempt.id,
					source: attempt.source,
					step,
					variant,
					action,
					...( outcome ? { outcome } : {} ),
					...( viewedAt === undefined ? {} : { elapsed_ms: Date.now() - viewedAt } ),
				} )
				.catch( () => undefined );
		},
		[ connector, attempt, step, variant ]
	);
	useEffect( () => {
		if ( ! visible ) return;
		const key = `${ step }:${ variant }`;
		if ( attempt.views.has( key ) ) return;
		attempt.views.set( key, Date.now() );
		void connector
			.trackEvent( TRACKS_EVENTS.WALKTHROUGH_STEP_VIEWED, {
				tour_version: 1,
				attempt_id: attempt.id,
				source: attempt.source,
				step,
				variant,
			} )
			.catch( () => undefined );
	}, [ connector, attempt, step, variant, visible ] );
	return track;
}
