import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

const STACK_PRESS_ANIMATION_DURATION = 180;

export function useStackPressAnimation(
	setPressedStackId: Dispatch< SetStateAction< string | null > >
) {
	const pressTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	const clearPressTimer = useCallback( () => {
		if ( pressTimerRef.current ) {
			clearTimeout( pressTimerRef.current );
			pressTimerRef.current = null;
		}
	}, [] );

	const clearPressedStack = useCallback( () => {
		clearPressTimer();
		setPressedStackId( null );
	}, [ clearPressTimer, setPressedStackId ] );

	const pressStack = useCallback(
		( stackId: string ) => {
			clearPressTimer();

			setPressedStackId( stackId );
			pressTimerRef.current = setTimeout( () => {
				pressTimerRef.current = null;
				setPressedStackId( ( currentStackId ) =>
					currentStackId === stackId ? null : currentStackId
				);
			}, STACK_PRESS_ANIMATION_DURATION );
		},
		[ clearPressTimer, setPressedStackId ]
	);

	useEffect( () => clearPressTimer, [ clearPressTimer ] );

	return {
		pressStack,
		clearPressedStack,
	};
}
