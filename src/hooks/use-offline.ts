import { useState } from 'react';
import { useWindowListener } from './use-window-listener';

export function useOffline() {
	const [ isOffline, setIsOffline ] = useState( ! navigator.onLine );
	useWindowListener( 'online', () => {
		setIsOffline( false );
	} );
	useWindowListener( 'offline', () => {
		setIsOffline( true );
	} );
	return isOffline;
}
