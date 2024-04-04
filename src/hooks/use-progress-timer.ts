import { useEffect, useState } from 'react';

export function useProgressTimer( {
	initialProgress,
	interval = 1000,
	maxValue = 100,
	step = 0.3,
	paused = false,
}: {
	initialProgress: number;
	interval?: number;
	maxValue?: number;
	step?: number;
	paused?: boolean;
} ) {
	const [ progress, setProgress ] = useState( initialProgress );

	useEffect( () => {
		if ( paused ) {
			return;
		}

		const timer = setInterval( () => {
			setProgress( ( prevProgress ) => {
				const newProgress = prevProgress + step;
				return Math.min( newProgress, maxValue );
			} );
		}, interval );

		return () => {
			clearInterval( timer );
		};
	}, [ interval, maxValue, step, paused ] );

	return {
		progress,
		setProgress,
	};
}
