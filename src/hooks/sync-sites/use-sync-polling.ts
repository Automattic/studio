import { useEffect } from 'react';

/**
 * Generic polling hook for sync operations.
 * Sets up polling intervals for states that match the condition.
 *
 * @param states - Record of states to check for polling
 * @param shouldPoll - Function to determine if a state should be polled
 * @param pollFunction - Function to call when polling (receives state key and state value)
 * @param pollInterval - Interval in milliseconds (default: 2000)
 */
export function useSyncPolling< T >(
	states: Record< string, T >,
	shouldPoll: ( state: T, key: string ) => boolean,
	pollFunction: ( key: string, state: T ) => void | Promise< void >,
	pollInterval: number = 2000
) {
	useEffect( () => {
		const intervals: Record< string, NodeJS.Timeout > = {};

		Object.entries( states ).forEach( ( [ key, state ] ) => {
			if ( shouldPoll( state, key ) ) {
				intervals[ key ] = setTimeout( () => {
					void pollFunction( key, state );
				}, pollInterval );
			}
		} );

		return () => {
			Object.values( intervals ).forEach( clearTimeout );
		};
	}, [ states, shouldPoll, pollFunction, pollInterval ] );
}
