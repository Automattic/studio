import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery( query: string ): boolean {
	const subscribe = useCallback(
		( callback: () => void ) => {
			const list = window.matchMedia( query );
			list.addEventListener( 'change', callback );
			return () => list.removeEventListener( 'change', callback );
		},
		[ query ]
	);
	return useSyncExternalStore( subscribe, () => window.matchMedia( query ).matches );
}

export function useReducedMotion(): boolean {
	return useMediaQuery( '(prefers-reduced-motion: reduce)' );
}
