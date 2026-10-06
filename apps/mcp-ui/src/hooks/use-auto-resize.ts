import { useCallback, useRef } from 'react';
import { useConnector } from '@/data/core';

// Inline frames take the height the app reports.
export function useAutoResize() {
	const connector = useConnector();
	const observer = useRef< ResizeObserver | null >( null );
	return useCallback(
		( element: HTMLElement | null ) => {
			observer.current?.disconnect();
			if ( ! element ) {
				return;
			}
			let frame: number | null = null;
			observer.current = new ResizeObserver( () => {
				if ( frame !== null ) {
					return;
				}
				frame = requestAnimationFrame( () => {
					frame = null;
					connector.notifySize(
						Math.ceil( document.documentElement.getBoundingClientRect().height )
					);
				} );
			} );
			observer.current.observe( element );
		},
		[ connector ]
	);
}
