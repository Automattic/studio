import { useEffect, useState } from 'react';

interface UseProgressOptions {
	isProcessing: boolean;
	initialProgress?: number;
	maxProgress?: number;
	interval?: number;
	step?: number;
}

export function useProgress( {
	isProcessing,
	initialProgress = 10,
	maxProgress = 95,
	interval = 800,
	step = 1,
}: UseProgressOptions ) {
	const [ progress, setProgress ] = useState( initialProgress );

	useEffect( () => {
		if ( ! isProcessing ) {
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
	}, [ isProcessing, initialProgress, maxProgress, interval, step ] );

	return progress;
}
