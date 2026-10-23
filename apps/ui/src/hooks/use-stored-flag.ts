import { useCallback, useState } from 'react';

// A per-window boolean kept in localStorage; `initial` when nothing is stored
// or storage is unavailable.
export function useStoredFlag( key: string, initial: boolean ) {
	const [ value, setValue ] = useState( () => {
		try {
			const stored = window.localStorage.getItem( key );
			return stored === null ? initial : stored === 'true';
		} catch {
			return initial;
		}
	} );
	const update = useCallback(
		( next: boolean ) => {
			setValue( next );
			try {
				window.localStorage.setItem( key, String( next ) );
			} catch {
				// Best-effort; the value still holds for this session.
			}
		},
		[ key ]
	);
	return [ value, update ] as const;
}
