import { useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';

type TrafficLightsPosition = 'default' | 'toolbar';

/**
 * Moves the macOS traffic lights to line up with the site preview toolbar
 * while `alignToToolbar` holds, and back to their default position when it
 * stops or the caller unmounts.
 *
 * The lights' default spot suits the taller sidebar and chat headers; in full
 * preview the compact toolbar sits beside them instead. `delayMs` holds each
 * move until the layout has finished sliding between the two.
 */
export function useTrafficLightsPosition( alignToToolbar: boolean, delayMs = 0 ) {
	const connector = useConnector();
	const appliedRef = useRef< TrafficLightsPosition >( 'default' );

	useEffect( () => {
		const target = alignToToolbar ? 'toolbar' : 'default';
		if ( ! connector.setTrafficLightsPosition || appliedRef.current === target ) {
			return;
		}
		const timeoutId = window.setTimeout( () => {
			appliedRef.current = target;
			void connector.setTrafficLightsPosition?.( target );
		}, delayMs );
		return () => window.clearTimeout( timeoutId );
	}, [ connector, alignToToolbar, delayMs ] );

	// Unmounting takes the layout away at once, so restore without waiting.
	useEffect( () => {
		const applied = appliedRef;
		return () => {
			if ( applied.current === 'toolbar' ) {
				applied.current = 'default';
				void connector.setTrafficLightsPosition?.( 'default' );
			}
		};
	}, [ connector ] );
}
