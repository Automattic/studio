import { useEffect, useState } from 'react';

export function useProgressTimer( {
	initialProgress,
	interval = 1000,
	maxValue = 100,
	step = 0.3,
}: {
	initialProgress: number;
	interval?: number;
	maxValue?: number;
	step?: number;
} ) {
	const [ progress, setProgress ] = useState( initialProgress );

	useEffect( () => {
		const timer = setInterval( () => {
			setProgress( ( prevProgress ) => {
				const newProgress = prevProgress + step;
				return Math.min( newProgress, maxValue );
			} );
		}, interval );

		return () => {
			clearInterval( timer );
		};
	}, [ interval, maxValue, step ] );

	return {
		progress,
		setProgress,
	};
}
