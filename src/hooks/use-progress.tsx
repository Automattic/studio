import { useCallback, useEffect, useState } from 'react';

interface UseProgressOptions {
	initialProgress?: number;
	maxProgress?: number;
	interval?: number;
	step?: number;
}

export function useProgress( {
	initialProgress = 10,
	maxProgress = 95,
	interval = 800,
	step = 0.5,
}: UseProgressOptions = {} ) {
	const [ progress, setProgress ] = useState( initialProgress );
	const [ isProgressing, setIsProgressing ] = useState( false );

	useEffect( () => {
		if ( ! isProgressing ) {
			setProgress( initialProgress );
			return;
		}

		const intervalId = setInterval( () => {
			setProgress( ( current ) => {
				if ( current >= maxProgress ) {
					return current;
				}
				return current + step;
			} );
		}, interval );

		return () => clearInterval( intervalId );
	}, [ isProgressing, initialProgress, maxProgress, interval, step ] );

	const startProgress = useCallback( () => {
		setIsProgressing( true );
	}, [ setIsProgressing ] );

	const stopProgress = useCallback( () => {
		setIsProgressing( false );
	}, [ setIsProgressing ] );

	return {
		startProgress,
		stopProgress,
		progress,
		isProgressing,
	};
}
