import { useEffect, useState } from 'react';
import { useConnector } from '@/data/core';

export function useFullscreen(): boolean {
	const connector = useConnector();
	const [ isFullscreen, setIsFullscreen ] = useState( false );

	useEffect( () => {
		let mounted = true;
		void connector.isFullscreen().then( ( fullscreen ) => {
			if ( mounted ) {
				setIsFullscreen( fullscreen );
			}
		} );

		const unsubscribe = connector.onFullscreenChange( setIsFullscreen );

		return () => {
			mounted = false;
			unsubscribe();
		};
	}, [ connector ] );

	return isFullscreen;
}
