import { useEffect, useState } from 'react';

/**
 * Tracks the browser's online/offline state. Mirrors the desktop renderer's
 * hook of the same name — used to disable network-dependent flows like
 * connecting a WordPress.com site.
 */
export function useOffline(): boolean {
	const [ isOffline, setIsOffline ] = useState( ! navigator.onLine );

	useEffect( () => {
		const handleOnline = () => setIsOffline( false );
		const handleOffline = () => setIsOffline( true );
		window.addEventListener( 'online', handleOnline );
		window.addEventListener( 'offline', handleOffline );
		return () => {
			window.removeEventListener( 'online', handleOnline );
			window.removeEventListener( 'offline', handleOffline );
		};
	}, [] );

	return isOffline;
}
