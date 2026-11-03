import { useCallback, useEffect, useState } from 'react';

export type SubmitFeedback = 'shake' | 'error' | null;

// A blocked action shakes its control, then holds the error color briefly.
const SUBMIT_SHAKE_MS = 240;
const SUBMIT_FEEDBACK_MS = 900;

export function useSubmitFeedback( shakeDuration = SUBMIT_SHAKE_MS ) {
	const [ feedback, setFeedback ] = useState< SubmitFeedback >( null );

	useEffect( () => {
		if ( feedback === null ) {
			return;
		}
		const timer = window.setTimeout(
			() => setFeedback( feedback === 'shake' ? 'error' : null ),
			feedback === 'shake' ? shakeDuration : Math.max( 0, SUBMIT_FEEDBACK_MS - shakeDuration )
		);
		return () => window.clearTimeout( timer );
	}, [ feedback, shakeDuration ] );

	const shake = useCallback( () => setFeedback( 'shake' ), [] );
	return { feedback, shake };
}
