import { useState, useEffect } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function useFullscreen() {
	const [ isFullscreen, setIsFullscreen ] = useState( false );

	useEffect( () => {
		let mounted = true;
		void getIpcApi()
			.isFullscreen()
			.then( ( fullscreen ) => {
				if ( mounted ) {
					setIsFullscreen( fullscreen );
				}
			} );
		return () => {
			mounted = false;
		};
	}, [] );

	useIpcListener( 'window-fullscreen-change', ( _, fullscreen ) => {
		setIsFullscreen( fullscreen );
	} );

	return isFullscreen;
}
