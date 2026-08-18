import { useEffect, useRef } from 'react';

// Long enough that a typing burst lands as one write, short enough that the
// save still feels immediate when the user pauses.
export const SAVE_DEBOUNCE_MS = 800;

/**
 * Debounces `save( value )` while the user types and flushes the pending value
 * on unmount, so leaving the tab mid-debounce doesn't drop the last change.
 * Pass `undefined` while the value is pristine (nothing typed yet) to save
 * nothing.
 */
export function useDebouncedSave< T >(
	value: T | undefined,
	save: ( value: T ) => void,
	delay: number = SAVE_DEBOUNCE_MS
): void {
	const pending = useRef< { value: T } | null >( null );

	useEffect( () => {
		if ( value === undefined ) {
			pending.current = null;
			return;
		}
		pending.current = { value };
		const timer = setTimeout( () => {
			pending.current = null;
			save( value );
		}, delay );
		return () => clearTimeout( timer );
	}, [ value, save, delay ] );

	useEffect(
		() => () => {
			if ( pending.current !== null ) {
				save( pending.current.value );
			}
		},
		[ save ]
	);
}
