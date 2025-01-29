import { useState, useEffect } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useIpcListener } from './use-ipc-listener';

export function useFullscreen() {
	const [ isFullscreen, setIsFullscreen ] = useState( false );

	useEffect( () => {
		let mounted = true;
		getIpcApi()
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

	useIpcListener( 'window-fullscreen-change', ( _, fullscreen: boolean ) => {
		setIsFullscreen( fullscreen );
	} );

	return isFullscreen;
}
