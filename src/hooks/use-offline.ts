import { useState } from 'react';
import { useWindowListener } from 'src/hooks/use-window-listener';

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
